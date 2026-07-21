import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_USERNAME, VALID_PASSWORD } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

/**
 * Post-login (dashboard) smoke suite.
 *
 * Verifies the first authenticated surface Zunou renders after a successful
 * sign-in — the "Welcome / Enter Zunou" landing — loads correctly and hands the
 * user off into the workspace. Complements the pre-auth login suite: login.spec
 * proves you can authenticate; this proves the authenticated app is reachable and
 * renders its expected entry point.
 *
 * Each test authenticates fresh through the real login flow (no shared storage
 * state) to keep the smoke check end-to-end and independent.
 */

async function signIn(page: Page): Promise<DashboardPage> {
  const loginPage = new LoginPage(page);
  await loginPage.goto(DEFAULT_LOGIN_URL);
  await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
  await loginPage.assertLoginSuccess();
  return new DashboardPage(page);
}

test.describe('Post-login dashboard smoke', () => {
  test('renders the welcome landing for the signed-in user', async ({ page }) => {
    const dashboard = await signIn(page);
    await dashboard.assertLoaded(VALID_USERNAME);
  });

  test('shows the onboarding sections (computer, phone, coding agent)', async ({ page }) => {
    const dashboard = await signIn(page);
    await dashboard.assertLoaded();
    await dashboard.assertOnboardingSections();
  });

  test('lists the coding-agent connect cards', async ({ page }) => {
    const dashboard = await signIn(page);
    await dashboard.assertLoaded();
    await dashboard.assertCodingAgentCards(['Codex', 'Cursor', 'Claude Code']);
  });

  test('"Enter Zunou" leaves the landing and enters the workspace', async ({ page }) => {
    const dashboard = await signIn(page);
    await dashboard.assertLoaded();
    await dashboard.enterWorkspace();
    // The pre-auth login controls must not reappear after entering the workspace.
    await expect(page.getByLabel(/Email address/i)).toHaveCount(0);
  });
});
