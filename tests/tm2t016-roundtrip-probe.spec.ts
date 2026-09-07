/**
 * TM2-T016 ROUND-TRIP probe -- NOT part of the suite, do not merge.
 *
 * Where the investigation stands, all of it evidence I gathered on this ticket:
 *
 *   - Bundle read (12 Aug): create submits `title: N.title` raw -- no debounce,
 *     no zod transform on the create path.
 *   - Arm 1, state-lag probe (7 Sep, 24 samples, throttle 1/4/8/16x):
 *     DOM input value === typed, every sample.
 *   - Arm 2, wire probe (7 Sep, 24 samples, same rates): the outbound GraphQL
 *     POST body carried the FULL typed title, every sample.
 *
 * So the client types it, holds it, and sends it. 48 samples, zero truncation.
 *
 * That matters for what is left, because the original ticket's "title actually
 * stored" column was read out of the Playwright accessibility snapshot -- i.e.
 * out of the RENDERED TASK LIST, not out of the API. "Stored" was an inference.
 * The round trip itself has never been observed.
 *
 * This arm closes that gap by comparing three values for one create:
 *
 *   typed  -> what we pressed into the input
 *   api    -> the title echoed back in the create mutation's RESPONSE
 *   render -> the title the task list actually draws
 *
 *   api SHORT                -> server-side truncation; backend owns the fix.
 *   api full but render SHORT-> read-back/render defect; frontend owns it, and
 *                               the stored data is fine.
 *   both full                -> the defect is not reachable at these rates, and
 *                               the ticket needs CI-side instrumentation
 *                               instead of another local sweep.
 *
 * Runs only at 8x/16x throttle -- the low rates are already covered by arms 1
 * and 2 and would only burn budget. Each created task is deleted immediately,
 * so the shared staging board is left as it was found.
 */
import { expect, test } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_PASSWORD, VALID_USERNAME } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { TasksPage } from '../pages/TasksPage';

test.use({ video: 'off', trace: 'off' });

const KEYSTROKE_DELAY_MS = 30;
const FIELD_SYNC_SETTLE_MS = 1000;

/** Only the loaded rates -- 1x/4x are already covered by arms 1 and 2. */
const THROTTLE_RATES = (process.env.PROBE_RATES ?? '8,16').split(',').map(Number);
const SAMPLES_PER_RATE = Number(process.env.PROBE_SAMPLES ?? 4);

type Sample = {
  rate: number;
  i: number;
  typed: string;
  dom: string;
  /** Title echoed in the create mutation response, or null if not found. */
  api: string | null;
  /** Title as the task list actually rendered it, or null if no row matched. */
  render: string | null;
};

test('TM2-T016 probe: does the created title survive the round trip?', async ({ page }) => {
  // Nav budget first, sweep budget second -- TasksPage.open()'s final click is
  // unbounded, and on probe run #1 a stale locator burned the WHOLE test
  // timeout at the sidebar and produced zero samples.
  test.setTimeout(180000);

  const login = new LoginPage(page);
  await login.goto(DEFAULT_LOGIN_URL);
  await login.login(VALID_USERNAME, VALID_PASSWORD);

  const tasks = new TasksPage(page);
  await tasks.open();

  test.setTimeout(1800000);

  const client = await page.context().newCDPSession(page);
  const samples: Sample[] = [];

  // Set just before each create so the listener only inspects the response to
  // the request that carried this sample's title.
  let currentTyped = '';
  let apiTitle: string | null = null;

  page.on('response', async (res) => {
    if (!currentTyped || res.request().method() !== 'POST') return;
    const reqBody = res.request().postData() ?? '';
    if (!reqBody.includes(currentTyped.slice(0, 12))) return;

    try {
      const text = await res.text();
      // Shape-agnostic: pull the longest run that starts with our title's
      // stable prefix, so a truncated echo is visible as a shorter match.
      const prefix = currentTyped.slice(0, 21); // "Automation Test Task "
      const idx = text.indexOf(prefix);
      if (idx === -1) return;
      // Read to the closing quote of that JSON string value.
      const rest = text.slice(idx);
      const end = rest.indexOf('"');
      apiTitle = end === -1 ? rest.slice(0, currentTyped.length + 8) : rest.slice(0, end);
    } catch {
      // Body already consumed or connection closed -- leave apiTitle null.
    }
  });

  for (const rate of THROTTLE_RATES) {
    await client.send('Emulation.setCPUThrottlingRate', { rate });

    for (let i = 0; i < SAMPLES_PER_RATE; i++) {
      const typed = `Automation Test Task ${Date.now()}-${100 + i}`;
      currentTyped = typed;
      apiTitle = null;

      await tasks.startNewTask();
      await tasks.newTaskTitleInput.click();
      await tasks.newTaskTitleInput.pressSequentially(typed, { delay: KEYSTROKE_DELAY_MS });
      await page.waitForTimeout(FIELD_SYNC_SETTLE_MS);

      const dom = await tasks.newTaskTitleInput.inputValue();

      await tasks.createTaskButton.click();
      await expect(tasks.newTaskTitleInput).toBeHidden({ timeout: 30000 });
      await page.waitForTimeout(2000);

      // Read the row back WITHOUT assuming the full title -- match on a prefix
      // short enough to survive a one-character loss, then read what is drawn.
      const stem = typed.slice(0, typed.length - 3);
      const row = page.getByText(stem, { exact: false }).first();
      let render: string | null = null;
      try {
        render = (await row.textContent({ timeout: 15000 }))?.trim() ?? null;
      } catch {
        render = null;
      }

      samples.push({ rate, i, typed, dom, api: apiTitle, render });

      const mark = (v: string | null) =>
        v === null ? 'NOT-FOUND' : v === typed ? 'full' : `SHORT(${v.length}) "${v}"`;
      console.log(
        `[live] rate ${String(rate).padStart(2)}x #${i} | typed ${typed.length} | ` +
          `dom ${dom.length} | api ${mark(apiTitle)} | render ${mark(render)}`,
      );

      currentTyped = '';

      // Leave the board as we found it, whatever the title ended up being.
      await tasks.deleteTaskIfExists(render && render.length > 0 ? render : typed);
      await page.waitForTimeout(1000);
    }
  }

  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  console.log('\n=== TM2-T016 round-trip probe results ===');
  let apiShort = 0;
  let renderShort = 0;

  for (const s of samples) {
    if (s.api !== null && s.api !== s.typed) apiShort++;
    if (s.render !== null && s.render !== s.typed) renderShort++;
    const flag =
      (s.api !== null && s.api !== s.typed) || (s.render !== null && s.render !== s.typed)
        ? '  <-- DIVERGENCE'
        : '';
    console.log(
      `rate ${String(s.rate).padStart(2)}x #${s.i} | typed ${s.typed.length} | ` +
        `api ${s.api === null ? 'NOT-FOUND' : s.api.length} | ` +
        `render ${s.render === null ? 'NOT-FOUND' : s.render.length}${flag}`,
    );
  }

  console.log(`\nsamples=${samples.length} apiShort=${apiShort} renderShort=${renderShort}`);

  // The probe reports; it does not gate.
  expect(samples.length).toBe(THROTTLE_RATES.length * SAMPLES_PER_RATE);
});
