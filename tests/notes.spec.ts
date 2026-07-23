import path from 'path';
import { expect, test } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_PASSWORD, VALID_USERNAME } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { NotesPage } from '../pages/NotesPage';
import {
  LONG_CONTENT,
  LONG_TITLE,
  NOTE_CONTENT,
  NOTE_TITLE,
  UPDATED_NOTE_CONTENT,
  UPDATED_NOTE_TITLE,
  uniqueTitle,
} from '../utils/notesTestData';

function buildScreenshotPath(testInfo: any, outcome: 'passed' | 'failed') {
  const safeName = `${testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  return path.resolve(process.cwd(), 'screenshots', outcome, safeName);
}

/**
 * IMPORTANT: every test in this file reads/writes the Notes list of the
 * SAME shared staging account. Playwright's default config runs tests in
 * this file across multiple parallel workers, and since they all mutate
 * one shared server-side list, that causes cross-test collisions (e.g. the
 * empty-state test observing a note another worker just created) that show
 * up as flaky, non-deterministic failures. Always run this file with a
 * single worker: `npm run test:notes` (which passes --workers=1) or
 * `npx playwright test tests/notes.spec.ts --workers=1`.
 */
test.use({ video: 'off', trace: 'off' });

test.describe('Notes module automation', () => {
  // The staging environment is noticeably slow (page loads and network
  // round-trips routinely take several seconds), and every test here drives
  // its own fresh login (no shared storage state) through NotesPage.open(),
  // which on CI reliably has to dismiss the "Enter Zunou" welcome screen and
  // product tour first -- tests/pulse.spec.ts on main hit the same combined
  // cost and independently settled on the same 90s budget ("Login + the
  // onboarding tour dismissal alone can take 15-20s on CI runners, leaving
  // too little of the default 30s test timeout for [the rest of the test]").
  // Individual tests that need still more (e.g. typing a long string) add
  // their own extra budget on top via testInfo.setTimeout().
  test.describe.configure({ timeout: 90000 });

  let notesPage: NotesPage;
  // Titles created during a test are tracked here so afterEach can clean
  // them up, keeping the shared staging account free of leftover data.
  let createdTitles: string[];

  test.beforeAll(async ({ browser }) => {
    // Bulk-deleting an unknown number of leftover notes (e.g. from a prior
    // interrupted run) does not reliably fit in a single test's 90s budget
    // -- confirmed live: with 20 leftover notes in the shared account, the
    // "empty state" test's own deleteAllNotes() call ran out of its test
    // timeout partway through and left notes behind. Guaranteeing a clean
    // slate once, up front, for the whole suite (with its own much larger
    // timeout) means no single test has to absorb an unpredictable amount
    // of pre-existing mess on top of its own work.
    test.setTimeout(300000);

    const context = await browser.newContext();
    const page = await context.newPage();

    const loginPage = new LoginPage(page);
    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await loginPage.assertLoginSuccess();

    const cleanupNotesPage = new NotesPage(page);
    await cleanupNotesPage.open();
    await cleanupNotesPage.deleteAllNotes();

    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    createdTitles = [];

    // Reuse the existing login page object/fixture data instead of duplicating auth logic.
    const loginPage = new LoginPage(page);
    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await loginPage.assertLoginSuccess();

    // Enter the workspace and land on the Notes section via the sidebar.
    notesPage = new NotesPage(page);
    await notesPage.open();
  });

  test.afterEach(async ({ page }, testInfo) => {
    // If the test failed while a note dialog was open in an invalid state
    // (e.g. an empty title), the dialog blocks both Escape and a backdrop
    // click -- it won't close until the field is valid again. Rather than
    // fight the app's own close semantics, just reload back to a clean list
    // view before attempting cleanup, otherwise deleteNoteIfExists() hangs
    // for the full hook timeout trying to click a note card hidden behind
    // the stuck dialog's backdrop.
    await notesPage.reload().catch(() => undefined);

    // Best-effort teardown: remove any notes this test created. Cleanup
    // failures are logged rather than silently swallowed -- a swallowed
    // failure here means the note is left behind in the shared staging
    // account, which then breaks other tests (e.g. the empty-state check,
    // or strict-mode locator matches against duplicate content text).
    for (const title of createdTitles) {
      await notesPage.deleteNoteIfExists(title).catch((error) => {
        console.warn(`[notes.spec] afterEach cleanup failed for "${title}":`, error?.message ?? error);
      });
    }

    if (testInfo.status === 'passed') {
      return;
    }

    const screenshotPath = buildScreenshotPath(testInfo, 'failed');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('notes-page-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test.describe('Navigation', () => {
    test('Notes page loads successfully from the sidebar', async () => {
      // beforeEach already navigated to Notes; assert the landmark heading and empty state.
      await notesPage.assertNotesPageLoaded();
    });

    test('Create Note ("Take a Note") button exists', async () => {
      await expect(notesPage.takeNoteButton).toBeVisible();
    });

    /**
     * Used to assume the shared staging account already happened to be
     * empty when the suite started, which made it depend on every other
     * test's afterEach cleanup having fully succeeded first (including the
     * delete's server-side persistence -- see DELETE_PERSIST_SETTLE_MS in
     * NotesPage.ts) -- a single flaky cleanup anywhere left this failing
     * against unrelated leftover notes. Now self-contained: if notes
     * already exist (the suite-level beforeAll should have cleared them,
     * but this doesn't rely on that), delete them first; either way, the
     * empty-state assertion holds regardless of what any other run left
     * behind. The branch is explicit here (rather than just always calling
     * deleteAllNotes(), which already no-ops when the list is empty) so a
     * failure clearly shows which path was taken.
     */
    test('empty state is displayed when no notes exist', async () => {
      if (await notesPage.hasAnyNotes()) {
        await notesPage.deleteAllNotes();
      }

      // Explicit generous timeout (matching every other list-affecting
      // assertion in this file) rather than Playwright's 5000ms default --
      // the list needs a moment to re-render into the empty view right
      // after the last deletion above, and 5s isn't always enough on this
      // environment. Latent before (nothing deleted immediately prior to
      // this assertion), only surfaced once this test started actively
      // clearing notes right before checking.
      await expect(notesPage.emptyState).toBeVisible({ timeout: 15000 });
      await expect(notesPage.page.getByText('Notes you add will appear here', { exact: true })).toBeVisible({
        timeout: 15000,
      });
    });
  });

  test.describe('Create', () => {
    test('user can create a note with a valid title and content', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      createdTitles.push(title);

      // Step 1: open the composer and fill in title + content.
      await notesPage.createNote(title, NOTE_CONTENT);

      // Step 2: a success toast confirms the create request succeeded.
      await notesPage.assertToastMessage(/note created successfully/i);

      // Step 3: the new note appears in the list with its title and content preview.
      await notesPage.assertNoteVisible(title);
      await expect(notesPage.noteCardContent(title, NOTE_CONTENT)).toBeVisible({ timeout: 15000 });
    });

    test('newly created note persists after refreshing the page', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      createdTitles.push(title);

      await notesPage.createNote(title, NOTE_CONTENT);
      await notesPage.assertNoteVisible(title);

      // Reload and confirm the note was actually persisted server-side, not just in local state.
      await notesPage.reload();
      await notesPage.assertNoteVisible(title);
    });

    test('user cannot save a completely empty note', async () => {
      // Open the composer but leave both title and content blank.
      await notesPage.startNewNote();

      // The app disables Save until a title is provided; no error toast is shown.
      await notesPage.assertSaveDisabled();
    });

    test('user cannot save a note without a title (content only)', async () => {
      await notesPage.startNewNote();
      await notesPage.fillContent('Content without a title.');

      // Title is the required field; Save remains disabled with content-only input.
      await notesPage.assertSaveDisabled();
    });

    /**
     * Documented deviation from the originally assumed spec: on this build,
     * a note CAN be saved with a title and no content (content is optional).
     * Verified live via Playwright MCP inspection on 2026-07-21 — the Save
     * button enables as soon as a title is entered, and the note saves
     * successfully with an empty body ("Missing content" indicator shown).
     */
    test('user can save a note with a title and no content (content is optional)', async () => {
      const title = uniqueTitle(`${NOTE_TITLE} Title Only`);
      createdTitles.push(title);

      await notesPage.createNote(title);

      await notesPage.assertToastMessage(/note created successfully/i);
      await notesPage.assertNoteVisible(title);
    });

    test('long title and content input is handled without error', async ({}, testInfo) => {
      // Typing ~1.8k characters via real keystrokes (required for the Quill
      // editor to register the change) takes longer than the default timeout.
      testInfo.setTimeout(testInfo.timeout + 30000);

      const title = uniqueTitle(LONG_TITLE);
      createdTitles.push(title);

      await notesPage.createNote(title, LONG_CONTENT);

      // Large input should save successfully and the full title text should
      // remain present in the DOM even though the UI visually clips it (MuiTypography noWrap).
      await notesPage.assertToastMessage(/note created successfully/i);
      await notesPage.assertNoteVisible(title);
    });
  });

  test.describe('Read', () => {
    test('user can open an existing note and see the correct title and content', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      createdTitles.push(title);
      await notesPage.createNote(title, NOTE_CONTENT);

      // Step 1: open the note from the list.
      await notesPage.openNote(title);

      // Step 2: verify the dialog reflects the exact saved title and content.
      await expect(notesPage.dialogTitleInput()).toHaveValue(title, { timeout: 15000 });
      await expect(notesPage.dialogContentEditor()).toHaveText(NOTE_CONTENT, { timeout: 15000 });
      await notesPage.assertLastEditedTimestampVisible();
    });

    test('notes persist and remain readable after a page refresh', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      createdTitles.push(title);
      await notesPage.createNote(title, NOTE_CONTENT);

      await notesPage.reload();

      await notesPage.openNote(title);
      await expect(notesPage.dialogTitleInput()).toHaveValue(title, { timeout: 15000 });
      await expect(notesPage.dialogContentEditor()).toHaveText(NOTE_CONTENT, { timeout: 15000 });
    });

    test('a large note renders its full content correctly when opened', async ({}, testInfo) => {
      testInfo.setTimeout(testInfo.timeout + 30000);

      const title = uniqueTitle(`${NOTE_TITLE} Large`);
      createdTitles.push(title);
      await notesPage.createNote(title, LONG_CONTENT);

      await notesPage.openNote(title);

      await expect(notesPage.dialogContentEditor()).toHaveText(LONG_CONTENT, { timeout: 15000 });
    });

    /**
     * Assumption (not fully confirmed live with 2+ notes during exploration):
     * the most recently created note is rendered at the top of the list.
     * If this assumption is wrong, this test will fail fast and should be
     * corrected to match the actual ordering rule (e.g. oldest-first).
     */
    test('notes appear in the correct (most-recent-first) order', async () => {
      const firstTitle = uniqueTitle(`${NOTE_TITLE} First`);
      const secondTitle = uniqueTitle(`${NOTE_TITLE} Second`);
      createdTitles.push(firstTitle, secondTitle);

      await notesPage.createNote(firstTitle, NOTE_CONTENT);
      await notesPage.createNote(secondTitle, NOTE_CONTENT);

      // allTextContents() is a one-shot DOM snapshot -- it does not wait for
      // the list to finish re-rendering after the second create like every
      // other read in this file does. Poll instead of reading once, so a
      // still-settling list doesn't read as "Second is missing".
      await expect(async () => {
        const titles = await notesPage.page.getByText(/Automation Test Note (First|Second)/).allTextContents();
        const firstIndex = titles.findIndex((t) => t.includes('Second'));
        const secondIndex = titles.findIndex((t) => t.includes('First'));

        expect(firstIndex).toBeGreaterThanOrEqual(0);
        expect(secondIndex).toBeGreaterThan(firstIndex);
      }).toPass({ timeout: 15000 });
    });
  });

  test.describe('Update', () => {
    test('user can edit the title of an existing note', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      const updatedTitle = uniqueTitle(UPDATED_NOTE_TITLE);
      createdTitles.push(title, updatedTitle);

      await notesPage.createNote(title, NOTE_CONTENT);

      await notesPage.editNote(title, { title: updatedTitle });

      await notesPage.assertToastMessage(/note updated successfully/i);
      await notesPage.assertNoteVisible(updatedTitle);
      await notesPage.assertNoteNotVisible(title);
    });

    test('user can edit the content of an existing note', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      createdTitles.push(title);

      await notesPage.createNote(title, NOTE_CONTENT);

      await notesPage.editNote(title, { content: UPDATED_NOTE_CONTENT });

      await notesPage.assertToastMessage(/note updated successfully/i);
      await expect(notesPage.noteCardContent(title, UPDATED_NOTE_CONTENT)).toBeVisible({ timeout: 15000 });
    });

    test('updated title and content persist after refreshing the page', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      const updatedTitle = uniqueTitle(UPDATED_NOTE_TITLE);
      createdTitles.push(title, updatedTitle);

      await notesPage.createNote(title, NOTE_CONTENT);
      await notesPage.editNote(title, { title: updatedTitle, content: UPDATED_NOTE_CONTENT });

      await notesPage.reload();

      await notesPage.openNote(updatedTitle);
      await expect(notesPage.dialogTitleInput()).toHaveValue(updatedTitle, { timeout: 15000 });
      await expect(notesPage.dialogContentEditor()).toHaveText(UPDATED_NOTE_CONTENT, { timeout: 15000 });
    });

    test('user cannot save an existing note after clearing its title', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      createdTitles.push(title);
      await notesPage.createNote(title, NOTE_CONTENT);

      await notesPage.openNote(title);
      await notesPage.clearDialogTitle();

      // Same required-title validation rule applies inside the edit dialog.
      // Disabling is not instantaneous on this environment -- give it room.
      await expect(notesPage.dialogSaveButton()).toBeDisabled({ timeout: 10000 });
    });
  });

  test.describe('Delete', () => {
    test('confirmation modal appears when deleting a note', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      createdTitles.push(title);
      await notesPage.createNote(title, NOTE_CONTENT);

      await notesPage.openNote(title);
      await notesPage.dialogDeleteButton().click();

      await expect(notesPage.deleteConfirmationHeading).toBeVisible();
      await expect(notesPage.page.getByText('This action cannot be undone.', { exact: true })).toBeVisible();

      // Leave the note intact for afterEach cleanup by cancelling here.
      await notesPage.deleteConfirmationCancelButton.click();
    });

    test('user can cancel a delete and the note remains', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      createdTitles.push(title);
      await notesPage.createNote(title, NOTE_CONTENT);

      await notesPage.deleteNoteThenCancel(title);

      await notesPage.assertNoteVisible(title);
    });

    test('user can confirm deletion and the note disappears from the list', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      await notesPage.createNote(title, NOTE_CONTENT);

      await notesPage.deleteNote(title);

      // Confirmed via live inspection: the note is removed immediately on confirm.
      await notesPage.assertNoteNotVisible(title);
    });

    test('refreshing the page does not restore a deleted note', async () => {
      const title = uniqueTitle(NOTE_TITLE);
      await notesPage.createNote(title, NOTE_CONTENT);

      await notesPage.deleteNote(title);
      await notesPage.assertNoteNotVisible(title);

      await notesPage.reload();

      await notesPage.assertNoteNotVisible(title);
    });
  });
});
