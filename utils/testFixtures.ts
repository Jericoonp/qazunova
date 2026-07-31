import { test as base, expect as baseExpect, type Browser } from '@playwright/test';
import {
  DEFAULT_LOGIN_URL,
  accountForWorker,
  type StagingAccount,
} from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';

/** A worker's one-off access check gets its own budget, separate from any test. */
const PREFLIGHT_TIMEOUT_MS = 45000;

/**
 * Signs the account in once and proves it can actually reach a workspace.
 *
 * WHY THIS IS NOT PARANOIA: LoginPage.assertLoginSuccess() only checks that the
 * login form went away, so it passes for an account that authenticates fine but
 * has no organization membership -- Zunou answers those with a full-page
 * "Access Denied ... Contact your administrator for an invite" and no sidebar.
 * Run 30608966671 hit exactly that on a pool account: every sidebar click then
 * waited out its full timeout (300s in notes.spec's beforeAll, 90s per retry),
 * and the run read as four minutes of mysterious Notes flakiness instead of one
 * un-invited account. Failing here instead turns that into a one-line config
 * error naming the env var to fix.
 */
async function assertAccountCanReachWorkspace(browser: Browser, account: StagingAccount) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const loginPage = new LoginPage(page);
    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(account.username, account.password);
    await loginPage.assertLoginSuccess();

    const accessDenied = page.getByText(/Access Denied/i).first();
    // Anything signed in and invited renders the workspace sidebar; Home is the
    // one entry every account has, whatever its pulses look like. Waiting on
    // "either outcome" rather than on Home alone is what keeps the denied case
    // fast -- otherwise this preflight just moves the long hang, it doesn't
    // remove it.
    await baseExpect(accessDenied.or(page.getByRole('button', { name: 'Home', exact: true })))
      .toBeVisible({ timeout: PREFLIGHT_TIMEOUT_MS });

    if (await accessDenied.isVisible()) {
      throw new Error(
        `Staging account from ${account.source} authenticates but has no workspace access ` +
          `("Access Denied -- contact your administrator for an invite"). Invite ${account.username} ` +
          `to the staging organization, or unset ${account.source} to drop the worker slot.`
      );
    }
  } finally {
    await context.close();
  }
}

/**
 * The suite's shared `test` object.
 *
 * It adds ONE worker-scoped fixture, `account`: the staging account this
 * worker owns for the whole of its life. Every spec that signs in should
 * import `test` from here and use `account.username` / `account.password`
 * instead of the module-level VALID_USERNAME / VALID_PASSWORD constants --
 * those two are now only for the login suite's own credential assertions.
 *
 * Worker scope, not test scope, is the point: it means the account is picked
 * once per worker process and every test that worker runs stays on it, so the
 * "one account, one thing happening to it at a time" guarantee that the
 * destructive beforeAll hooks rely on still holds under parallelism. The same
 * scope is why the access preflight below costs one login per worker, not one
 * per test.
 *
 * See credentials/loginCredentials.ts for how the pool is assembled and why
 * this is keyed on parallelIndex.
 */
export const test = base.extend<{}, { account: StagingAccount }>({
  account: [
    async ({ browser }, use, workerInfo) => {
      const account = accountForWorker(workerInfo.parallelIndex);
      await assertAccountCanReachWorkspace(browser, account);
      await use(account);
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
export type { Page, Response } from '@playwright/test';
