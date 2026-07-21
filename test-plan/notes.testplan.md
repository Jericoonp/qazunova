# Notes Module Test Plan

## Objective
Validate CRUD (Create, Read, Update, Delete) functionality of the "My Notes" module inside a workspace Pulse on the staging Zunou dashboard (`https://dashboard.staging.zunou.ai`), using the reusable Playwright + Page Object Model framework already established for the login suite.

## Scope
- Sidebar navigation into the Notes section and initial page-load state.
- Create Note: composer field validation, save behavior, and post-create state (list + toast + refresh persistence).
- Read Note: opening a note, verifying displayed title/content, empty state, large-content rendering, and note ordering.
- Update Note: editing title/content, save validation, and refresh persistence of edits.
- Delete Note: confirmation modal, cancel path, confirm path, and refresh behavior after deletion.

## Environment & Access
- URL: `LOGIN_PAGE_URL` (`https://dashboard.staging.zunou.ai`)
- Auth: `LOGIN_TEST_USER` / `LOGIN_TEST_PASSWORD` (staging-only test account), via the existing `LoginPage` object.
- After login, the app lands on an intermediate `/landing/{orgId}` screen; tests click "Enter Zunou" to reach the workspace, dismiss the first-run onboarding tour ("Skip"), then open **Notes** from the left sidebar (behind a **More** toggle if the sidebar is in its collapsed state).

## DOM / Selector Findings (live inspection via Playwright MCP)
- The app has **no `data-testid` attributes** anywhere in the inspected views. Selectors below use `getByRole`/`getByText` wherever an accessible name exists.
- The **Title** field is a plain `<input placeholder="Title">` with no `aria-label`; its accessible name resolves from the `placeholder` attribute, so `getByRole('textbox', { name: 'Title' })` is reliable.
- The **content field** is a Quill rich-text editor (`div[contenteditable]`) with **no role, aria-label, or aria-multiline** — a genuine accessibility gap. It is targeted via its `data-placeholder="Type your note here"` attribute, the most stable hook currently available.
- The note **create composer** renders inline in the list column; opening an **existing note** renders a proper `role="dialog"`. Both expose a "Title" textbox and "Save" button, so dialog-scoped locators are always resolved through the dialog root to avoid ambiguity.
- The **delete confirmation panel does not use `role="dialog"`** (recommend the dev team add this — see Findings below) and is portaled after the note dialog in the DOM.
- Toasts render as `role="status"` elements with the message as accessible text (e.g. "Note created successfully", "Note updated successfully").

## Findings / Deviations From the Original Assumed Spec
1. **Content is optional, not required.** The originally assumed negative case "user cannot save without content" does **not** hold on this build: a note with only a title saves successfully (a "Missing content" toolbar icon is shown, but Save is enabled and the request succeeds). The test suite documents this as a verified deviation rather than asserting the originally assumed behavior.
2. **Title is required.** Save stays disabled with content-only input, and disabled again if an existing note's title is cleared. This matches the originally assumed "cannot save without a title" case.
3. **Inline validation differs by context.** In the *create composer*, Save simply stays disabled with no visible message. In the *edit dialog* for an existing note, clearing the title shows an inline "Note title is required" message below the field (in addition to disabling Save) -- and while that message is showing, the dialog cannot be dismissed via Escape or a backdrop click, only by making the title valid again or using the explicit Delete action. Tests assert the disabled Save state (the behavior common to both contexts) rather than the message string.
4. **Accessibility gap:** the delete-confirmation panel lacks `role="dialog"` and the rich-text editor lacks any ARIA role/label — flagged for the dev team, and selectors were written defensively around it.
5. The exact delete-success toast copy could not be captured live before it auto-dismissed; the suite instead asserts the reliable, confirmed signal (the note is removed from the list), and does not hard-assert unverified toast text for delete specifically.

## Test Data
- Title: `Automation Test Note` (suffixed with a timestamp per test run via `uniqueTitle()` to avoid collisions on the shared staging account)
- Content: `This note was created automatically by Playwright MCP.`
- Updated title: `Updated Automation Test Note`
- Updated content: `This note has been updated automatically.`
- Long input: ~500-character title, ~5,700-character content

---

## Gherkin Scenarios

```gherkin
Feature: Notes navigation

  Scenario: Notes page loads from the sidebar
    Given I am logged in and inside a workspace
    When I open "Notes" from the left sidebar
    Then the "My Notes" page loads successfully

  Scenario: Create Note entry point is available
    Given I am on the Notes page
    Then a "Take a Note" button is visible

Feature: Create Note

  Scenario: Create a note with valid title and content
    Given I am on the Notes page
    When I start a new note
    And I enter the title "Automation Test Note"
    And I enter the content "This note was created automatically by Playwright MCP."
    And I save the note
    Then a "Note created successfully" confirmation is shown
    And the note appears in the notes list

  Scenario: Newly created note survives a page refresh
    Given I have created a note titled "Automation Test Note"
    When I refresh the page
    Then the note titled "Automation Test Note" is still visible

  Scenario: Cannot save a completely empty note
    Given I start a new note
    When I leave the title and content empty
    Then the Save action is disabled

  Scenario: Cannot save a note without a title
    Given I start a new note
    When I enter content but leave the title empty
    Then the Save action is disabled

  Scenario: Content is optional when a title is provided
    Given I start a new note
    When I enter a title and leave the content empty
    And I save the note
    Then a "Note created successfully" confirmation is shown
    And the note appears in the notes list

  Scenario: Long title and content are handled without error
    Given I start a new note
    When I enter a very long title and a very long content body
    And I save the note
    Then the note saves successfully and appears in the list

Feature: Read Note

  Scenario: Open an existing note and see the correct details
    Given a note titled "Automation Test Note" exists
    When I open that note
    Then the title field shows "Automation Test Note"
    And the content field shows "This note was created automatically by Playwright MCP."

  Scenario: Notes remain readable after a refresh
    Given a note titled "Automation Test Note" exists
    When I refresh the page and open that note
    Then the title and content are unchanged

  Scenario: Empty state is shown when there are no notes
    Given there are no notes in the workspace
    Then a "No notes yet" empty state is displayed

  Scenario: A large note renders its full content
    Given a note with a very long content body exists
    When I open that note
    Then the full content body is displayed

  Scenario: Notes appear in the correct order
    Given I create note "A" followed by note "B"
    Then note "B" appears above note "A" in the list

Feature: Update Note

  Scenario: Edit a note's title
    Given a note titled "Automation Test Note" exists
    When I change its title to "Updated Automation Test Note" and save
    Then a "Note updated successfully" confirmation is shown
    And the note list shows the updated title instead of the old one

  Scenario: Edit a note's content
    Given a note exists
    When I change its content and save
    Then a "Note updated successfully" confirmation is shown
    And the note list shows the updated content preview

  Scenario: Updated values persist after a refresh
    Given I have edited a note's title and content
    When I refresh the page and reopen the note
    Then the updated title and content are still shown

  Scenario: Cannot save a note after clearing its title
    Given an existing note is open for editing
    When I clear its title
    Then the Save action is disabled

Feature: Delete Note

  Scenario: Deleting a note asks for confirmation
    Given a note exists and is open
    When I choose to delete it
    Then a confirmation panel asks "Are you sure you want to delete this note?"

  Scenario: Cancelling a delete keeps the note
    Given the delete confirmation panel is open
    When I choose "Cancel"
    Then the note still exists in the list

  Scenario: Confirming a delete removes the note
    Given the delete confirmation panel is open
    When I choose "Delete"
    Then the note no longer appears in the list

  Scenario: A deleted note does not come back after a refresh
    Given I have deleted a note
    When I refresh the page
    Then the note still does not appear in the list
```

---

## Test Case Table

| ID | Area | Title | Type | Preconditions | Steps (summary) | Expected Result |
|----|------|-------|------|---------------|------------------|------------------|
| NAV-01 | Navigation | Notes page loads from sidebar | Positive | Logged in | Open Notes from sidebar | "My Notes" heading + composer visible |
| NAV-02 | Navigation | Create Note button exists | Positive | On Notes page | Inspect page | "Take a Note" button visible |
| CR-01 | Create | Create note with valid title & content | Positive | On Notes page | Start note, fill title+content, save | Toast "Note created successfully"; note in list |
| CR-02 | Create | Created note persists after refresh | Positive | Note created | Refresh page | Note still visible |
| CR-03 | Create | Cannot save empty note | Negative | Composer open | Leave title & content blank | Save button disabled |
| CR-04 | Create | Cannot save without a title | Negative | Composer open | Fill content only | Save button disabled |
| CR-05 | Create | Content is optional (documented deviation) | Positive | Composer open | Fill title only, save | Note saves successfully |
| CR-06 | Create | Long title/content handled | Edge | Composer open | Fill ~500-char title, ~5.7k-char content, save | Note saves successfully, visible in list |
| RD-01 | Read | Open note shows correct title/content | Positive | Note exists | Open note | Dialog shows exact title & content |
| RD-02 | Read | Notes remain readable after refresh | Positive | Note exists | Refresh, open note | Title & content unchanged |
| RD-03 | Read | Empty state shown with no notes | Validation | No notes exist | Load Notes page | "No notes yet" message shown |
| RD-04 | Read | Large note renders fully | Validation | Long note exists | Open note | Full content body shown |
| RD-05 | Read | Notes appear in correct order | Validation | Two notes created in sequence | Inspect list order | Most recently created note listed first |
| UP-01 | Update | Edit title | Positive | Note exists | Open note, change title, save | Toast "Note updated successfully"; new title shown |
| UP-02 | Update | Edit content | Positive | Note exists | Open note, change content, save | Toast shown; new content preview shown |
| UP-03 | Update | Updated values persist after refresh | Positive | Note edited | Refresh, reopen note | Updated title & content shown |
| UP-04 | Update | Cannot save after clearing title | Negative | Note open for edit | Clear title field | Save button disabled |
| DL-01 | Delete | Confirmation modal appears | Positive | Note exists | Open note, click Delete | Confirmation panel with Cancel/Delete shown |
| DL-02 | Delete | Cancel keeps the note | Positive | Confirmation open | Click Cancel | Note still present in list |
| DL-03 | Delete | Confirm removes the note | Positive | Confirmation open | Click Delete | Note removed from list |
| DL-04 | Delete | Deleted note stays gone after refresh | Validation | Note deleted | Refresh page | Note still absent |

## Automation Mapping
All rows above are automated in `tests/notes.spec.ts` using the `NotesPage` page object (`pages/NotesPage.ts`) and shared test data (`utils/notesTestData.ts`), reusing the existing `LoginPage` object and staging credentials for authentication. Run with:

```
npm run test:notes
```
