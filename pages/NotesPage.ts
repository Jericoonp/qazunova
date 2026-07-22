import { expect, type Locator, type Page } from '@playwright/test';

const CONTENT_PLACEHOLDER = 'Type your note here';

/**
 * Zero-delay synthetic keystrokes (Locator.pressSequentially with no delay)
 * race this app's React state: the DOM visibly shows the typed value, but
 * the app's own validation state (which gates the Save button) never
 * catches up, leaving Save permanently disabled. A small per-character
 * delay avoids the race. Verified live via a standalone repro script.
 */
const KEYSTROKE_DELAY_MS = 30;

/**
 * After the composer/dialog closes on save, the notes list card (title +
 * content preview) can take a brief moment to re-render with the latest
 * data. Callers that immediately assert on list content need this margin,
 * verified live -- a bare "wait for dialog closed" signal is occasionally
 * not enough on its own.
 *
 * The staging environment itself is also noticeably slow to respond (page
 * loads and network round-trips routinely take several seconds), so this
 * and the other wait/timeout values below are set generously rather than
 * tuned to the fastest observed run.
 */
const LIST_REFRESH_SETTLE_MS = 1500;
/**
 * Every editable field here (the Quill content editor AND the plain Title
 * <input>) updates its own DOM synchronously on every keystroke -- so
 * typeAndVerify's readback check always passes immediately -- but the app
 * only syncs that DOM into its own save-state via a debounced handler.
 * Clicking Save right after the last keystroke races that debounce: the
 * save request can go out with a stale value for whichever field was typed
 * last, even though that field visibly (and verifiably) contains the right
 * text at the moment of the click.
 *
 * Confirmed live via Playwright MCP for both fields:
 * - Content: typing long content and saving immediately silently persisted
 *   an EMPTY body (title saved fine, content did not).
 * - Title (edit dialog): clearing an existing title, typing a new one, and
 *   saving immediately silently persisted the ORIGINAL title unchanged
 *   (the save round-trip did happen -- "Last edited" updated -- but with
 *   the stale value). This did not surface in Create-flow tests only
 *   because content is always typed after the title there, incidentally
 *   giving the title's debounce time to catch up before Save is clicked.
 *
 * Adding this settle delay after the last keystroke and before Save
 * consistently persisted the correct value in both cases.
 */
const FIELD_SYNC_SETTLE_MS = 1000;
/**
 * Same class of race as FIELD_SYNC_SETTLE_MS, but on delete: confirming
 * the delete optimistically removes the card from the UI immediately, but
 * the DELETE request can still be in flight against this slow staging
 * backend. A reload() right after confirming can therefore re-fetch
 * server state from *before* the delete landed, and the "deleted" note
 * reappears. Confirmed live via Playwright MCP -- deleting a note and
 * reloading with no delay brought it back; adding this settle delay
 * before any follow-up reload consistently kept it gone.
 */
const DELETE_PERSIST_SETTLE_MS = 1500;
const NAV_STEP_TIMEOUT_MS = 15000;
const DIALOG_LOAD_TIMEOUT_MS = 15000;
const SAVE_ROUNDTRIP_TIMEOUT_MS = 20000;
const TOAST_TIMEOUT_MS = 15000;

/**
 * Page Object for the "Notes" module (My Notes) inside a workspace Pulse.
 *
 * DOM notes discovered via live inspection (Playwright MCP) of
 * https://dashboard.staging.zunou.ai:
 * - The rich-text content field is a Quill editor (`div[contenteditable]`)
 *   with no aria-label/role/data-testid, so it is targeted via its stable
 *   `data-placeholder` attribute rather than a CSS class.
 * - The note editor renders inline (creation) and, for an existing note,
 *   inside a `role="dialog"` (view/edit). Both can render a "Title" textbox
 *   and a "Save" button, so dialog-scoped locators are always resolved
 *   through `this.dialog` to avoid strict-mode ambiguity.
 * - The delete confirmation panel does NOT expose `role="dialog"` (an
 *   accessibility gap) and is portaled after the note dialog in the DOM,
 *   so its "Delete" button is disambiguated with `.last()`.
 */
export class NotesPage {
  readonly page: Page;

  readonly enterZunouButton: Locator;
  readonly skipTourButton: Locator;
  readonly moreNavToggle: Locator;
  readonly notesNavLink: Locator;
  readonly pageHeading: Locator;
  readonly takeNoteButton: Locator;
  readonly emptyState: Locator;
  readonly toast: Locator;

  readonly titleInput: Locator;
  readonly contentEditor: Locator;
  readonly saveButton: Locator;

  readonly dialog: Locator;
  readonly deleteConfirmationHeading: Locator;
  readonly deleteConfirmationCancelButton: Locator;
  readonly deleteConfirmationConfirmButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.enterZunouButton = page.getByRole('button', { name: 'Enter Zunou' });
    this.skipTourButton = page.getByRole('button', { name: 'Skip' });
    this.moreNavToggle = page.getByRole('button', { name: 'More', exact: true });
    this.notesNavLink = page.getByRole('button', { name: 'Notes', exact: true });
    this.pageHeading = page.getByText('My Notes', { exact: true });
    this.takeNoteButton = page.getByRole('button', { name: 'Take a Note' });
    this.emptyState = page.getByText('No notes yet', { exact: true });
    this.toast = page.getByRole('status');

    // `.first()` is safe here even when a dialog is also open, because the
    // inline composer is always rendered before the (portaled) dialog.
    this.titleInput = page.getByRole('textbox', { name: 'Title', exact: true }).first();
    this.contentEditor = page.locator(`[data-placeholder="${CONTENT_PLACEHOLDER}"]`).first();
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true }).first();

    this.dialog = page.getByRole('dialog');
    this.deleteConfirmationHeading = page.getByText('Delete Note', { exact: true });
    this.deleteConfirmationCancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    this.deleteConfirmationConfirmButton = page.getByRole('button', { name: 'Delete', exact: true }).last();
  }

  /**
   * Waits until the first of the given locators becomes visible and returns
   * it, or undefined if none did within the timeout. Racing candidates
   * (rather than probing each one in turn with its own full timeout) means
   * whichever screen the app actually renders is detected almost
   * immediately, instead of paying for a full timeout on every screen that
   * *didn't* render first.
   */
  private async waitForFirstVisible(locators: Locator[], timeout: number): Promise<Locator | undefined> {
    try {
      await Promise.race(locators.map((locator) => locator.waitFor({ state: 'visible', timeout })));
    } catch {
      return undefined;
    }

    for (const locator of locators) {
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    return undefined;
  }

  /**
   * Navigates from a freshly-logged-in (or session-restored) landing page
   * into the workspace, then opens Notes. Which screen renders first is not
   * deterministic: a brand-new account sees an "Enter Zunou" welcome screen
   * and then an optional product tour, while a returning/already-
   * authenticated session skips straight past both onboarding steps to the
   * workspace, where the sidebar is collapsed to a "More" toggle hiding the
   * Notes link. Confirmed live via Playwright MCP against the shared
   * staging account this suite uses: it always lands directly on the
   * collapsed-sidebar workspace, never the onboarding screens. Racing all
   * of the possible next screens (instead of probing each one serially with
   * its own full NAV_STEP_TIMEOUT_MS) means that common case isn't stuck
   * waiting out two full onboarding timeouts before it even starts looking
   * for the real sidebar.
   */
  async open() {
    let landed = await this.waitForFirstVisible(
      [this.enterZunouButton, this.skipTourButton, this.notesNavLink, this.moreNavToggle],
      NAV_STEP_TIMEOUT_MS
    );

    if (landed === this.enterZunouButton) {
      await this.enterZunouButton.click();
      landed = await this.waitForFirstVisible(
        [this.skipTourButton, this.notesNavLink, this.moreNavToggle],
        NAV_STEP_TIMEOUT_MS
      );
    }

    if (landed === this.skipTourButton) {
      await this.skipTourButton.click();
      landed = await this.waitForFirstVisible([this.notesNavLink, this.moreNavToggle], NAV_STEP_TIMEOUT_MS);
    }

    if (landed !== this.notesNavLink) {
      await this.moreNavToggle.click();
    }

    await this.notesNavLink.click();
    await this.assertNotesPageLoaded();
  }

  async assertNotesPageLoaded() {
    await expect(this.pageHeading).toBeVisible({ timeout: NAV_STEP_TIMEOUT_MS });
    await expect(this.takeNoteButton).toBeVisible({ timeout: NAV_STEP_TIMEOUT_MS });
  }

  async startNewNote() {
    await this.takeNoteButton.click();
    await expect(this.titleInput).toBeVisible({ timeout: NAV_STEP_TIMEOUT_MS });
  }

  /**
   * Types into a field (title input or Quill content editor) and verifies
   * the DOM actually reflects it before returning, retrying the whole
   * typing action otherwise. Under the full test-runner harness (trace +
   * video recording), typed keystrokes occasionally don't register at all
   * even with a per-character delay -- not reproducible in a bare script or
   * manual session, so the harness's own instrumentation overhead is the
   * suspected cause. This is a pragmatic, self-healing guard against that
   * flakiness rather than a fix for a root cause we can control.
   */
  private async typeAndVerify(locator: Locator, text: string, readBack: () => Promise<string>, attempt = 1): Promise<void> {
    await locator.pressSequentially(text, { delay: KEYSTROKE_DELAY_MS });

    const actual = await readBack();
    if (actual.trim() === text.trim()) {
      return;
    }

    if (attempt >= 3) {
      throw new Error(`typeAndVerify: field still reads "${actual}" after ${attempt} attempts (expected "${text}")`);
    }

    await this.clearField(locator);
    await this.typeAndVerify(locator, text, readBack, attempt + 1);
  }

  async fillTitle(title: string) {
    await this.titleInput.click();
    await this.typeAndVerify(this.titleInput, title, () => this.titleInput.inputValue());
    // Let the app's debounced sync catch up to the DOM before a caller is
    // free to click Save -- see FIELD_SYNC_SETTLE_MS.
    await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
  }

  async fillContent(content: string) {
    await this.contentEditor.click();
    await this.typeAndVerify(this.contentEditor, content, () => this.contentEditor.innerText());
    // Let the app's debounced sync catch up to the DOM before a caller is
    // free to click Save -- see FIELD_SYNC_SETTLE_MS.
    await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
  }

  async assertSaveDisabled() {
    await expect(this.saveButton).toBeDisabled();
  }

  async assertSaveEnabled() {
    await expect(this.saveButton).toBeEnabled();
  }

  async save() {
    await this.saveButton.click();
    // Wait for the composer to close -- the durable signal that the save
    // round-trip actually completed, rather than racing a reload()/assertion
    // against an in-flight request (the toast alone auto-dismisses too
    // quickly to be a safe synchronization point). Timeout is generous
    // because the staging backend can be slow to respond to the save call.
    await expect(this.titleInput).toBeHidden({ timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    await this.page.waitForTimeout(LIST_REFRESH_SETTLE_MS);
  }

  /** End-to-end create flow: opens the composer, fills fields, and saves. */
  async createNote(title: string, content?: string) {
    await this.startNewNote();

    if (title) {
      await this.fillTitle(title);
    }

    if (content) {
      await this.fillContent(content);
    }

    await this.save();
  }

  noteCardTitle(title: string): Locator {
    return this.page.getByText(title, { exact: true });
  }

  /**
   * The list's content preview text is NOT unique across notes (e.g. every
   * CRUD test that doesn't customize content saves the same NOTE_CONTENT
   * string), so a page-wide `getByText(content, { exact: true })` resolves
   * to one element per matching note and throws a strict-mode violation as
   * soon as more than one exists -- confirmed live via Playwright MCP: with
   * ~15 same-content notes in the shared staging account, this locator
   * matched 14 elements. Scoping to the specific note's card (identified by
   * its -- unique, timestamped -- title) via the stable MUI `MuiCard-root`
   * class avoids the ambiguity.
   */
  noteCard(title: string): Locator {
    return this.page.locator('.MuiCard-root').filter({ has: this.noteCardTitle(title) });
  }

  noteCardContent(title: string, content: string): Locator {
    return this.noteCard(title).getByText(content, { exact: true });
  }

  async assertNoteVisible(title: string) {
    await expect(this.noteCardTitle(title)).toBeVisible();
  }

  async assertNoteNotVisible(title: string) {
    await expect(this.noteCardTitle(title)).toHaveCount(0);
  }

  async openNote(title: string) {
    await this.noteCardTitle(title).click();
    await expect(this.dialog).toBeVisible({ timeout: DIALOG_LOAD_TIMEOUT_MS });
    // The dialog shell renders immediately, but its title/content are
    // populated asynchronously a moment later (slower still on this
    // environment's backend). Waiting for the title field to actually hold
    // the expected value (rather than just "dialog is visible") avoids
    // racing that load in every caller downstream.
    await expect(this.dialogTitleInput()).toHaveValue(title, { timeout: DIALOG_LOAD_TIMEOUT_MS });
  }

  dialogTitleInput(): Locator {
    return this.dialog.getByRole('textbox', { name: 'Title', exact: true });
  }

  dialogContentEditor(): Locator {
    return this.dialog.locator(`[data-placeholder="${CONTENT_PLACEHOLDER}"]`);
  }

  dialogSaveButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Save', exact: true });
  }

  dialogDeleteButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Delete', exact: true });
  }

  /**
   * Selects all existing text in the given field and removes it via a real
   * keystroke. Uses Locator.selectText() (DOM Selection API scoped to this
   * element) rather than a Ctrl+A keypress -- this app binds global
   * keyboard shortcuts (e.g. Ctrl+K for search) that can intercept Ctrl+A
   * before it reaches the field, leaving the "cleared" text intact.
   */
  private async clearField(locator: Locator) {
    await locator.selectText();
    await this.page.keyboard.press('Backspace');
  }

  /** Clears the title of the note currently open in the edit dialog. */
  async clearDialogTitle() {
    const title = this.dialogTitleInput();
    await title.click();
    await this.clearField(title);
  }

  /** Opens an existing note and overwrites its title and/or content. */
  async editNote(existingTitle: string, updates: { title?: string; content?: string }) {
    await this.openNote(existingTitle);

    if (updates.title !== undefined) {
      const title = this.dialogTitleInput();
      await title.click();
      await this.clearField(title);
      await this.typeAndVerify(title, updates.title, () => title.inputValue());
      // Same debounce race as fillTitle() -- see FIELD_SYNC_SETTLE_MS.
      // Confirmed live: without this, Save can round-trip successfully
      // ("Last edited" updates) while silently persisting the ORIGINAL
      // title instead of the newly typed one.
      await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
    }

    if (updates.content !== undefined) {
      const editor = this.dialogContentEditor();
      await editor.click();
      await this.clearField(editor);
      await this.typeAndVerify(editor, updates.content, () => editor.innerText());
      // Same debounce race as fillContent() -- see FIELD_SYNC_SETTLE_MS.
      await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
    }

    await this.dialogSaveButton().click();
    // Same reasoning as save(): wait for the dialog to actually close rather
    // than racing a reload()/assertion against an in-flight request.
    await expect(this.dialog).toBeHidden({ timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    await this.page.waitForTimeout(LIST_REFRESH_SETTLE_MS);
  }

  async assertLastEditedTimestampVisible() {
    await expect(this.dialog.getByText(/Last edited on/i)).toBeVisible();
  }

  /** Opens the note, triggers delete, and confirms in the confirmation panel. */
  async deleteNote(title: string) {
    await this.openNote(title);
    await this.dialogDeleteButton().click();
    await expect(this.deleteConfirmationHeading).toBeVisible();
    await this.deleteConfirmationConfirmButton.click();
    await expect(this.deleteConfirmationHeading).toHaveCount(0, { timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    // Let the delete actually persist server-side before a caller reloads --
    // see DELETE_PERSIST_SETTLE_MS.
    await this.page.waitForTimeout(DELETE_PERSIST_SETTLE_MS);
  }

  /** Opens the note, triggers delete, but cancels out of the confirmation panel. */
  async deleteNoteThenCancel(title: string) {
    await this.openNote(title);
    await this.dialogDeleteButton().click();
    await expect(this.deleteConfirmationHeading).toBeVisible();
    await this.deleteConfirmationCancelButton.click();
    await expect(this.deleteConfirmationHeading).toHaveCount(0);
  }

  /**
   * Best-effort cleanup used in test teardown: deletes the note if it still
   * exists, silently no-op otherwise. Keeps the shared staging account tidy
   * across repeated suite runs.
   */
  async deleteNoteIfExists(title: string) {
    if (await this.noteCardTitle(title).isVisible().catch(() => false)) {
      await this.deleteNote(title);
    }
  }

  async assertToastMessage(pattern: RegExp) {
    await expect(this.toast.filter({ hasText: pattern })).toBeVisible({ timeout: TOAST_TIMEOUT_MS });
  }

  async reload() {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    // assertNotesPageLoaded() already uses a generous timeout to cover this
    // environment's slow post-reload hydration.
    await this.assertNotesPageLoaded();
  }
}
