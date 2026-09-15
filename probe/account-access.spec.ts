/**
 * TM2-T014 PROBE -- does each staging account in PR #21's worker pool still
 * reach a workspace?
 *
 * WHY THIS EXISTS
 * PR #21 gives every Playwright worker its own staging account so the suite can
 * run in parallel. It does NOT introduce new accounts: worker slot 1 uses
 * LOGIN_TEST_USER, slot 2 borrows LOGIN_TEST_USER_FIREFOX and slot 3 borrows
 * LOGIN_TEST_USER_WEBKIT (see the branch's .github/workflows/playwright.yml).
 *
 * On 31 Jul run 30616552193 ran all 68 tests on 3 workers, 65 passed. Today the
 * same pool fails in slot 2, and the failure is PR #21's own access preflight
 * (utils/testFixtures.ts) reporting "authenticates but has no workspace access".
 * That preflight cannot tell a REVOKED INVITE from a slow permissions query, so
 * the open question on TM2-T014 has been "did slot 2's account lose staging
 * access since 31 Jul?" -- a question about the ACCOUNT, not about the code.
 *
 * This probe answers it directly and separately from the suite: log each pool
 * account in, and classify the outcome. It is READ-ONLY -- it signs in and looks
 * at the sidebar. It creates, edits and deletes nothing, so it cannot disturb a
 * concurrent run's fixtures the way notes/tasks beforeAll hooks would.
 *
 * READING THE RESULT
 *   arm passes -> that account authenticates AND reaches a workspace.
 *   arm fails "no workspace access" -> that account's invite is the problem.
 *   arm fails "credentials rejected" -> the secret itself is stale/rotated.
 * All three arms run (no serial mode), so one dead account never hides another.
 *
 * -- MeQAtron
 */
import { expect, test, type Browser } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

/** Matches PR #21's PREFLIGHT_TIMEOUT_MS so this probe sees what slot 2 sees. */
const PREFLIGHT_TIMEOUT_MS = 45000;

const LOGIN_URL = process.env.LOGIN_PAGE_URL;

type PoolAccount = {
  /** The worker slot this account is handed to by PR #21's pool. */
  slot: number;
  userVar: string;
  passwordVar: string;
};

/**
 * The pool EXACTLY as PR #21 assembles it, slot order included -- the point of
 * the probe is to test the accounts that branch would really use.
 */
const POOL: PoolAccount[] = [
  { slot: 1, userVar: 'LOGIN_TEST_USER', passwordVar: 'LOGIN_TEST_PASSWORD' },
  { slot: 2, userVar: 'LOGIN_TEST_USER_FIREFOX', passwordVar: 'LOGIN_TEST_PASSWORD_FIREFOX' },
  { slot: 3, userVar: 'LOGIN_TEST_USER_WEBKIT', passwordVar: 'LOGIN_TEST_PASSWORD_WEBKIT' },
];

async function classifyAccess(browser: Browser, account: PoolAccount) {
  const username = process.env[account.userVar];
  const password = process.env[account.passwordVar];

  // A missing secret is a real finding, not a reason to skip quietly: slot 2
  // with no credentials is exactly how the pool silently shrinks.
  expect(username, `${account.userVar} is not set`).toBeTruthy();
  expect(password, `${account.passwordVar} is not set`).toBeTruthy();
  expect(LOGIN_URL, 'LOGIN_PAGE_URL is not set').toBeTruthy();

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const loginPage = new LoginPage(page);
    await loginPage.goto(LOGIN_URL as string);
    await loginPage.login(username as string, password as string);

    // Separating this from the workspace check is the whole diagnostic value:
    // it splits "the secret is stale" from "the invite is gone".
    await expect(
      loginPage.usernameInput,
      `credentials rejected for ${account.userVar} -- the login form is still up, so this secret no longer authenticates`
    ).toBeHidden({ timeout: PREFLIGHT_TIMEOUT_MS });

    const accessDenied = page.getByText(/Access Denied/i).first();
    const home = page.getByRole('button', { name: 'Home', exact: true });

    await expect(
      accessDenied.or(home),
      `${account.userVar} signed in but painted neither a workspace nor a denial within ${PREFLIGHT_TIMEOUT_MS}ms`
    ).toBeVisible({ timeout: PREFLIGHT_TIMEOUT_MS });

    // A denial is PROVISIONAL: this app paints "Access Denied" before its
    // permissions query resolves, so first-past-the-post reads the
    // pre-resolution frame as a verdict (run 34066137713 failed 3 dashboard
    // tests that way at 1.5s while the workspace arrived ~18s later). Only a
    // denial that OUTLASTS the workspace wait is real. Same rule as PR #21's
    // preflight -- deliberately, so a pass here means slot N would pass there.
    if (await accessDenied.isVisible()) {
      const reachedWorkspace = await home
        .waitFor({ state: 'visible', timeout: PREFLIGHT_TIMEOUT_MS })
        .then(() => true, () => false);

      expect(
        reachedWorkspace,
        `${account.userVar} (${username}) authenticates but has NO WORKSPACE ACCESS -- ` +
          `"Access Denied" outlasted a ${PREFLIGHT_TIMEOUT_MS}ms workspace wait. ` +
          `Its staging invite needs restoring before PR #21's worker slot ${account.slot} can run.`
      ).toBeTruthy();
    }
  } finally {
    await context.close();
  }
}

for (const account of POOL) {
  test(`pool slot ${account.slot} (${account.userVar}) reaches a staging workspace`, async ({ browser }) => {
    await classifyAccess(browser, account);
  });
}
