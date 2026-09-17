import { expect, type Locator, type Page } from '@playwright/test';
import { DEFAULT_LOGIN_URL } from '../credentials/loginCredentials';

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly continueButton: Locator;
  readonly googleButton: Locator;
  readonly appleButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.getByLabel(/Email address/i).first();
    this.passwordInput = page.getByLabel(/Password/i).first();
    this.continueButton = page.getByRole('button', { name: 'Continue', exact: true }).first();
    this.googleButton = page.getByRole('button', { name: /Continue with Google/i }).first();
    this.appleButton = page.getByRole('button', { name: /Continue with Apple/i }).first();
  }

  async goto(url = DEFAULT_LOGIN_URL) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(this.usernameInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
  }

  /**
   * Types the credentials in, PROVING each one landed in its own box before submitting.
   *
   * WHY THE CHECK: the hosted Auth0 form hydrates after first paint. If it re-mounts
   * between Playwright resolving an input and focusing it, the insertText goes to
   * whatever is still focused -- the previous field -- and appends at the caret.
   * Run 34067188501 caught exactly that: the password arrived stuck on the end of the
   * email box ("jerico+001auto@offshorly.comZunou123!"), the password box stayed empty,
   * and the form answered "Password is required". Nothing looked slow -- every action
   * finished inside 130ms -- so the only symptom left was assertLoginSuccess waiting out
   * its 15s, which reads as a login timeout and invites a timeout bump that fixes nothing.
   * Neither input carries a maxlength, so demanding the exact value back is safe for the
   * long/special-character negative cases too.
   */
  async login(username: string, password: string) {
    await expect(async () => {
      await this.usernameInput.fill(username);
      await this.passwordInput.fill(password);
      expect(await this.usernameInput.inputValue()).toBe(username);
      expect(await this.passwordInput.inputValue()).toBe(password);
    }).toPass({ timeout: 10000, intervals: [250, 500, 1000] });

    await this.continueButton.click();
  }

  async getErrorMessage() {
    return this.page
      .locator('body')
      .filter({ hasText: /error|invalid|incorrect|failed|locked|wrong|denied|unable to/i })
      .first();
  }

  async assertLoginPageVisible() {
    await expect(this.usernameInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
  }

  async assertLoginSuccess() {
    await expect(this.usernameInput).toBeHidden({ timeout: 15000 });
    await expect(this.passwordInput).toBeHidden({ timeout: 15000 });
  }

  async assertLoginFailure() {
    await expect(await this.getErrorMessage()).toBeVisible();
  }
}
