/**
 * TM2-T016 SAVE probe (arm 4) -- NOT part of the suite, do not merge.
 *
 * WHY THIS ARM EXISTS, AND WHY IT IS NOT A REPEAT OF THE DEAD END
 * --------------------------------------------------------------
 * Arms 1-3 (7 Sep) swept CPU throttling against the CREATE path and came back
 * clean in all 56 samples. That sweep is over; a fourth *sweep* is not
 * recommended and this is not one.
 *
 * On 17 Sep the ticket's premise inverted. The recovered 6 Aug run log stacks
 * both failures at `tasks.spec.ts:264:25 -> TasksPage.openTask:353`, with ZERO
 * frames from `editTask`. Since `editTask()`'s FIRST statement is
 * `openTask(existingTitle)` -- which matches the full title twice with
 * `exact: true` -- the complete title was demonstrably in the DOM immediately
 * BEFORE the description edit, and unmatchable immediately AFTER its save.
 *
 * So the crime scene is the UPDATE/SAVE request, which no arm has ever
 * measured. And the question here is STRUCTURAL, not statistical:
 *
 *     When the user edits ONLY the description, does the client re-send the
 *     title at all -- and if so, does it send it whole?
 *
 * That is answerable in a handful of deterministic observations rather than a
 * 56-sample throttle sweep, because it is a question about the request's
 * SHAPE. The Edit dialog renders a title input pre-populated with the existing
 * title (`panelDialogTitleInput`, visible in `editTask()` even when only
 * `updates.description` is passed), so a re-serialised title on save is
 * structurally plausible -- that is precisely what this measures.
 *
 * HOW TO READ THE RESULT
 * ----------------------
 *   title ABSENT from the save body
 *       -> the client does not re-send the title on a description-only edit.
 *          The client is exonerated on the update path too, and the lost
 *          character must come from the server or the read-back. Major
 *          narrowing; kills the stale-component-state family outright.
 *
 *   wirePrefix === title.length
 *       -> the client re-sends the title, and sends it WHOLE. Guilt moves to
 *          the server's handling of the update, or to the read-back.
 *
 *   wirePrefix === title.length - 1
 *       -> SMOKING GUN. The client re-serialises the title one character short
 *          on save. This is the stale-state mechanism the ticket hypothesises,
 *          caught on the path the evidence actually points at.
 *
 * The response body is measured the same way, which separates "server received
 * it whole and echoed it short" from "server echoed what it got".
 *
 * Measuring a longest-prefix rather than parsing JSON keeps this agnostic to
 * the request shape (REST body, GraphQL variables and form encoding all work),
 * the same choice arm 2 made.
 *
 * DESTRUCTIVE? Yes, minimally and with cleanup: unlike arm 2 this CANNOT abort
 * the request, because the whole point is to observe what the server echoes.
 * Each sample creates one task and deletes it in a finally block.
 *
 * SHARED STAGING ACCOUNT: there is exactly one local account
 * (LOGIN_TEST_USER). Never run this while a CI suite is in flight.
 */
import { expect, test } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_PASSWORD, VALID_USERNAME } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { TasksPage } from '../pages/TasksPage';

test.use({ video: 'off', trace: 'off' });

/**
 * Deterministic structural question -> few samples. Overridable, but resist
 * turning this back into a sweep: arms 1-3 already proved a sweep answers
 * nothing here.
 */
const SAMPLES = Number(process.env.PROBE_SAMPLES ?? 3);

/** Distinctive enough that only the save request body can contain it. */
const PROBE_DESCRIPTION_MARKER = 'tm2t016-arm4';
const PROBE_UPDATED_DESCRIPTION = `probe updated description ${PROBE_DESCRIPTION_MARKER}`;

/**
 * The exact failing shape from the 6 Aug log: `Automation Test Task ` + 13
 * digits + `-` + 3 digits = 38 characters. Reproduced verbatim so the probe
 * exercises the same length and character classes as the failure.
 */
function failingShapeTitle(i: number): string {
  const ms = String(Date.now()).padStart(13, '0').slice(0, 13);
  const suffix = String((i * 137 + 669) % 1000).padStart(3, '0');
  return `Automation Test Task ${ms}-${suffix}`;
}

/** Longest prefix of `needle` that appears anywhere in `haystack`. */
function longestPrefixPresent(haystack: string, needle: string): number {
  // Walk down from the full string; the first hit is the longest.
  for (let len = needle.length; len > 0; len--) {
    if (haystack.includes(needle.slice(0, len))) return len;
  }
  return 0;
}

type Captured = { body: string; method: string; url: string; response: string };

type Sample = {
  i: number;
  title: string;
  /** Longest prefix of the title in the SAVE request body; 0 = absent. */
  wirePrefix: number;
  /** Longest prefix of the title in the SAVE response body; 0 = absent. */
  respPrefix: number;
  method: string | null;
  url: string | null;
  /** What the list actually rendered after the save. */
  renderedFull: boolean;
};

test('TM2-T016 arm 4: does a description-only SAVE re-send the title, and is it whole?', async ({ page }) => {
  // Nav budget first -- TasksPage.open()'s final click is unbounded, and on an
  // earlier probe a stale locator burned the whole timeout at the sidebar and
  // produced zero samples.
  test.setTimeout(180000);

  const login = new LoginPage(page);
  await login.goto(DEFAULT_LOGIN_URL);
  await login.login(VALID_USERNAME, VALID_PASSWORD);

  const tasks = new TasksPage(page);
  await tasks.open();

  // Reached the board -- restart the clock with the budget the samples need.
  test.setTimeout(1800000);

  const samples: Sample[] = [];

  for (let i = 0; i < SAMPLES; i++) {
    const title = failingShapeTitle(i);

    // Only the save that carries THIS title is interesting. A prefix long
    // enough to be unique but short enough to survive a one-character loss.
    const marker = title.slice(0, 12);

    let captured: Captured | null = null;

    const onResponse = async (response: import('@playwright/test').Response) => {
      if (captured) return;
      const req = response.request();
      const method = req.method();
      if (method !== 'PUT' && method !== 'PATCH' && method !== 'POST') return;

      const body = req.postData() ?? '';
      // The description we just typed is what makes this the SAVE call; the
      // title alone would also match the create. Require the description.
      if (!body.includes(PROBE_DESCRIPTION_MARKER)) return;

      const responseBody = await response.text().catch(() => '');
      captured = { body, method, url: req.url(), response: responseBody };
    };

    await tasks.createTask(title, 'probe: original description');

    try {
      // Mirrors editTask()'s first statement, and is the step that PROVED the
      // title was intact after create in the 6 Aug failures. If this throws,
      // the loss happened at create after all and the ticket's inversion is
      // wrong -- which is itself a result worth having.
      await tasks.openTask(title);
      await tasks.closePanel();

      page.on('response', onResponse);
      await tasks.editTask(title, { description: PROBE_UPDATED_DESCRIPTION });
      page.off('response', onResponse);

      const renderedFull = await tasks
        .taskRowTitle(title)
        .isVisible()
        .catch(() => false);

      // `captured` is only ever assigned inside the response callback, so TS's
      // control-flow analysis narrows it to `null` here and would reject every
      // property read below. The cast restores the declared type.
      const cap = captured as Captured | null;

      samples.push({
        i,
        title,
        wirePrefix: cap ? longestPrefixPresent(cap.body, title) : -1,
        respPrefix: cap ? longestPrefixPresent(cap.response, title) : -1,
        method: cap?.method ?? null,
        url: cap?.url ?? null,
        renderedFull,
      });
    } finally {
      page.off('response', onResponse);
      // Clean up whichever title actually exists -- the full one, or the
      // one-short one if the defect just fired.
      await tasks.deleteTaskIfExists(title).catch(() => {});
      await tasks.deleteTaskIfExists(title.slice(0, -1)).catch(() => {});
    }
  }

  // eslint-disable-next-line no-console
  console.log('TM2-T016 arm 4 samples:\n' + JSON.stringify(samples, null, 2));

  const measured = samples.filter((s) => s.wirePrefix !== -1);
  // eslint-disable-next-line no-console
  console.log(
    `TM2-T016 arm 4 VERDICT: ${measured.length}/${samples.length} saves captured; ` +
      `title on wire: ${measured.map((s) => `${s.wirePrefix}/${s.title.length}`).join(', ') || 'ABSENT'}`
  );

  // The probe's job is to MEASURE, not to grade the product. It fails only if
  // it captured nothing at all, which would mean the interception is wrong
  // rather than the product.
  expect(samples.length, 'probe produced no samples').toBeGreaterThan(0);
});
