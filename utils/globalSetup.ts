import { chromium } from '@playwright/test';
import { DEFAULT_LOGIN_URL, accountForWorker } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';

/** Long enough to sit through a genuine cold boot; see below for why it may fail. */
const WARMUP_TIMEOUT_MS = 120000;

/**
 * Signs in once, on one account, BEFORE any worker starts.
 *
 * WHY: the account preflight in testFixtures.ts kept failing on the first
 * attempt and passing on the retry, and the discriminating evidence is in run
 * 34071062516. All three workers failed the preflight's provisional-denial
 * confirmation at ~55s (login, then the 45s wait for Home expiring). Roughly
 * 30s later all three retried CONCURRENTLY -- same three simultaneous logins,
 * same three accounts -- and all three passed in ~15s.
 *
 * That exonerates concurrency, which was the obvious suspect and the wrong
 * one: three logins at once are fine. What differed between the two rounds is
 * that the app was warm. The slow thing is specifically the post-auth
 * membership query -- "Access Denied" is what this app paints while that query
 * is still in flight -- so warming the login page alone would not touch it.
 * The warm-up therefore does a FULL login, because that is the only way to put
 * the query that is actually slow on the warm path.
 *
 * Paying one serial login here (~15-20s) buys back 3 x 45s of expired waits
 * plus three retried tests, so it is well clear of break-even.
 *
 * NEVER FATAL. This is an optimisation, not a gate: a run whose warm-up fails
 * is still a run worth having, and the per-worker preflight remains the thing
 * that actually decides whether an account can reach a workspace. Throwing
 * here would turn a slow staging environment into zero test results, which is
 * the failure mode this repo already learned the hard way when 25 scheduled
 * runs cancelled at the job timeout and produced no artifacts at all.
 */
export default async function globalSetup() {
  const started = Date.now();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const account = accountForWorker(0);
    const loginPage = new LoginPage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(account.username, account.password);

    await page
      .getByRole('button', { name: 'Home', exact: true })
      .waitFor({ state: 'visible', timeout: WARMUP_TIMEOUT_MS });

    console.log(`[warm-up] workspace reachable after ${Date.now() - started}ms`);
  } catch (error) {
    // Report it loudly enough to read in the log, then get out of the way.
    console.warn(
      `[warm-up] failed after ${Date.now() - started}ms -- continuing anyway; ` +
        `the per-worker preflight still guards account access. Cause: ${error}`
    );
  } finally {
    await context.close();
    await browser.close();
  }
}
