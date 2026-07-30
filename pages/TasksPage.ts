import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Zero-delay synthetic keystrokes race this app's React state on other
 * modules (confirmed on Notes -- see NotesPage.ts's KEYSTROKE_DELAY_MS). Not
 * independently re-confirmed against these plain MUI TextFields specifically,
 * but applied here defensively for the same reason: cheap to keep, expensive
 * to silently lose a keystroke against a slow environment.
 */
const KEYSTROKE_DELAY_MS = 30;

const NAV_STEP_TIMEOUT_MS = 15000;
// Matches NotesPage.ts / PulsePage.ts on main -- the product tour (react-joyride)
// mounts noticeably later than the "Enter Zunou" welcome screen on CI.
const ONBOARDING_TOUR_TIMEOUT_MS = 20000;
const PANEL_LOAD_TIMEOUT_MS = 15000;
const SAVE_ROUNDTRIP_TIMEOUT_MS = 20000;
/**
 * After a create/update/delete round-trip completes, the list can take a
 * brief moment to re-render with the latest data -- see
 * NotesPage.ts's LIST_REFRESH_SETTLE_MS for the same class of race on a
 * different module of this same (slow) staging environment.
 */
const LIST_REFRESH_SETTLE_MS = 1500;
/** Same debounce race as NotesPage.ts's FIELD_SYNC_SETTLE_MS. */
const FIELD_SYNC_SETTLE_MS = 1000;
const DELETE_PERSIST_SETTLE_MS = 1500;
/**
 * Confirmed live via Playwright MCP: a Task List with no tasks in it yet is
 * created successfully server-side (a reload proves it exists) but does NOT
 * appear in the list view immediately after creation -- the view's own
 * client-side state does not pick up the new (empty) list until the page is
 * reloaded. Not observed for individual Task creation, only Task List.
 */
const EMPTY_LIST_RENDER_RELOAD_MS = 1000;

export class TasksPage {
  readonly page: Page;

  readonly enterZunouButton: Locator;
  readonly skipTourButton: Locator;
  readonly cancelTimezoneMismatchButton: Locator;
  readonly moreNavToggle: Locator;
  readonly myTasksNavLink: Locator;
  readonly addTaskButton: Locator;
  readonly newTaskMenuItem: Locator;
  readonly newListMenuItem: Locator;

  readonly emptyState: Locator;
  readonly emptyStateTaskCard: Locator;
  readonly emptyStateTaskListCard: Locator;

  // Create-composer fields (Task). Not scoped to role="dialog" -- confirmed
  // live the composer has no such role, same accessibility gap documented
  // in NotesPage.ts.
  readonly newTaskTitleInput: Locator;
  readonly newTaskDescriptionInput: Locator;
  readonly createTaskButton: Locator;
  readonly createTaskCancelButton: Locator;

  // Create-composer fields (Task List).
  readonly newTaskListTitleInput: Locator;
  readonly newTaskListDescriptionInput: Locator;
  readonly createListButton: Locator;
  readonly createListCancelButton: Locator;

  // The task detail panel (view/edit). Confirmed live: editing a Task List's
  // title goes through this exact same panel as a Task (same "Editing task
  // no. ..." wording, same GITHUB PULL REQUESTS/COMMENTS sections) -- a Task
  // List is implemented as a Task under the hood. So these locators are
  // intentionally shared between editTask() and renameTaskList() below.
  readonly panelCloseButton: Locator;
  readonly panelActionButtons: Locator;
  readonly panelDialogTitleInput: Locator;
  readonly panelDialogDescriptionInput: Locator;
  readonly panelDialogSaveButton: Locator;
  readonly panelDescriptionEmpty: Locator;

  // Inline delete confirmation that replaces the open panel's body when
  // deleting a Task via the panel's own Delete action icon. Confirmed live:
  // this is NOT the same component as the Task List row's delete dialog
  // below -- no shared heading/structure, a genuine app inconsistency.
  readonly deleteWarningHeading: Locator;
  readonly deleteWarningMessage: Locator;
  readonly deleteWarningCancelButton: Locator;
  readonly deleteWarningConfirmButton: Locator;

  // The separate, properly-headed confirmation dialog used when deleting a
  // Task List from its row's own delete icon.
  readonly deleteTaskListHeading: Locator;
  readonly deleteTaskListMessage: Locator;
  readonly deleteTaskListCancelButton: Locator;
  readonly deleteTaskListConfirmButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.enterZunouButton = page.getByRole('button', { name: 'Enter Zunou' });
    this.skipTourButton = page.getByRole('button', { name: 'Skip' });
    this.cancelTimezoneMismatchButton = page.getByRole('button', { name: 'Cancel' });
    this.moreNavToggle = page.getByRole('button', { name: 'More', exact: true });
    this.myTasksNavLink = page.getByRole('button', { name: 'My Tasks', exact: true });

    // Always present regardless of whether the list is empty or populated
    // (confirmed live) -- the equivalent of NotesPage.ts's takeNoteButton as
    // both the "page loaded" signal and the one reliable creation entry
    // point once the empty-state cards below have scrolled out of view.
    this.addTaskButton = page.getByRole('button', { name: 'Add Task', exact: true });
    this.newTaskMenuItem = page.getByRole('menuitem', { name: 'New Task', exact: true });
    this.newListMenuItem = page.getByRole('menuitem', { name: 'New List', exact: true });

    this.emptyState = page.getByText('Add tasks to keep things moving.', { exact: true });
    // Only rendered when the list is empty -- an alternate creation entry
    // point to addTaskButton's menu, exercised by the "entry point exists"
    // navigation tests below.
    this.emptyStateTaskCard = page.getByRole('button', { name: 'Task Create a new task' });
    this.emptyStateTaskListCard = page.getByRole('button', { name: 'Task List Create a new task list' });

    this.newTaskTitleInput = page.getByRole('textbox', { name: 'What needs to be done?', exact: true });
    this.newTaskDescriptionInput = page.getByRole('textbox', { name: /Add a description/ }).first();
    this.createTaskButton = page.getByRole('button', { name: 'Create Task', exact: true });
    this.createTaskCancelButton = page.getByRole('button', { name: 'Cancel', exact: true }).first();

    this.newTaskListTitleInput = page.getByRole('textbox', {
      name: 'Choose a title that defines your Task List',
      exact: true,
    });
    this.newTaskListDescriptionInput = page.getByRole('textbox', { name: /Add a description/ }).first();
    this.createListButton = page.getByRole('button', { name: 'Create List', exact: true });
    this.createListCancelButton = page.getByRole('button', { name: 'Cancel', exact: true }).first();

    this.panelCloseButton = page.getByRole('button', { name: 'close', exact: true });
    // Icon-only actions on the open panel's header. No aria-label of their
    // own -- confirmed live each resolves to the literal, untranslated i18n
    // key "action.ariaLabel" (a real app bug, same one PulsePage.ts on main
    // already flags for its own delete-Pulse button). Order is stable
    // (Edit, Delete, [Share]) -- Share only renders in view mode, but Edit
    // and Delete stay at index 0/1 either way, so only those two indices are
    // used anywhere below.
    this.panelActionButtons = page.getByRole('button', { name: 'action.ariaLabel' });
    this.panelDialogTitleInput = page.getByRole('textbox', { name: /Choose a title that defines your Task/ });
    this.panelDialogDescriptionInput = page.getByRole('textbox', { name: /Enter your task description here/ });
    this.panelDialogSaveButton = page.getByRole('button', { name: 'Save', exact: true });
    this.panelDescriptionEmpty = page.getByText('Task description not available', { exact: true });

    this.deleteWarningHeading = page.getByText('Warning', { exact: true });
    this.deleteWarningMessage = page.getByText('Are you sure you want to delete this task? This cannot be undone.', {
      exact: true,
    });
    this.deleteWarningCancelButton = page.getByRole('button', { name: 'Cancel', exact: true }).last();
    this.deleteWarningConfirmButton = page.getByRole('button', { name: 'Delete', exact: true }).last();

    this.deleteTaskListHeading = page.getByText('Delete Task List', { exact: true });
    this.deleteTaskListMessage = page.getByText(
      'Are you sure you want to delete this task list? This cannot be undone.',
      { exact: true }
    );
    this.deleteTaskListCancelButton = page.getByRole('button', { name: 'Cancel', exact: true }).last();
    this.deleteTaskListConfirmButton = page.getByRole('button', { name: 'Delete', exact: true }).last();
  }

  /**
   * First-run onboarding (the "Enter Zunou" welcome landing, then a product
   * tour, then a timezone-mismatch dialog) -- see NotesPage.ts's
   * dismissOnboardingIfPresent() for why each of these three steps exists
   * and must be attempted in this order.
   */
  private async dismissOnboardingIfPresent() {
    await this.enterZunouButton.click({ timeout: NAV_STEP_TIMEOUT_MS }).catch(() => undefined);
    await this.skipTourButton.click({ timeout: ONBOARDING_TOUR_TIMEOUT_MS }).catch(() => undefined);
    await this.cancelTimezoneMismatchButton.click({ timeout: NAV_STEP_TIMEOUT_MS }).catch(() => undefined);
  }

  /** Navigates from a freshly-logged-in landing page into the workspace, then opens My Tasks. */
  async open() {
    await this.dismissOnboardingIfPresent();

    const myTasksLinkShown = await this.myTasksNavLink.isVisible().catch(() => false);
    if (!myTasksLinkShown) {
      await this.moreNavToggle.click();
    }

    await this.myTasksNavLink.click();
    await this.assertTasksPageLoaded();
  }

  async assertTasksPageLoaded() {
    await expect(this.addTaskButton).toBeVisible({ timeout: NAV_STEP_TIMEOUT_MS });
  }

  async reload() {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.assertTasksPageLoaded();
  }

  // ---------------------------------------------------------------------
  // Shared create-composer helpers
  // ---------------------------------------------------------------------

  /**
   * Types into a field and verifies the DOM actually reflects it before
   * returning, retrying otherwise -- same defensive pattern (and the same
   * rationale) as NotesPage.ts's typeAndVerify().
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

  private async clearField(locator: Locator) {
    await locator.selectText();
    await this.page.keyboard.press('Backspace');
  }

  // ---------------------------------------------------------------------
  // Task: Create
  // ---------------------------------------------------------------------

  async startNewTask() {
    await this.addTaskButton.click();
    await this.newTaskMenuItem.click();
    await expect(this.newTaskTitleInput).toBeVisible({ timeout: NAV_STEP_TIMEOUT_MS });
  }

  async fillNewTaskTitle(title: string) {
    await this.newTaskTitleInput.click();
    await this.typeAndVerify(this.newTaskTitleInput, title, () => this.newTaskTitleInput.inputValue());
    await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
  }

  async fillNewTaskDescription(description: string) {
    await this.newTaskDescriptionInput.click();
    await this.typeAndVerify(this.newTaskDescriptionInput, description, () => this.newTaskDescriptionInput.inputValue());
    await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
  }

  async assertCreateTaskDisabled() {
    await expect(this.createTaskButton).toBeDisabled();
  }

  /** End-to-end create flow for a standalone Task (no list). */
  async createTask(title: string, description?: string) {
    await this.startNewTask();

    if (title) {
      await this.fillNewTaskTitle(title);
    }

    if (description) {
      await this.fillNewTaskDescription(description);
    }

    await this.createTaskButton.click();
    // The composer closing is the durable signal the create round-trip
    // completed -- same reasoning as NotesPage.ts's save().
    await expect(this.newTaskTitleInput).toBeHidden({ timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    await this.page.waitForTimeout(LIST_REFRESH_SETTLE_MS);
  }

  // ---------------------------------------------------------------------
  // Task List: Create
  // ---------------------------------------------------------------------

  async startNewTaskList() {
    await this.addTaskButton.click();
    await this.newListMenuItem.click();
    await expect(this.newTaskListTitleInput).toBeVisible({ timeout: NAV_STEP_TIMEOUT_MS });
  }

  async fillNewTaskListTitle(title: string) {
    await this.newTaskListTitleInput.click();
    await this.typeAndVerify(this.newTaskListTitleInput, title, () => this.newTaskListTitleInput.inputValue());
    await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
  }

  async fillNewTaskListDescription(description: string) {
    await this.newTaskListDescriptionInput.click();
    await this.typeAndVerify(this.newTaskListDescriptionInput, description, () =>
      this.newTaskListDescriptionInput.inputValue()
    );
    await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
  }

  async assertCreateListDisabled() {
    await expect(this.createListButton).toBeDisabled();
  }

  /**
   * End-to-end create flow for a Task List. Always reloads afterward -- see
   * EMPTY_LIST_RENDER_RELOAD_MS: an empty list is created successfully
   * server-side but does not render into the view until the page reloads.
   */
  async createTaskList(title: string, description?: string) {
    await this.startNewTaskList();

    if (title) {
      await this.fillNewTaskListTitle(title);
    }

    if (description) {
      await this.fillNewTaskListDescription(description);
    }

    await this.createListButton.click();
    await expect(this.newTaskListTitleInput).toBeHidden({ timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    await this.page.waitForTimeout(EMPTY_LIST_RENDER_RELOAD_MS);
    await this.reload();
  }

  // ---------------------------------------------------------------------
  // Task: Read / Update / Delete
  // ---------------------------------------------------------------------

  taskRowTitle(title: string): Locator {
    return this.page.getByText(title, { exact: true });
  }

  /**
   * The open panel renders a Task's description text in two separate
   * elements at once (confirmed live via Playwright MCP -- same duplicate
   * text, two different MUI paragraph nodes, reproducible with both short
   * and long descriptions, so not a truncation/read-more artifact). A bare
   * page-wide `getByText(description, { exact: true })` therefore throws a
   * strict-mode violation as soon as the panel is open. `.first()` sidesteps
   * the ambiguity -- either match is equally valid evidence the description
   * rendered correctly.
   */
  taskDescriptionText(description: string): Locator {
    return this.page.getByText(description, { exact: true }).first();
  }

  async assertTaskVisible(title: string) {
    await expect(this.taskRowTitle(title)).toBeVisible();
  }

  async assertTaskNotVisible(title: string) {
    await expect(this.taskRowTitle(title)).toHaveCount(0);
  }

  /** Opens a standalone Task's detail panel (view mode) from the list. */
  async openTask(title: string) {
    await this.taskRowTitle(title).click();
    await expect(this.panelCloseButton).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });
    await expect(this.page.getByRole('heading', { level: 5, name: title, exact: true })).toBeVisible({
      timeout: PANEL_LOAD_TIMEOUT_MS,
    });
  }

  async closePanel() {
    const isOpen = await this.panelCloseButton.isVisible().catch(() => false);
    if (isOpen) {
      await this.panelCloseButton.click();
    }
  }

  async assertLastEditedVisible() {
    await expect(this.page.getByText(/Updated by .* at/i)).toBeVisible();
  }

  /** Opens an existing Task and overwrites its title and/or description. */
  async editTask(existingTitle: string, updates: { title?: string; description?: string }) {
    await this.openTask(existingTitle);
    await this.panelActionButtons.nth(0).click(); // Edit
    await expect(this.panelDialogTitleInput).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });

    if (updates.title !== undefined) {
      await this.clearField(this.panelDialogTitleInput);
      await this.typeAndVerify(this.panelDialogTitleInput, updates.title, () => this.panelDialogTitleInput.inputValue());
      await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
    }

    if (updates.description !== undefined) {
      await this.panelDialogDescriptionInput.click();
      await this.clearField(this.panelDialogDescriptionInput);
      await this.typeAndVerify(this.panelDialogDescriptionInput, updates.description, () =>
        this.panelDialogDescriptionInput.inputValue()
      );
      await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);
    }

    await this.panelDialogSaveButton.click();
    await expect(this.panelDialogTitleInput).toBeHidden({ timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    await this.page.waitForTimeout(LIST_REFRESH_SETTLE_MS);
    // The panel switches back to view mode and stays open after saving,
    // showing the (now up to date) title as an <h5> heading alongside the
    // list row's own <p> with the same text -- confirmed live this collides
    // with taskRowTitle()'s page-wide getByText() as a strict-mode
    // violation on the very next assertion/openTask() call. Closing here
    // keeps only the list row's copy on screen, same as deleteTask()'s
    // closePanel() below.
    await this.closePanel();
  }

  async assertEditTaskSaveDisabled() {
    await expect(this.panelDialogSaveButton).toBeDisabled({ timeout: 10000 });
  }

  /** Clears the title of the Task currently open for editing in the panel. */
  async clearOpenTaskTitle() {
    await this.panelActionButtons.nth(0).click(); // Edit
    await expect(this.panelDialogTitleInput).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });
    await this.clearField(this.panelDialogTitleInput);
  }

  /**
   * Opens the Task, triggers delete via the panel's own Delete action icon,
   * and confirms in the inline "Warning" confirmation. Confirmed live: the
   * panel does NOT auto-close after a confirmed delete (it's left showing a
   * stale, emptied-out shell) -- closePanel() afterward works around that
   * rather than asserting on the (currently broken) auto-close behavior.
   */
  async deleteTask(title: string) {
    await this.openTask(title);
    await this.panelActionButtons.nth(1).click(); // Delete
    await expect(this.deleteWarningHeading).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });
    await this.deleteWarningConfirmButton.click();
    await expect(this.deleteWarningHeading).toHaveCount(0, { timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    await this.page.waitForTimeout(DELETE_PERSIST_SETTLE_MS);
    await this.closePanel();
  }

  async deleteTaskThenCancel(title: string) {
    await this.openTask(title);
    await this.panelActionButtons.nth(1).click(); // Delete
    await expect(this.deleteWarningHeading).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });
    await this.deleteWarningCancelButton.click();
    await expect(this.deleteWarningHeading).toHaveCount(0);
    await this.closePanel();
  }

  /** Best-effort teardown: deletes the Task if it still exists, silent no-op otherwise. */
  async deleteTaskIfExists(title: string) {
    const exists = await this.taskRowTitle(title)
      .waitFor({ state: 'visible', timeout: LIST_REFRESH_SETTLE_MS + 1000 })
      .then(() => true)
      .catch(() => false);

    if (exists) {
      await this.deleteTask(title);
    }
  }

  // ---------------------------------------------------------------------
  // Task List: Read / Update / Delete
  // ---------------------------------------------------------------------

  /**
   * A Task List's row wrapper carries an inline `cursor: pointer` style
   * (rather than a stable class) -- confirmed live to be unique to list
   * rows on this page, so it doubles as a reliable, class-hash-independent
   * scoping root for a specific list's Add/Edit/Delete actions.
   */
  taskListRow(title: string): Locator {
    return this.page.locator('div[style*="cursor: pointer"]').filter({ hasText: title });
  }

  taskListEditButton(title: string): Locator {
    return this.taskListRow(title).locator('button:has(svg[data-testid="EditOutlinedIcon"])');
  }

  taskListDeleteButton(title: string): Locator {
    return this.taskListRow(title).locator('button:has(svg[data-testid="DeleteOutlinedIcon"])');
  }

  /**
   * Clicks a Task List row action (Edit/Delete) with the floating "Add" button
   * temporarily taken out of the hit-test.
   *
   * The Fab is fixed to the bottom-right of the viewport, so whenever the list
   * happens to end near the bottom of the screen it sits directly on top of the
   * LAST row's Edit/Delete icons. Playwright then reports
   * `... MuiFab-root ... subtree intercepts pointer events` and retries the
   * click until the enclosing hook's budget is gone. Measured on run
   * 30343800657: 515 retries inside deleteAllTasksAndLists() burned webkit's
   * whole 300s beforeAll and left 31 of 68 tests unrun.
   *
   * Neither obvious remedy works here:
   *  - scrollIntoViewIfNeeded() is a no-op -- the row IS in view, just covered.
   *  - scrolling the row upward needs scroll room the list often doesn't have
   *    (the overlap happens precisely when the content ends at the fold).
   *
   * So drop pointer events on the Fab for the duration of the click and restore
   * them afterwards. This is a WORKAROUND, not a cover-up: the overlap is a
   * genuine UX defect for real users too -- the Fab really does cover the last
   * row's controls -- and is logged separately. Neutralising it here only stops
   * one product defect from taking the entire suite down with it.
   */
  private async clickTaskListRowAction(target: Locator) {
    const setFabPointerEvents = (value: string) =>
      this.page
        .locator('.MuiFab-root')
        .evaluateAll((els, v) => {
          els.forEach((el) => {
            (el as HTMLElement).style.pointerEvents = v;
          });
        }, value)
        .catch(() => {
          /* No Fab on screen -- nothing to neutralise, click normally. */
        });

    await setFabPointerEvents('none');
    try {
      await target.click();
    } finally {
      await setFabPointerEvents('');
    }
  }

  async assertTaskListVisible(title: string) {
    await expect(this.taskListRow(title)).toBeVisible();
  }

  async assertTaskListNotVisible(title: string) {
    await expect(this.taskListRow(title)).toHaveCount(0);
  }

  /**
   * Renames a Task List via its row's Edit icon. Confirmed live: this opens
   * the same Task detail panel used by editTask() above, straight into edit
   * mode -- there is no separate read-only "view" step for a Task List the
   * way there is for a Task, so Read-style assertions on a list's title are
   * made through this same edit-mode entry point.
   */
  async renameTaskList(existingTitle: string, newTitle: string) {
    await this.clickTaskListRowAction(this.taskListEditButton(existingTitle));
    await expect(this.panelDialogTitleInput).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });

    await this.clearField(this.panelDialogTitleInput);
    await this.typeAndVerify(this.panelDialogTitleInput, newTitle, () => this.panelDialogTitleInput.inputValue());
    await this.page.waitForTimeout(FIELD_SYNC_SETTLE_MS);

    await this.panelDialogSaveButton.click();
    await expect(this.panelDialogSaveButton).toBeHidden({ timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    await this.page.waitForTimeout(LIST_REFRESH_SETTLE_MS);
    await this.closePanel();
  }

  async assertRenameListSaveDisabled() {
    await expect(this.panelDialogSaveButton).toBeDisabled({ timeout: 10000 });
  }

  async openTaskListTitleForEdit(title: string) {
    await this.clickTaskListRowAction(this.taskListEditButton(title));
    await expect(this.panelDialogTitleInput).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });
  }

  async clearOpenTaskListTitle() {
    await this.clearField(this.panelDialogTitleInput);
  }

  /** Deletes a Task List via its row's own Delete icon and confirmation dialog. */
  async deleteTaskList(title: string) {
    await this.clickTaskListRowAction(this.taskListDeleteButton(title));
    await expect(this.deleteTaskListHeading).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });
    await this.deleteTaskListConfirmButton.click();
    await expect(this.deleteTaskListHeading).toHaveCount(0, { timeout: SAVE_ROUNDTRIP_TIMEOUT_MS });
    await this.page.waitForTimeout(DELETE_PERSIST_SETTLE_MS);
  }

  async deleteTaskListThenCancel(title: string) {
    await this.clickTaskListRowAction(this.taskListDeleteButton(title));
    await expect(this.deleteTaskListHeading).toBeVisible({ timeout: PANEL_LOAD_TIMEOUT_MS });
    await this.deleteTaskListCancelButton.click();
    await expect(this.deleteTaskListHeading).toHaveCount(0);
  }

  /** Best-effort teardown: deletes the Task List if it still exists, silent no-op otherwise. */
  async deleteTaskListIfExists(title: string) {
    const exists = await this.taskListRow(title)
      .waitFor({ state: 'visible', timeout: LIST_REFRESH_SETTLE_MS + 1000 })
      .then(() => true)
      .catch(() => false);

    if (exists) {
      await this.deleteTaskList(title);
    }
  }

  // ---------------------------------------------------------------------
  // Suite-level cleanup
  // ---------------------------------------------------------------------

  /**
   * Waits for the view to resolve to either "has at least one item" or
   * "empty" rather than trusting a single point-in-time locator count()
   * right after navigating in -- the exact race NotesPage.ts's
   * listHasNotesSettled() documents and fixes for Notes. Confirmed live
   * here too: deleteAllTasksAndLists()'s first count() check, called right
   * after open() in beforeEach, read 0 (no Task List rows, no Task "Open"
   * pills) even though the account genuinely had a leftover list and task
   * on screen a moment later -- assertTasksPageLoaded() only waits for the
   * page shell (the "Add Task" button), not the list content underneath
   * it, which can still be mid-fetch at that point.
   */
  private async waitForItemsSettled(): Promise<void> {
    const anyListRow = this.page.locator('div[style*="cursor: pointer"]').first();
    const anyTaskRow = this.page.getByRole('button', { name: 'Open', exact: true }).first();

    await Promise.race([
      this.emptyState.waitFor({ state: 'visible', timeout: NAV_STEP_TIMEOUT_MS }),
      anyListRow.waitFor({ state: 'visible', timeout: NAV_STEP_TIMEOUT_MS }),
      anyTaskRow.waitFor({ state: 'visible', timeout: NAV_STEP_TIMEOUT_MS }),
    ]).catch(() => undefined);
  }

  /**
   * Deletes every Task List and every standalone Task currently in the
   * account, then leaves the caller on the empty-list view. Same role as
   * NotesPage.ts's deleteAllNotes(): used both to guarantee a clean slate
   * in beforeAll and directly inside the "empty state" test, rather than
   * assuming the account happens to already be empty.
   *
   * Deliberately unscoped (no title filter) -- an earlier version of this
   * method only matched "Automation Test ..." titles, which meant any
   * leftover item with a different title (a prior interrupted run, manual
   * testing, anything) silently survived cleanup and the empty-state
   * assertion never passed. Notes/Pulse data lives on entirely separate
   * pages from My Tasks, so deleting everything visible here can never
   * touch their data -- the same reasoning that already makes Notes'
   * unscoped deleteAllNotes() safe on this same shared account.
   *
   * Task Lists are cleared first via the reliable cursor:pointer row
   * selector; each iteration re-queries rather than collecting locators
   * upfront, since a delete re-renders the list. Standalone Tasks are then
   * cleared by their row's "Open" status pill -- the one element unique to
   * a standalone task row (Task List rows show a checkbox icon there
   * instead), which is used to walk up to the row's title paragraph.
   */
  async deleteAllTasksAndLists() {
    const MAX_ITEMS_TO_DELETE = 50;

    await this.waitForItemsSettled();

    for (let i = 0; i < MAX_ITEMS_TO_DELETE; i++) {
      const rows = this.page.locator('div[style*="cursor: pointer"]');
      if ((await rows.count()) === 0) {
        break;
      }
      const title = (await rows.first().locator('p').first().textContent())?.trim();
      if (!title) {
        break;
      }
      await this.deleteTaskListIfExists(title);
    }

    for (let i = 0; i < MAX_ITEMS_TO_DELETE; i++) {
      const openPill = this.page.getByRole('button', { name: 'Open', exact: true }).first();
      const exists = await openPill.isVisible().catch(() => false);
      if (!exists) {
        break;
      }

      const title = await openPill.evaluate((el) => {
        let node = el.parentElement;
        while (node) {
          const text = node.querySelector('p')?.textContent?.trim();
          if (text) {
            return text;
          }
          node = node.parentElement;
        }
        return null;
      });

      if (!title) {
        break;
      }
      await this.deleteTaskIfExists(title);
    }
  }
}
