import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the authenticated post-login landing ("Welcome") surface that
 * Zunou shows immediately after a successful sign-in, before the user enters the
 * full workspace. It is the first authenticated screen the app renders, so it is a
 * stable target for a post-login smoke check.
 *
 * Locators are anchored on accessible roles and visible text rather than the
 * app's hashed MUI CSS classes, so they survive styling/build changes.
 */
export class DashboardPage {
  readonly page: Page;
  readonly welcomeHeading: Locator;
  readonly enterButton: Locator;
  readonly computerSection: Locator;
  readonly phoneSection: Locator;
  readonly codingAgentSection: Locator;

  constructor(page: Page) {
    this.page = page;
    this.welcomeHeading = page.getByRole('heading', { name: /^Welcome!?$/i }).first();
    this.enterButton = page.getByRole('button', { name: /Enter Zunou/i }).first();
    this.computerSection = page.getByText('Zunou on your computer').first();
    this.phoneSection = page.getByText('Zunou on your phone').first();
    this.codingAgentSection = page.getByText(/Connect Zunou to your coding agent/i).first();
  }

  /** Assert the post-login landing has rendered for the signed-in user. */
  async assertLoaded(signedInEmail?: string) {
    await expect(this.welcomeHeading).toBeVisible({ timeout: 20000 });
    await expect(this.enterButton).toBeVisible();
    await expect(this.enterButton).toBeEnabled();
    if (signedInEmail) {
      await expect(this.page.getByText(signedInEmail, { exact: false }).first()).toBeVisible();
    }
  }

  /** Assert the onboarding sections that orient a new user are present. */
  async assertOnboardingSections() {
    await expect(this.computerSection).toBeVisible();
    await expect(this.phoneSection).toBeVisible();
    await expect(this.codingAgentSection).toBeVisible();
  }

  /**
   * Assert the "Connect your coding agent" cards are listed. These are the MCP
   * setup cards Zunou exposes for AI teammates.
   */
  async assertCodingAgentCards(names: string[]) {
    for (const name of names) {
      await expect(
        this.page.getByText(name, { exact: true }).first(),
        `coding-agent card "${name}" should be listed`
      ).toBeVisible();
    }
  }

  /**
   * Click "Enter Zunou" and confirm the app leaves the landing route and enters
   * the workspace. Asserts observable behavior (route change away from /landing)
   * rather than a hardcoded destination path, since the workspace home route is
   * account/state dependent.
   */
  async enterWorkspace() {
    await expect(this.enterButton).toBeEnabled();
    await this.enterButton.click();
    await expect(this.page).not.toHaveURL(/\/landing\//, { timeout: 20000 });
  }
}
