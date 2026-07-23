/** Base test data for My Tasks (Task and Task List) CRUD scenarios. */
export const TASK_TITLE = 'Automation Test Task';
export const TASK_DESCRIPTION = 'This task was created automatically by Playwright MCP.';

export const UPDATED_TASK_TITLE = 'Updated Automation Test Task';
export const UPDATED_TASK_DESCRIPTION = 'This task has been updated automatically.';

// Deliberately does NOT start with "Automation Test Task" (TASK_TITLE's
// prefix) -- TasksPage's bulk cleanup (deleteAllTasksAndLists) filters
// leftover rows by title prefix, and a shared prefix between the two would
// make a task list row match the task-cleanup filter (and vice versa),
// each expecting the other entity's DOM shape.
export const TASK_LIST_TITLE = 'Automation Test List';
export const TASK_LIST_DESCRIPTION = 'This task list was created automatically by Playwright MCP.';

export const UPDATED_TASK_LIST_TITLE = 'Updated Automation Test List';
export const UPDATED_TASK_LIST_DESCRIPTION = 'This task list has been updated automatically.';

// Neither title field enforces a native maxlength (unlike Notes' Title
// input), but keeping the base short enough to combine with uniqueTitle()'s
// suffix avoids the long-input tests accidentally exceeding whatever limit
// the field does turn out to have.
export const LONG_TITLE = 'Long Title '.repeat(6).trim();
export const LONG_DESCRIPTION = 'This is a long description used for large-input validation. '.repeat(8).trim();

/**
 * Appends a run-scoped suffix so parallel/repeated runs never collide on
 * titles inside the same shared staging account.
 */
export function uniqueTitle(base: string): string {
  return `${base} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
