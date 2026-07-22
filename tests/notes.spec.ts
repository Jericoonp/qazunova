import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
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

// Gitignored (see playwright/.auth/ in .gitignore) -- never committed.
const AUTH_STATE_PATH = path.resolve(process.cwd(), 'playwright/.auth/notes-user.json');

/**
 * Signs in through the real UI once and persists the resulting cookies/
 * localStorage to AUTH_STATE_PATH so every test in this file can start
 * already authenticated via `storageState` instead of repeating the Auth0
 * login flow. Runs in a throwaway context/page so it never interferes with
 * the context Playwright builds for the tests themselves.
 *
 * The state is deliberately captured only AFTER fully landing on the Notes
 * page, not right after the login form disappears. `assertLoginSuccess()`
 * only proves the login form is gone -- on this Auth0-backed SPA the actual
 * session (silent-auth token exchange, workspace/pulse resolution, etc.)
 * can still be settling for a moment after that, and capturing storageState
 * mid-race previously produced a file that looked present but replayed as
 * logged-out on the very next test. Only snapshotting once the Notes page
 * itself has loaded guarantees the saved session is one that has already
 * proven it works.
 */
async function authenticateAndSaveState(page: Page) {
  const loginPage = new LoginPage(page);
  await loginPage.goto(DEFAULT_LOGIN_URL);
  await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
  await loginPage.assertLoginSuccess();

  const notesPage = new NotesPage(page);
  await notesPage.open();

  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });
  const state = await page.context().storageState({ path: AUTH_STATE_PATH });

  // Fail fast and loud if the captured state has nothing auth-shaped in it,
  // rather than letting every downstream test fail later with a confusing
  // "logged out" symptom traced back to a silently-broken auth file.
  if (state.cookies.length === 0 && state.origins.every((origin) => origin.localStorage.length === 0)) {
    throw new Error(
      `authenticateAndSaveState: captured storage state at ${AUTH_STATE_PATH} has no cookies or localStorage -- login likely did not actually persist a session.`
    );
  }
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
 *
 * That single-worker constraint is also what makes the shared-login
 * optimization below safe: `beforeAll` authenticates exactly once per
 * worker and every test in the file reuses that one session via
 * `storageState`, instead of driving the Auth0 form on every single test.
 */
test.use({ video: 'off', trace: 'off' });

test.describe('Notes module automation', () => {
  // The staging environment is noticeably slow (page loads and network
  // round-trips routinely take several seconds), so this file's default
  // per-test timeout is raised above Playwright's 30s default to give the
  // widened waits in NotesPage room to actually resolve instead of being
  // killed mid-wait. Individual tests that need still more (e.g. typing a
  // long string) add their own extra budget on top via testInfo.setTimeout().
  test.describe.configure({ timeout: 60000 });

  // Every test in this describe starts from the session captured by
  // beforeAll below instead of an empty/unauthenticated context.
  test.use({ storageState: AUTH_STATE_PATH });

  let notesPage: NotesPage;
  // Titles created during a test are tracked here so afterEach can clean
  // them up, keeping the shared staging account free of leftover data.
  let createdTitles: string[];

  test.beforeAll(async ({ browser }) => {
    // Deliberately not the `page`/`context` fixtures used by the tests --
    // this needs its own short-lived, storageState-free context so it
    // performs one real login and captures a clean session, rather than
    // reusing (or polluting) any test's context. `browser.newContext()`
    // inherits the describe-level `test.use({ storageState: AUTH_STATE_PATH })`
    // as a default, so it must be explicitly overridden here -- otherwise
    // this very call tries to read the auth file before it has been written.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await authenticateAndSaveState(page);

    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    createdTitles = [];

    // The context already carries the authenticated session from
    // beforeAll's storageState, so just land on the app...
    await page.goto(DEFAULT_LOGIN_URL, { waitUntil: 'domcontentloaded' });

    const loginPage = new LoginPage(page);
    const sessionExpired = await loginPage.usernameInput.isVisible({ timeout: 5000 }).catch(() => false);
    notesPage = new NotesPage(page);

    if (sessionExpired) {
      // Defensive fallback only: if the cached session died mid-run (token
      // expiry, staging session reset, etc.), re-authenticate live rather
      // than letting every remaining test in the file fail on a login form
      // none of them expect to see. authenticateAndSaveState() already
      // drives all the way to the Notes page, so there is nothing left to
      // navigate here.
      await authenticateAndSaveState(page);
      return;
    }

    // ...then enter the workspace and land on the Notes section via the sidebar.
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
     * Deliberately placed first, before any Create/Read/Update test has a
     * chance to leave a note behind. This assertion only holds on a
     * genuinely empty shared staging account -- every other test in this
     * file creates at least one note, so running this after any of them
     * makes it depend on their afterEach cleanup having fully succeeded
     * (including the delete's server-side persistence -- see
     * DELETE_PERSIST_SETTLE_MS in NotesPage.ts). It used to live inside the
     * Read block, sandwiched after 5 Create tests and 2 Read tests; a single
     * flaky cleanup anywhere upstream made this fail with unrelated leftover
     * notes. Running first removes that dependency for this suite's own
     * tests (it still assumes the account was empty when the run started).
     */
    test('empty state is displayed when no notes exist', async () => {
      await expect(notesPage.emptyState).toBeVisible();
      await expect(notesPage.page.getByText('Notes you add will appear here', { exact: true })).toBeVisible();
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

      const titles = await notesPage.page.getByText(/Automation Test Note (First|Second)/).allTextContents();
      const firstIndex = titles.findIndex((t) => t.includes('Second'));
      const secondIndex = titles.findIndex((t) => t.includes('First'));

      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThan(firstIndex);
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
