/**
 * TM2-T016 arm 5 -- HARNESS PRIMITIVE probe. NOT part of the suite, do not merge.
 *
 * WHAT THIS MEASURES, AND WHY IT IS NOT A FOURTH LOCAL SWEEP
 * ---------------------------------------------------------
 * Arms 1-3 (7 Sep) swept CPU throttling against the CREATE path: 56 samples,
 * zero truncation, and the standing conclusion that local *statistical*
 * reproduction is a dead end. Arm 4 (17 Sep) asked a STRUCTURAL question about
 * the save request's shape and found the prerequisite the ticket needed: a
 * description-only save really does re-send the title.
 *
 * Arm 5 is structural too, and it does not touch the product at all. It asks
 * whether the TEST HARNESS is capable of producing the reported signature:
 *
 *     Can `TasksPage.clearField()` delete exactly one character from the END
 *     of a field it was never pointed at?
 *
 * The suspicion comes from reading the primitive:
 *
 *     private async clearField(locator: Locator) {
 *       await locator.selectText();
 *       await this.page.keyboard.press('Backspace');
 *     }
 *
 * `locator.selectText()` is scoped to the element. `page.keyboard.press()` is
 * NOT -- it dispatches to whatever holds focus at that moment, and the two are
 * separate round trips. So the primitive carries an implicit assumption: that
 * nothing moves focus in the window between them. If something does, the
 * Backspace lands on the newly-focused element with a collapsed caret, which
 * on a pre-populated input deletes its LAST CHARACTER.
 *
 * That matters for `editTask(existing, { description })` specifically, because
 * when `updates.title` is undefined the title branch is SKIPPED -- the title
 * input is left populated and untouched, and is exactly the kind of element a
 * late dialog autofocus lands on.
 *
 * NO NETWORK, NO STAGING ACCOUNT. The page under test is a synthetic
 * `data:`-free local fixture served from memory, so this can run while a CI
 * suite is using the shared staging account -- which arms 1-4 could not.
 *
 * HOW TO READ THE RESULT
 * ----------------------
 *   Arm A (control, focus stays put)
 *       desc cleared, title untouched -> the primitive is correct when its
 *       implicit assumption holds. This is the arm that makes B meaningful:
 *       without it, a broken fixture would "reproduce" anything.
 *
 *   Arm B (focus moves between selectText and the Backspace)
 *       title one character short, desc UNTOUCHED -> the harness can produce
 *       TM2-T016's exact signature with the product entirely absent.
 *
 *   Arm C (same steal, but updates.title is also provided)
 *       title correct -> explains the differential the ticket leans on:
 *       `:244` retypes and verifies the title, so it repairs this damage;
 *       `:257` does not, so it persists it.
 *
 * WHAT A PASS HERE DOES **NOT** PROVE
 * -----------------------------------
 * It does not prove the product's Edit dialog moves focus in that window. It
 * proves the harness is CAPABLE of the signature, which is a different and
 * weaker claim -- but it is a measured one, and it is enough to stop treating
 * "the DOM held the full title at save time" as an exoneration of the harness.
 * Confirming the steal in the real dialog needs the staging account.
 */
import { expect, test } from '@playwright/test';

test.use({ video: 'off', trace: 'off', baseURL: undefined });

/** The exact failing shape from the 6 Aug log: 38 characters. */
const TITLE = 'Automation Test Task 1785960067060-669';
const DESCRIPTION = 'probe: original description';

/**
 * A deliberately minimal stand-in for the Edit dialog: a pre-populated title
 * input the test never means to touch, and a description input it does.
 *
 * `stealFocus` models a late autofocus (MUI focuses its dialog's first field
 * on transition-end, not on mount). It is armed off the description's `select`
 * event -- i.e. it fires the instant `selectText()` runs -- so the steal lands
 * in the window between the two round trips deterministically, instead of
 * depending on a wall-clock delay that would make this a flaky sweep.
 */
function fixture(stealFocus: boolean): string {
  return `<!doctype html>
<html><body>
  <input id="title" value="${TITLE}">
  <input id="desc" value="${DESCRIPTION}">
  <script>
    // IIFE, not top-level const: each arm re-runs setContent against the same
    // page, and a redeclared top-level \`const\` throws a SyntaxError that kills
    // the whole script silently -- which is exactly how the first cut of this
    // probe registered no listener and produced a false NEGATIVE on arm B.
    (function () {
      var title = document.getElementById('title');
      var desc = document.getElementById('desc');
      window.__armed = ${stealFocus};
      // Which element actually RECEIVED each Backspace. A sticky "the steal
      // ran" flag is useless here: read at the end of the arm it cannot
      // distinguish "fired before the keypress" from "fired after", and the
      // whole question is which side of the keypress it landed on.
      // BACKSPACE ONLY. Recording every keydown picks up the title branch's 38
      // retyping keystrokes, so "the last keydown" is not the clearField one.
      window.__keydownOn = [];
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Backspace') return;
        window.__keydownOn.push(document.activeElement ? document.activeElement.id : null);
      }, true);
      if (${stealFocus}) {
        desc.addEventListener('select', function () {
          // setTimeout(0) resolves before the next CDP message arrives, so this
          // always precedes the page-level keypress.
          setTimeout(function () {
            title.focus();
            // Collapsed caret at the end -- what a focus() on a populated input
            // gives you, and what makes a Backspace delete the LAST character.
            title.setSelectionRange(title.value.length, title.value.length);
          }, 0);
        });
      }
    })();
  </script>
</body></html>`;
}

/** Verbatim copy of TasksPage.clearField() -- the primitive under test. */
async function clearField(page: import('@playwright/test').Page, selector: string) {
  await page.locator(selector).selectText();
  await page.keyboard.press('Backspace');
}

/**
 * Replays `editTask()`'s branch structure. `doTitle` / `doDescription` mirror
 * `updates.title !== undefined` / `updates.description !== undefined` -- which
 * is the whole point: the two spec lines differ ONLY in which branches run.
 */
async function runArm(
  page: import('@playwright/test').Page,
  { stealFocus, doTitle, doDescription }: { stealFocus: boolean; doTitle: boolean; doDescription: boolean }
) {
  await page.setContent(fixture(stealFocus));

  // editTask()'s title branch: clear, then retype.
  if (doTitle) {
    await clearField(page, '#title');
    await page.locator('#title').pressSequentially(TITLE, { delay: 1 });
  }

  // editTask()'s description branch: click, then clearField.
  if (doDescription) {
    await page.locator('#desc').click();
    await clearField(page, '#desc');
  }

  return {
    title: await page.locator('#title').inputValue(),
    desc: await page.locator('#desc').inputValue(),
    // Proves the fixture actually armed, so a clean arm means "no damage"
    // rather than "the listener never ran" -- the false negative that bit the
    // first cut of this probe.
    armed: await page.evaluate(() => (window as any).__armed === true),
    /**
     * The id of the element focused when the DESCRIPTION branch's Backspace was
     * delivered, or null if that branch did not run. The title branch's own
     * clearField Backspace legitimately targets the title, so it is excluded:
     * only the description branch's stray Backspace is the defect under test.
     */
    descBackspaceLandedOn: doDescription
      ? await page.evaluate(() => {
          const log = (window as any).__keydownOn as string[];
          return log.length ? log[log.length - 1] : null;
        })
      : null,
  };
}

test('TM2-T016 arm 5: can clearField() damage a field it was never pointed at?', async ({ page }) => {
  // A: control -- description-only edit, nothing steals focus.
  const a = await runArm(page, { stealFocus: false, doTitle: false, doDescription: true });
  // B: models tasks.spec.ts:257 -- description-only edit, focus stolen.
  const b = await runArm(page, { stealFocus: true, doTitle: false, doDescription: true });
  // C: models tasks.spec.ts:244 -- TITLE-only edit. The description branch
  //    never runs, so the damaging clearField never happens.
  const c = await runArm(page, { stealFocus: true, doTitle: true, doDescription: false });
  // D: both branches -- shows retyping the title FIRST does not protect it
  //    from a steal that fires during the LATER description clearField.
  const d = await runArm(page, { stealFocus: true, doTitle: true, doDescription: true });

  const report = {
    titleLength: TITLE.length,
    armA_control_descOnly: { ...a, titleLen: a.title.length },
    armB_descOnly_stolen: { ...b, titleLen: b.title.length },
    armC_titleOnly_stolen: { ...c, titleLen: c.title.length },
    armD_bothBranches_stolen: { ...d, titleLen: d.title.length },
    armB_lostExactlyLastChar: b.title === TITLE.slice(0, -1),
  };
  // eslint-disable-next-line no-console
  console.log('TM2-T016 arm 5:\n' + JSON.stringify(report, null, 2));

  expect(a.armed, 'ARM A must NOT be armed').toBe(false);

  // Arm A: the primitive is correct when nothing moves focus. Without this the
  // fixture could be rigged and arm B would mean nothing.
  expect(a.descBackspaceLandedOn, 'ARM A control: the Backspace goes to the description').toBe('desc');
  expect(a.title, 'ARM A control: title must be untouched').toBe(TITLE);
  expect(a.desc, 'ARM A control: description must be cleared').toBe('');

  // Arm C: why :244 passes and :257 does not -- :244 passes ONLY the title, so
  // editTask()'s description branch (and its damaging clearField) never runs.
  expect(c.title, 'ARM C: a title-only edit leaves the title correct').toBe(TITLE);

  // ---------------------------------------------------------------------
  // THE LAW. This is the real finding, and unlike a specific race outcome it
  // holds on every run: `clearField` damages whichever element is focused when
  // the page-level Backspace is delivered, NOT the locator it was given.
  //
  // Arms B and D are the SAME race with different amounts of preceding work,
  // and they land on different sides of it -- which is the point. The steal is
  // a genuine race, so asserting "arm D always loses a character" would itself
  // be a flaky test. Assert the invariant instead.
  // ---------------------------------------------------------------------
  for (const [name, arm] of [
    ['A', a],
    ['B', b],
    ['D', d],
  ] as const) {
    if (arm.descBackspaceLandedOn === 'title') {
      expect(arm.title, `ARM ${name}: Backspace landed on the title -> it loses its LAST character`).toBe(
        TITLE.slice(0, -1)
      );
      expect(arm.desc, `ARM ${name}: ...and the description it was aimed at is UNTOUCHED`).toBe(DESCRIPTION);
    }
  }

  // And the window must be genuinely reachable, or none of the above means
  // anything. At least one armed arm has to have landed the Backspace on the
  // field clearField was never pointed at.
  const landedOnTitle = [b, d].filter((arm) => arm.descBackspaceLandedOn === 'title');
  expect(
    landedOnTitle.length,
    'the steal window must be reachable at least once, or this probe proves nothing'
  ).toBeGreaterThan(0);
});
