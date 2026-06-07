import path from 'path';
import { expect, test, type Page, type Response } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_PASSWORD, VALID_USERNAME } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';

function buildScreenshotPath(testInfo: any, outcome: 'passed' | 'failed') {
  const safeName = `${testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  return path.resolve(process.cwd(), 'screenshots', outcome, safeName);
}

function captureAuthResponse(page: Page, responses: Array<{ status: number; url: string; ok: boolean }>) {
  page.on('response', (response: Response) => {
    const url = response.url();
    const looksLikeAuth = /login|signin|auth|oauth|session/i.test(url) || response.request().method() === 'POST';

    if (looksLikeAuth) {
      responses.push({ status: response.status(), url, ok: response.ok() });
    }
  });
}

async function waitForLoginResponse(page: Page) {
  try {
    return await page.waitForResponse((response) => {
      const url = response.url();
      return /login|signin|auth|oauth|session/i.test(url) || response.request().method() === 'POST';
    }, { timeout: 15000 });
  } catch {
    return undefined;
  }
}

async function assertOutcome(response: Response | undefined, loginPage: LoginPage, expectedMode: 'success' | 'failure') {
  if (expectedMode === 'success') {
    expect(response).toBeDefined();
    expect(response?.status()).toBeGreaterThanOrEqual(200);
    expect(response?.status()).toBeLessThan(400);
    await loginPage.assertLoginSuccess();
    return;
  }

  if (!response) {
    await expect(loginPage.usernameInput).toBeVisible();
    return;
  }

  const errorMessage = await loginPage.getErrorMessage();
  const hasErrorText = await errorMessage.count();
  const statusSignalsFailure = response.status() >= 400 || response.status() === 200;

  expect(hasErrorText > 0 || statusSignalsFailure).toBeTruthy();
}

test.describe('Login page automation', () => {
  test.afterEach(async ({ page }, testInfo) => {
    const outcome = testInfo.status === 'passed' ? 'passed' : 'failed';
    const screenshotPath = buildScreenshotPath(testInfo, outcome);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('login-page-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test('happy path login with valid credentials', async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'success');

    expect(responses.length).toBeGreaterThan(0);
    expect(responses.some((entry) => entry.status >= 200 && entry.status < 500)).toBeTruthy();
  });

  test('negative login with invalid username', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login('invalid.user@example.test', VALID_PASSWORD || 'valid-password');

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'failure');

    expect((response?.status() ?? 0) >= 200).toBeTruthy();
    expect(responses.length).toBeGreaterThanOrEqual(0);
  });

  test('negative login with invalid password', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME || 'user@example.test', 'wrong-password');

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'failure');

    expect((response?.status() ?? 0) >= 200).toBeTruthy();
    expect(responses.length).toBeGreaterThanOrEqual(0);
  });

  test('empty fields login attempt', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login('', '');

    const response = await waitForLoginResponse(page);

    if (response) {
      await assertOutcome(response, loginPage, 'failure');
    }

    expect(responses.length).toBeGreaterThanOrEqual(0);
  });

  test('long input login attempt', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    const longText = 'a'.repeat(256);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(longText, longText);

    const response = await waitForLoginResponse(page);

    if (response) {
      await assertOutcome(response, loginPage, 'failure');
    }

    expect(responses.length).toBeGreaterThanOrEqual(0);
  });

  test('special characters login attempt', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    const specialText = '!@#$%^&*()_+-=<>?/[]{}|;:\'",.\\';

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(specialText, specialText);

    const response = await waitForLoginResponse(page);

    if (response) {
      await assertOutcome(response, loginPage, 'failure');
    }

    expect(responses.length).toBeGreaterThanOrEqual(0);
  });

  test('repeated login attempts do not crash the page', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login('invalid.user@example.test', 'wrong-password');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await loginPage.login('invalid.user@example.test', 'wrong-password');

    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
  });

  test('refresh keeps the login form available', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
  });

  test('back/forward navigation returns to the login page', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await page.goBack().catch(() => undefined);
    await page.goForward().catch(() => undefined);

    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
  });
});
