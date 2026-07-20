# qazunova

This repository contains a Playwright login automation suite for a staging-only authentication flow.

## Prerequisites

- Node.js LTS
- npm
- A staging environment URL and a dedicated test account

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill in the staging `LOGIN_PAGE_URL`, `LOGIN_TEST_USER`, and `LOGIN_TEST_PASSWORD` values.
3. Install dependencies:

   npm ci

4. Run the login suite:

   npx playwright test tests/login.spec.ts

## CI / GitHub Actions

The workflow in `.github/workflows/playwright.yml` reads the login credentials from repository secrets:

- `LOGIN_PAGE_URL`
- `LOGIN_TEST_USER`
- `LOGIN_TEST_PASSWORD`

Do not commit live production credentials or any fallback password into the repository.

## Security notes

- Credentials are environment-driven only.
- The suite is expected to target a staging login endpoint and a dedicated test user.
- Screenshots and test artifacts are retained only on failure and ignored by git.
