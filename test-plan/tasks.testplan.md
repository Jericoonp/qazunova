# My Tasks Module Test Plan

## Objective
Validate CRUD (Create, Read, Update, Delete) functionality of the "My Tasks" module inside a workspace Pulse on the staging Zunou dashboard (`https://dashboard.staging.zunou.ai`), for both of its two entity types -- standalone **Task** items and **Task List** containers -- using the reusable Playwright + Page Object Model framework already established for the Login and Notes suites.

## Scope
- Sidebar navigation into My Tasks and the "Add Task" entry point (New Task / New List).
- Create Task: composer field validation, save behavior, and post-create state (list + refresh persistence).
- Read Task: opening a task, verifying displayed title/description, empty state, large-content rendering.
- Update Task: editing title/description, save validation, and refresh persistence of edits.
- Delete Task: confirmation, cancel path, confirm path, and refresh behavior after deletion.
- Create/Update/Delete Task List (title + description, rename, confirmation dialog, refresh persistence). Task List has no independent "Read" step distinct from Update -- see Findings below.

## Environment & Access
- URL: `LOGIN_PAGE_URL` (`https://dashboard.staging.zunou.ai`)
- Auth: `LOGIN_TEST_USER` / `LOGIN_TEST_PASSWORD` (staging-only test account), via the existing `LoginPage` object.
- After login, the app lands on an intermediate `/landing/{orgId}` screen; tests click "Enter Zunou" to reach the workspace, dismiss the first-run onboarding tour ("Skip") and timezone-mismatch dialog, then open **My Tasks** from the left sidebar (behind a **More** toggle if the sidebar is in its collapsed state).

## DOM / Selector Findings (live inspection via Playwright MCP, 2026-07-23)
- Like Notes, this module has **no `data-testid` attributes** on most interactive elements; selectors use `getByRole`/`getByText` wherever an accessible name exists.
- The one reliable, always-present creation entry point is the header **"Add Task"** button, which opens a menu with **"New Task"** / **"New List"** menu items. The two large empty-state cards ("Task" / "Task List") are an *additional* entry point but only render when the account has zero items of either type, so tests rely on the header button/menu as their primary path.
- The **Task create composer** and **Task List create composer** are not scoped to `role="dialog"` -- the same accessibility gap documented in `notes.testplan.md` for the Notes composer.
- Opening an existing **Task** shows a detail panel with "Viewing task no. `<ID>`", the title as an `<h5>` heading, a DETAILS section (status/assignee/dates/priority), a GITHUB PULL REQUESTS section, and a COMMENTS section that auto-seeds a "Task created: `<title>`" comment.
- **A Task List is implemented as a Task under the hood.** Clicking a Task List row's Edit icon opens the *exact same* detail panel component used for Task editing (same "Editing task no. `<ID>`" wording, same GITHUB PULL REQUESTS/COMMENTS sections) -- confirmed live by observing a freshly-created Task List's Edit action reuse a task ID (`JPP4-T001`) from an already-deleted standalone Task. There is **no separate read-only "view" step for a Task List** the way there is for a Task -- clicking a list row toggles expand/collapse, and only the Edit icon opens the (edit-mode) panel. Read-style assertions on a list's title are therefore made through this same edit-mode entry point rather than a dedicated view.
- The Task detail panel's header exposes three icon-only actions (Edit, Delete, Share in view mode; Edit, Delete in edit mode) with **no aria-label of their own** -- each resolves to the literal, untranslated i18n key `"action.ariaLabel"`, the same real app bug already flagged in `pages/PulsePage.ts` (`deletePulse()`) on `main`. Order is stable (Edit, Delete, [Share]), so they are targeted by index.
- A Task List's row-level Edit/Delete icons have **no aria-label at all** (not even the fake key above) -- a slightly worse instance of the same accessibility gap. They are targeted via `button:has(svg[data-testid="EditOutlinedIcon"])` / `...DeleteOutlinedIcon` scoped to the row.
- A Task List's row wrapper carries an inline `style="cursor: pointer"` rather than a stable class, confirmed unique to list rows on this page -- used as the scoping root for a given list's Add/Edit/Delete actions instead of a hashed MUI class (which is not stable build-to-build).
- Toasts: unlike Notes, **no toast confirmation was observed** for Task or Task List create/update/delete (the `role="status"` elements exist but were empty/unpopulated immediately after each action, checked live). Tests assert on the resulting UI state instead of toast text.

## Findings / Deviations From the Originally Assumed Spec
1. **Description is optional, not required**, for both Task and Task List -- mirrors Notes' identical finding for its Content field. A title-only item saves successfully.
2. **Title is required** for both entity types. Create is disabled with no title (content-only input), matching Notes.
3. **A newly created, still-empty Task List does not render into the list view until the page is reloaded.** Confirmed live: creating an empty list succeeds server-side (a reload proves it exists) but the view's own client state does not pick it up immediately, unlike an individual Task, which appears right away. `TasksPage.createTaskList()` reloads internally to work around this; every Task List test therefore exercises real, persisted, post-reload state rather than optimistic UI.
4. **Two different delete-confirmation UI patterns exist for the same module.** Deleting a Task via the open detail panel's own Delete action icon replaces the panel body inline with a "Warning" heading and an unnamed-but-"Delete"-labeled confirm button. Deleting a Task List via its row's Delete icon instead opens a distinct, more conventional dialog headed "Delete Task List" with properly named Cancel/Delete buttons. These are not the same component.
5. **The Task detail panel does not auto-close after a confirmed delete.** It is left open showing a stale, emptied-out shell (no title, "No comments yet") rather than closing or navigating away. `TasksPage.deleteTask()` and `editTask()` both explicitly close the panel afterward as a workaround rather than asserting on this (currently broken) behavior.
6. **Copy inconsistency**: the shared edit-mode title field is labeled "Choose a title that defines your Task" even when editing a Task *List* (the create-composer's List-specific field correctly says "...your Task List"). Likewise the description placeholder differs between create ("Add a description…") and edit ("Enter your task description here") for both entity types.
7. **The open Task panel renders its description text in two separate DOM elements simultaneously** (same text, two different `<p>` nodes with different classes), reproducible with both short and long descriptions -- not a truncation/read-more artifact. Assertions use `.first()` via `TasksPage.taskDescriptionText()` to avoid a Playwright strict-mode violation.
8. As with Notes, the exact validation-message copy for "title required" in edit mode was not independently captured; tests assert the reliably observed, common signal (Save disabled) rather than unverified message text.

## Test Data
- Task title: `Automation Test Task` (suffixed with a timestamp per test run via `uniqueTitle()`)
- Task description: `This task was created automatically by Playwright MCP.`
- Task List title: `Automation Test List` -- deliberately **not** a prefix/superset of the Task title above, so the shared-account bulk cleanup (`deleteAllAutomationTasksAndLists()`) can filter each entity type by title prefix without the two loops matching each other's rows.
- Task List description: `This task list was created automatically by Playwright MCP.`
- Long input: ~66-character title, ~4,100-character description (shared base for both entity types)

---

## Test Case Table

| ID | Area | Title | Type | Preconditions | Steps (summary) | Expected Result |
|----|------|-------|------|---------------|------------------|------------------|
| NAV-01 | Navigation | My Tasks page loads from sidebar | Positive | Logged in | Open My Tasks from sidebar | "Add Task" entry point visible |
| NAV-02 | Navigation | "Add Task" offers New Task / New List | Positive | On My Tasks page | Click Add Task | Menu with "New Task" and "New List" shown |
| T-CR-01 | Task / Create | Create task with valid title & description | Positive | On My Tasks page | New Task, fill title+description, create | Task appears in list |
| T-CR-02 | Task / Create | Created task persists after refresh | Positive | Task created | Refresh page | Task still visible |
| T-CR-03 | Task / Create | Cannot save empty task | Negative | Composer open | Leave title & description blank | Create Task disabled |
| T-CR-04 | Task / Create | Cannot save without a title | Negative | Composer open | Fill description only | Create Task disabled |
| T-CR-05 | Task / Create | Description is optional (documented deviation) | Positive | Composer open | Fill title only, create | Task saves successfully |
| T-CR-06 | Task / Create | Long title/description handled | Edge | Composer open | Fill long title & description, create | Task saves successfully, visible in list |
| T-RD-01 | Task / Read | Open task shows correct title/description | Positive | Task exists | Open task | Panel shows exact title & description |
| T-RD-02 | Task / Read | Tasks remain readable after refresh | Positive | Task exists | Refresh, open task | Title & description unchanged |
| T-RD-03 | Task / Read | Large task renders fully | Validation | Long task exists | Open task | Full description shown |
| T-RD-04 | Task / Read | Empty state shown with no items | Validation | No tasks/lists exist | Load My Tasks page | "Add tasks to keep things moving." + both entry cards shown |
| T-UP-01 | Task / Update | Edit title | Positive | Task exists | Open task, change title, save | New title shown, old title gone |
| T-UP-02 | Task / Update | Edit description | Positive | Task exists | Open task, change description, save | New description shown |
| T-UP-03 | Task / Update | Updated values persist after refresh | Positive | Task edited | Refresh, reopen task | Updated title & description shown |
| T-UP-04 | Task / Update | Cannot save after clearing title | Negative | Task open for edit | Clear title field | Save disabled |
| T-DL-01 | Task / Delete | Confirmation appears | Positive | Task exists | Open task, click Delete | "Warning" confirmation with Cancel/Delete shown |
| T-DL-02 | Task / Delete | Cancel keeps the task | Positive | Confirmation open | Click Cancel | Task still present in list |
| T-DL-03 | Task / Delete | Confirm removes the task | Positive | Confirmation open | Click Delete | Task removed from list |
| T-DL-04 | Task / Delete | Deleted task stays gone after refresh | Validation | Task deleted | Refresh page | Task still absent |
| TL-CR-01 | Task List / Create | Create list with valid title & description | Positive | On My Tasks page | New List, fill title+description, create | List appears in view (after internal reload) |
| TL-CR-02 | Task List / Create | Created list persists after a second refresh | Positive | List created | Refresh page again | List still visible |
| TL-CR-03 | Task List / Create | Cannot save empty list | Negative | Composer open | Leave title & description blank | Create List disabled |
| TL-CR-04 | Task List / Create | Cannot save without a title | Negative | Composer open | Fill description only | Create List disabled |
| TL-CR-05 | Task List / Create | Description is optional (documented deviation) | Positive | Composer open | Fill title only, create | List saves successfully |
| TL-UP-01 | Task List / Update | Rename list | Positive | List exists | Click Edit icon, change title, save | New title shown, old title gone |
| TL-UP-02 | Task List / Update | Renamed list persists after refresh | Positive | List renamed | Refresh page | Updated title shown |
| TL-UP-03 | Task List / Update | Cannot save after clearing title | Negative | List open for edit | Clear title field | Save disabled |
| TL-DL-01 | Task List / Delete | Confirmation appears | Positive | List exists | Click row's Delete icon | "Delete Task List" dialog with Cancel/Delete shown |
| TL-DL-02 | Task List / Delete | Cancel keeps the list | Positive | Confirmation open | Click Cancel | List still present |
| TL-DL-03 | Task List / Delete | Confirm removes the list | Positive | Confirmation open | Click Delete | List removed from view |
| TL-DL-04 | Task List / Delete | Deleted list stays gone after refresh | Validation | List deleted | Refresh page | List still absent |

## Automation Mapping
All rows above are automated in `tests/tasks.spec.ts` using the `TasksPage` page object (`pages/TasksPage.ts`) and shared test data (`utils/tasksTestData.ts`), reusing the existing `LoginPage` object and staging credentials for authentication. Run with:

```
npm run test:tasks
```

Every scenario above was executed and passed live against `https://dashboard.staging.zunou.ai` on the `chromium` project as part of writing this suite (2026-07-23); one additional run of TL-CR-02 hit a transient Auth0 login redirect during its own `beforeEach` (unrelated to the page object -- environment/network flake) and passed cleanly on immediate re-run.
