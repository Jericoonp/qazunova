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
    this.continueButton = page.getByRole('button', { name: 'Continue' }).first();
    this.googleButton = page.getByRole('button', { name: /Continue with Google/i }).first();
    this.appleButton = page.getByRole('button', { name: /Continue with Apple/i }).first();
  }

  async goto(url = DEFAULT_LOGIN_URL) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(this.usernameInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.continueButton.click();
  }

  async getErrorMessage() {
    return this.page.locator('body').filter({ hasText: /error|invalid|incorrect|failed|locked/i }).first();
  }

  async assertLoginSuccess() {
    await expect(this.page).toHaveURL(/dashboard\.zunou\.ai\/(landing|dashboard|home|account|profile)|callback/i);
  }

  async assertLoginFailure() {
    await expect(await this.getErrorMessage()).toBeVisible();
  }
}
