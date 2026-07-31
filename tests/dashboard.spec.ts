import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_USERNAME, VALID_PASSWORD } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

/**
 * Post-login (dashboard) smoke suite.
 *
 * Verifies that a successful sign-in actually delivers the user into their
 * workspace Home, with its navigation and assistant composer rendered.
 * Complements the pre-auth login suite: login.spec proves you can
 * authenticate; this proves the authenticated app is reachable and renders.
 *
 * These tests used to assert the "Welcome / Enter Zunou" landing instead. That
 * screen only appears on a first run, so once the shared staging account
 * finished onboarding, all four tests failed on every browser, every run --
 * see the note at the top of DashboardPage.ts. The landing is now dismissed
 * if present rather than required, which is how every other page object in
 * this repo has always treated it.
 *
 * Each test authenticates fresh through the real login flow (no shared storage
 * state) to keep the smoke check end-to-end and independent. Login plus the
 * onboarding dismissal alone costs 15-20s against slow staging, so the file
 * carries the same 90s budget as notes.spec.ts / tasks.spec.ts / pulse.spec.ts.
 */

async function signIn(page: Page): Promise<DashboardPage> {
  const loginPage = new LoginPage(page);
  await loginPage.goto(DEFAULT_LOGIN_URL);
  await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
  await loginPage.assertLoginSuccess();
  const dashboard = new DashboardPage(page);
  await dashboard.dismissOnboardingIfPresent();
  return dashboard;
}

test.describe('Post-login dashboard smoke', () => {
  test.describe.configure({ timeout: 90000 });

  test('lands the signed-in user on their workspace home', async ({ page }) => {
    const dashboard = await signIn(page);
    await dashboard.assertLoaded(VALID_USERNAME);
  });

  test('renders the workspace navigation', async ({ page }) => {
    const dashboard = await signIn(page);
    await dashboard.assertLoaded();
    await dashboard.assertWorkspaceChrome();
  });

  test('offers the assistant composer on home', async ({ page }) => {
    const dashboard = await signIn(page);
    await dashboard.assertLoaded();
    await dashboard.assertAssistantComposer();
  });

  test('keeps the session authenticated across a reload', async ({ page }) => {
    const dashboard = await signIn(page);
    await dashboard.assertLoaded();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await dashboard.dismissOnboardingIfPresent();

    // Still in the workspace, and the pre-auth login controls must not reappear.
    await dashboard.assertLoaded();
    await expect(page.getByLabel(/Email address/i)).toHaveCount(0);
  });
});
