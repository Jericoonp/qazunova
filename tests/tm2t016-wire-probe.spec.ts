/**
 * TM2-T016 WIRE probe -- NOT part of the suite, do not merge.
 *
 * Arm 1 (state-lag) is DONE and came back clean: 24/24 samples across CPU
 * throttle 1x/4x/8x/16x had DOM value === typed value, zero short reads. The
 * React-fiber arm was unmeasurable (production build -- no hook state near the
 * typed length was reachable from the input), so "state lags the DOM" was
 * never actually tested, only proxied.
 *
 * This arm skips the proxy and reads what the app ACTUALLY SENDS. At the exact
 * moment the user clicks Create, intercept the outbound POST and measure the
 * longest prefix of the typed title present in its body:
 *
 *   prefix === typed.length      -> the client sent the whole title. The last
 *                                   character is lost SERVER-SIDE or on
 *                                   read-back, and the frontend is exonerated.
 *   prefix === typed.length - 1  -> SMOKING GUN. The client truncated it
 *                                   between the DOM and the request body,
 *                                   which is exactly the one-keystroke state
 *                                   lag the ticket hypothesises.
 *
 * Measuring the prefix rather than parsing JSON keeps this agnostic to the
 * request shape (REST body, GraphQL variables, form encoding all work).
 *
 * Non-destructive by construction: the create POST is ABORTED, never
 * delivered, so no task is ever written to the shared staging account.
 */
import { expect, test } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_PASSWORD, VALID_USERNAME } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { TasksPage } from '../pages/TasksPage';

test.use({ video: 'off', trace: 'off' });

/** Same as the POM's, so the probe types the way the failing test types. */
const KEYSTROKE_DELAY_MS = 30;
const FIELD_SYNC_SETTLE_MS = 1000;

/**
 * CPU slowdown factors to sweep, cheapest first. 1 = this box, unthrottled.
 * Overridable so the interception mechanism can be smoke-tested in ~1 minute
 * before committing to the full sweep -- probe run #1 burned a 15m budget
 * proving only that a locator had drifted.
 */
const THROTTLE_RATES = (process.env.PROBE_RATES ?? '1,4,8,16').split(',').map(Number);
const SAMPLES_PER_RATE = Number(process.env.PROBE_SAMPLES ?? 6);

type Sample = {
  rate: number;
  i: number;
  typed: string;
  dom: string;
  /** Longest prefix of `typed` found in the intercepted body, or -1 if no POST. */
  wirePrefix: number;
  url: string | null;
};

/** Longest prefix of `needle` that appears anywhere in `haystack`. */
function longestPrefixPresent(haystack: string, needle: string): number {
  // Walk down from the full string; the first hit is the longest.
  for (let len = needle.length; len > 0; len--) {
    if (haystack.includes(needle.slice(0, len))) return len;
  }
  return 0;
}

test('TM2-T016 probe: does the create POST carry the full typed title?', async ({ page }) => {
  // Nav budget first, sweep budget second -- TasksPage.open()'s final click is
  // unbounded, and on probe run #1 a stale locator burned the WHOLE test
  // timeout at the sidebar and produced zero samples.
  test.setTimeout(180000);

  const login = new LoginPage(page);
  await login.goto(DEFAULT_LOGIN_URL);
  await login.login(VALID_USERNAME, VALID_PASSWORD);

  const tasks = new TasksPage(page);
  await tasks.open();

  // Reached the board -- restart the clock with the budget the sweep needs.
  test.setTimeout(1800000);

  const client = await page.context().newCDPSession(page);
  const samples: Sample[] = [];

  // The title currently being typed, so the route handler knows what to look
  // for and only aborts the request that carries it.
  let currentTyped = '';
  let captured: { body: string; url: string } | null = null;

  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST' || !currentTyped) return route.continue();

    const body = req.postData() ?? '';
    // Only the create call carries the typed title. Anything else (telemetry,
    // auth refresh, websocket fallback) must pass through untouched.
    if (!body.includes(currentTyped.slice(0, 12))) return route.continue();

    captured = { body, url: req.url() };
    // Abort: the payload is the evidence, and not delivering it keeps the
    // shared staging board clean.
    return route.abort('failed');
  });

  for (const rate of THROTTLE_RATES) {
    await client.send('Emulation.setCPUThrottlingRate', { rate });

    for (let i = 0; i < SAMPLES_PER_RATE; i++) {
      // The exact title shape the failing CI test uses.
      const typed = `Automation Test Task ${Date.now()}-${100 + i}`;
      currentTyped = typed;
      captured = null;

      await tasks.startNewTask();
      await tasks.newTaskTitleInput.click();
      await tasks.newTaskTitleInput.pressSequentially(typed, { delay: KEYSTROKE_DELAY_MS });
      await page.waitForTimeout(FIELD_SYNC_SETTLE_MS);

      const dom = await tasks.newTaskTitleInput.inputValue();

      // Click Create -- this is the instant the state/DOM divergence, if any,
      // becomes observable on the wire.
      await tasks.createTaskButton.click();

      // Give the request time to be issued and intercepted. The abort means
      // the dialog will not close on its own, so this is a plain wait.
      const deadline = Date.now() + 15000;
      while (!captured && Date.now() < deadline) {
        await page.waitForTimeout(200);
      }

      const cap = captured as { body: string; url: string } | null;
      const wirePrefix = cap ? longestPrefixPresent(cap.body, typed) : -1;

      samples.push({ rate, i, typed, dom, wirePrefix, url: cap ? cap.url : null });

      // Log as we go: if the sweep runs out of budget partway, the samples it
      // DID take are still evidence.
      const verdict =
        wirePrefix === -1
          ? 'NO-POST'
          : wirePrefix === typed.length
            ? 'full'
            : `SHORT by ${typed.length - wirePrefix}`;
      console.log(
        `[live] rate ${String(rate).padStart(2)}x #${i} | typed ${typed.length} | ` +
          `dom ${dom.length}${dom === typed ? '' : ` MISMATCH "${dom}"`} | wire ${verdict}`,
      );

      currentTyped = '';

      // The aborted create leaves the dialog open; Cancel returns to a clean
      // board for the next sample.
      await tasks.createTaskCancelButton.click();
      await expect(tasks.newTaskTitleInput).toBeHidden({ timeout: 15000 });
    }
  }

  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  console.log('\n=== TM2-T016 wire probe results ===');
  let wireShort = 0;
  let noPost = 0;
  let domShort = 0;

  for (const s of samples) {
    if (s.dom !== s.typed) domShort++;
    if (s.wirePrefix === -1) noPost++;
    else if (s.wirePrefix !== s.typed.length) wireShort++;

    const flag = s.wirePrefix >= 0 && s.wirePrefix !== s.typed.length ? '  <-- DIVERGENCE' : '';
    console.log(
      `rate ${String(s.rate).padStart(2)}x #${s.i} | typed ${s.typed.length} | ` +
        `dom ${s.dom.length} | wire ${s.wirePrefix === -1 ? 'NO-POST' : s.wirePrefix}${flag}`,
    );
  }

  console.log(
    `\nsamples=${samples.length} domShort=${domShort} wireShort=${wireShort} noPost=${noPost}`,
  );
  if (samples.length > 0 && samples[0].url) {
    console.log(`create endpoint: ${samples[0].url}`);
  }

  // The probe reports; it does not gate. A green run here is evidence of
  // absence at these throttle rates, not proof the bug is gone.
  expect(samples.length).toBe(THROTTLE_RATES.length * SAMPLES_PER_RATE);
});
