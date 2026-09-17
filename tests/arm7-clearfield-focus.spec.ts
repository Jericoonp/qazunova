/**
 * TEMPORARY PROBE — TM2-T016 ARM 7. DELETE THIS FILE AFTER THE RUN.
 *
 * WHAT THIS DECIDES
 * -----------------
 * `clearField()` (pages/TasksPage.ts:238, pages/NotesPage.ts:519) is an
 * ELEMENT-scoped read paired with a PAGE-level write:
 *
 *     await locator.selectText();
 *     await this.page.keyboard.press('Backspace');
 *
 * If focus moves between those two round trips, the page-level Backspace
 * deletes the last character of whatever IS focused, leaving the intended
 * target untouched. On a pre-populated input with the caret at the end that is
 * exactly TM2-T016's signature (title silently loses its last character).
 *
 * Arm 5 reproduced that mechanism offline. Arm 6 ran the SAME instrumentation
 * against the real staging dialog, 13 trials, single worker: 0/13 off-target.
 * But arm 6 also proved the PRECONDITION is live — the task edit dialog opens
 * focused on the pre-populated TITLE with the caret at the END, every time.
 * A race that never fires under no load is UNTESTED, not absolved, and
 * TM2-T016 was observed in CI at 3 workers. That is the gap this file closes.
 *
 * THE GATE: does `document.activeElement` at the description clearField's
 * Backspace EVER leave the description textarea, under real CI concurrency?
 *
 * HOW IT IS MEASURED (and why it is built this way)
 * ------------------------------------------------
 *  - State is recorded AT the event, by a capture-phase keydown listener
 *    filtered to Backspace. A sticky "it happened" flag read at the end cannot
 *    distinguish "fired before" from "fired after"; only the event-time read
 *    can.
 *  - The probe PROVES IT ARMED. A silently dead listener reads exactly like a
 *    refutation — on this very ticket it briefly refuted a correct hypothesis.
 *    Every cycle asserts at least one Backspace was actually recorded, so a
 *    dead probe FAILS instead of quietly reporting "all clean".
 *  - It asserts the INVARIANT LAW ("the Backspace lands on the field
 *    selectText() targeted"), not a specific outcome. Asserting an outcome on
 *    both sides of a race makes the probe itself flaky.
 *  - Every observation is printed, so the CI log carries the evidence whether
 *    this passes or fails.
 *
 * `typeAndVerify` retries by calling clearField again, so >1 Backspace per
 * cycle is legitimate. The invariant is that ALL of them are on target.
 */
import { expect, test } from '../utils/testFixtures';
import { DEFAULT_LOGIN_URL } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { TasksPage } from '../pages/TasksPage';
import { TASK_DESCRIPTION, TASK_TITLE, uniqueTitle } from '../utils/tasksTestData';

type BackspaceObservation = {
  tag: string | null;
  placeholder: string | null;
  aria: string | null;
  selStart: number | null;
  selEnd: number | null;
  valLen: number | null;
};

/** Accessible names the two dialog fields are located by (pages/TasksPage.ts:150-151). */
const DESCRIPTION_FIELD = /Enter your task description here/;
const TITLE_FIELD = /Choose a title that defines your Task/;

/** Edit cycles per test. Login is the expensive part; iterations are seconds. */
const CYCLES = 10;

function describes(observation: BackspaceObservation, pattern: RegExp): boolean {
  return pattern.test(observation.placeholder ?? '') || pattern.test(observation.aria ?? '');
}

function render(observation: BackspaceObservation): string {
  const field = describes(observation, DESCRIPTION_FIELD)
    ? 'DESCRIPTION'
    : describes(observation, TITLE_FIELD)
      ? '*** TITLE ***'
      : 'OTHER';
  return `${field} <${observation.tag}> sel=${observation.selStart}-${observation.selEnd} len=${observation.valLen} aria=${JSON.stringify(observation.aria)} ph=${JSON.stringify(observation.placeholder)}`;
}

test.use({ video: 'off', trace: 'off' });

test.describe('ARM7 — clearField focus under CI concurrency', () => {
  // Generous: this pays one login and then CYCLES full edit+save round trips
  // against slow staging, while sharing the box with the rest of the suite.
  test.describe.configure({ timeout: 600000 });

  for (const lane of ['lane-a', 'lane-b', 'lane-c']) {
    test(`clearField Backspace never leaves its target field (${lane})`, async ({ page, account }, testInfo) => {
      // Install BEFORE any navigation so the recorder survives every document.
      await page.addInitScript(() => {
        (window as any).__arm7 = [];
        document.addEventListener(
          'keydown',
          (event) => {
            if ((event as KeyboardEvent).key !== 'Backspace') return;
            const el = document.activeElement as any;
            (window as any).__arm7.push({
              tag: el ? el.tagName : null,
              placeholder: el && el.getAttribute ? el.getAttribute('placeholder') : null,
              aria: el && el.getAttribute ? el.getAttribute('aria-label') : null,
              selStart: el && 'selectionStart' in el ? el.selectionStart : null,
              selEnd: el && 'selectionEnd' in el ? el.selectionEnd : null,
              valLen: el && typeof el.value === 'string' ? el.value.length : null,
            });
          },
          true, // capture phase: read the state AT the event
        );
      });

      const loginPage = new LoginPage(page);
      await loginPage.goto(DEFAULT_LOGIN_URL);
      await loginPage.login(account.username, account.password);
      await loginPage.assertLoginSuccess();

      const tasksPage = new TasksPage(page);
      await tasksPage.open();

      const title = uniqueTitle(`${TASK_TITLE} arm7 ${lane}`);
      await tasksPage.createTask(title, TASK_DESCRIPTION);

      const offTarget: string[] = [];
      const titleDamage: string[] = [];
      let observed = 0;

      try {
        for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
          const before: BackspaceObservation[] = await page.evaluate(() => (window as any).__arm7 ?? []);

          // The arm-5/arm-6 shape: description-only edit. The dialog opens
          // focused on the pre-populated TITLE, then editTask() clicks the
          // description, selectText()s it, and presses Backspace at PAGE level.
          await tasksPage.editTask(title, { description: `arm7 ${lane} cycle ${cycle}` });

          const after: BackspaceObservation[] = await page.evaluate(() => (window as any).__arm7 ?? []);
          const fresh = after.slice(before.length);

          // ARMED? A dead listener must fail loudly, not read as a refutation.
          expect(
            fresh.length,
            `cycle ${cycle}: the capture-phase recorder logged NO Backspace. The probe did not arm — this is a broken instrument, NOT evidence that the race is absent.`,
          ).toBeGreaterThan(0);

          observed += fresh.length;

          for (const observation of fresh) {
            console.log(`[arm7][${lane}] cycle ${cycle}: ${render(observation)}`);
            if (!describes(observation, DESCRIPTION_FIELD)) {
              offTarget.push(`cycle ${cycle}: ${render(observation)}`);
            }
          }

          // The product symptom: did the title lose its last character? The row
          // locator is an EXACT text match, so a truncated title drops to 0.
          const intactTitles = await tasksPage.taskRowTitle(title).count().catch(() => -1);
          if (intactTitles === 0) {
            const truncated = title.slice(0, -1);
            const truncatedCount = await tasksPage.taskRowTitle(truncated).count().catch(() => -1);
            titleDamage.push(
              `cycle ${cycle}: exact title ${JSON.stringify(title)} no longer in the list` +
                (truncatedCount > 0 ? ` — found ${JSON.stringify(truncated)} instead (LAST CHARACTER LOST)` : ''),
            );
          }
        }
      } finally {
        await tasksPage.deleteTaskIfExists(title).catch(() => undefined);
      }

      const summary = [
        `[arm7][${lane}] workerIndex=${testInfo.workerIndex} cycles=${CYCLES} backspaces=${observed}`,
        `[arm7][${lane}] off-target=${offTarget.length} titleDamage=${titleDamage.length}`,
        ...offTarget.map((line) => `[arm7][${lane}] OFF-TARGET ${line}`),
        ...titleDamage.map((line) => `[arm7][${lane}] TITLE-DAMAGE ${line}`),
      ].join('\n');
      console.log(summary);
      testInfo.annotations.push({ type: 'arm7', description: summary });

      // Sanity: the run must have observed roughly one Backspace per cycle.
      expect(observed, `${lane}: recorded ${observed} Backspaces across ${CYCLES} cycles`).toBeGreaterThanOrEqual(CYCLES);

      // THE INVARIANT: the page-level Backspace must land on the field that
      // selectText() targeted. A violation here IS TM2-T016 reproduced.
      expect(offTarget, `${lane}: clearField's Backspace fired while a DIFFERENT field held focus`).toEqual([]);
      expect(titleDamage, `${lane}: the task title changed during a description-only edit`).toEqual([]);
    });
  }
});
