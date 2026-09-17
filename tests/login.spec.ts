import path from 'path';
import { expect, test, type Page, type Response } from '../utils/testFixtures';
import { DEFAULT_LOGIN_URL } from '../credentials/loginCredentials';
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

async function assertNotAuthenticated(page: Page, loginPage: LoginPage, response?: Response) {
  await loginPage.assertLoginPageVisible();

  const currentUrl = new URL(page.url());
  const currentHost = currentUrl.hostname;
  const baseHost = new URL(DEFAULT_LOGIN_URL).hostname;
  const stillOnLoginHost = currentHost === baseHost;
  const stillOnLoginPath = /login|signin|auth/i.test(currentUrl.pathname);

  expect(stillOnLoginHost || stillOnLoginPath).toBeTruthy();

  const AUTH0_TRANSACTION_COOKIES = new Set(['auth0', 'auth0_compat']);
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => /session|token/i.test(cookie.name) || (/auth/i.test(cookie.name) && !AUTH0_TRANSACTION_COOKIES.has(cookie.name))
  );
  expect(sessionCookie).toBeUndefined();

  const errorMessage = await loginPage.getErrorMessage();
  const errorVisible = (await errorMessage.count()) > 0;
  const authRequestFailed = (response?.status() ?? 0) >= 400;

  expect(errorVisible || authRequestFailed || !response).toBeTruthy();
}

async function assertOutcome(response: Response | undefined, loginPage: LoginPage, expectedMode: 'success' | 'failure') {
  if (expectedMode === 'success') {
    expect(response).toBeDefined();
    expect(response?.status()).toBeGreaterThanOrEqual(200);
    expect(response?.status()).toBeLessThan(400);
    await loginPage.assertLoginSuccess();
    return;
  }

  await assertNotAuthenticated(loginPage.page, loginPage, response);
}

test.describe('Login page automation', () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === 'passed') {
      return;
    }

    const screenshotPath = buildScreenshotPath(testInfo, 'failed');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('login-page-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test('happy path login with valid credentials', async ({ page, account }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(account.username, account.password);

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'success');

    expect(responses.length).toBeGreaterThan(0);
    expect(responses.some((entry) => entry.status >= 200 && entry.status < 500)).toBeTruthy();
  });

  test('negative login with invalid username', async ({ page, account }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login('invalid.user@example.test', account.password);

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'failure');
  });

  test('negative login with invalid password', async ({ page, account }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(account.username, 'wrong-password');

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'failure');
  });

  test('empty fields login attempt', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login('', '');

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'failure');
  });

  test('long input login attempt', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    const longText = 'a'.repeat(256);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(longText, longText);

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'failure');
  });

  test('special characters login attempt', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const responses: Array<{ status: number; url: string; ok: boolean }> = [];
    captureAuthResponse(page, responses);

    const specialText = '!@#$%^&*()_+-=<>?/[]{}|;:\'",.\\';

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(specialText, specialText);

    const response = await waitForLoginResponse(page);
    await assertOutcome(response, loginPage, 'failure');
  });

  test('repeated login attempts do not crash the page', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login('invalid.user@example.test', 'wrong-password');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await loginPage.login('invalid.user@example.test', 'wrong-password');

    await loginPage.assertLoginPageVisible();
  });

  test('refresh keeps the login form available', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await loginPage.assertLoginPageVisible();
  });

  test('back/forward navigation returns to the login page', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await page.goBack().catch(() => undefined);
    await page.goForward().catch(() => undefined);

    await loginPage.assertLoginPageVisible();
  });
});
