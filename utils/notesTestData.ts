/** Base test data for Notes CRUD scenarios, per the automation test plan. */
export const NOTE_TITLE = 'Automation Test Note';
export const NOTE_CONTENT = 'This note was created automatically by Playwright MCP.';

export const UPDATED_NOTE_TITLE = 'Updated Automation Test Note';
export const UPDATED_NOTE_CONTENT = 'This note has been updated automatically.';

// The Title field enforces maxlength="100" natively; uniqueTitle() appends
// a timestamp-random suffix (~18 chars) to keep titles collision-free, so
// this base is kept short enough that the combined string never gets
// silently truncated mid-type.
export const LONG_TITLE = 'Long Title '.repeat(6).trim();
export const LONG_CONTENT = 'This is a long note body used for large-input validation. '.repeat(8).trim();

/**
 * Appends a run-scoped suffix so parallel/repeated runs never collide on
 * titles inside the same shared staging account.
 */
export function uniqueTitle(base: string): string {
  return `${base} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
