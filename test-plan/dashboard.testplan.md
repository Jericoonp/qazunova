# Post-Login Dashboard Smoke Test Plan

## Objective
Validate the first authenticated surface Zunou renders after a successful sign-in —
the "Welcome / Enter Zunou" landing — and its hand-off into the workspace. This
complements the pre-auth login suite: the login suite proves a user can
authenticate; this suite proves the authenticated app is reachable and renders its
expected entry point.

## Scope
- Post-login landing renders for the signed-in user (Welcome heading, signed-in
  email, enabled "Enter Zunou" call-to-action).
- Onboarding sections present: "Zunou on your computer", "Zunou on your phone",
  "Connect Zunou to your coding agent".
- Coding-agent (MCP) connect cards are listed (Codex, Cursor, Claude Code).
- "Enter Zunou" transitions out of the landing route into the workspace, and the
  pre-auth login controls do not reappear.

## Assumptions
- A valid QA account is provided via environment variables (`LOGIN_TEST_USER`,
  `LOGIN_TEST_PASSWORD`) and `LOGIN_PAGE_URL` points at the target environment
  (staging by default).
- Locators are anchored on accessible roles and visible text, not hashed MUI CSS
  classes, so styling/build changes do not break the suite.
- The workspace home route is account/state dependent; the suite asserts observable
  behavior (leaving the `/landing/` route) rather than a hardcoded destination.

## Out of scope (future increments)
- Deep workspace features (chats/topics, tasks, notes, calendar, meetings). The
  workspace home currently surfaces first-run onboarding modals (product tour,
  timezone-mismatch prompt) that make deep assertions brittle until dismissed
  deterministically; those tests are deferred to a follow-up PR.

## Coverage
1. Landing renders — Welcome heading + signed-in email + enabled "Enter Zunou".
2. Onboarding sections visible.
3. Coding-agent connect cards listed.
4. "Enter Zunou" enters the workspace; login controls absent afterward.

## Environments
- Default: staging (`dashboard.staging.zunou.ai`).
- Executed in CI across chromium / firefox / webkit via the shared Playwright
  projects; verified green on chromium against staging during authoring.
