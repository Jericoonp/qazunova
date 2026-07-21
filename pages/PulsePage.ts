import { expect, type Locator, type Page } from '@playwright/test';

export class PulsePage {
  readonly page: Page;
  readonly addPulseButton: Locator;
  readonly teamChannelMenuItem: Locator;
  readonly channelNameInput: Locator;
  readonly nextButton: Locator;
  readonly skipAddMembersButton: Locator;
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  readonly enterWorkspaceButton: Locator;
  readonly skipTourButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addPulseButton = page.getByLabel('Add Pulse').locator('button');
    this.teamChannelMenuItem = page.getByRole('menuitem', { name: /^Team Channel/ });
    this.channelNameInput = page.getByRole('textbox', { name: 'ex. Acme Inc' });
    this.nextButton = page.getByRole('button', { name: 'Next' });
    this.skipAddMembersButton = page.getByRole('button', { name: 'Skip for now' });
    this.messageInput = page.getByRole('textbox').filter({ hasText: 'Type your message here...' });
    this.sendButton = page.getByRole('button', { name: 'Send', exact: true });
    this.enterWorkspaceButton = page.getByRole('button', { name: 'Enter Zunou' });
    this.skipTourButton = page.getByRole('button', { name: 'Skip' });
  }

  /** First-run onboarding (landing page + product tour) only appears sometimes. */
  async dismissOnboardingIfPresent() {
    await this.enterWorkspaceButton.click({ timeout: 10000 }).catch(() => undefined);
    await this.skipTourButton.click({ timeout: 20000 }).catch(() => undefined);
  }

  async createTeamChannel(name: string) {
    await this.addPulseButton.click();
    await this.teamChannelMenuItem.click();
    await this.channelNameInput.fill(name);
    await this.nextButton.click();
    await this.skipAddMembersButton.click();
  }

  async sendMessage(text: string) {
    await this.messageInput.click();
    await this.messageInput.fill(text);
    await this.sendButton.click();
  }

  /** The clickable pulse-name header in the main chat pane (as opposed to its sidebar entry). */
  pulseHeaderButton(name: string) {
    return this.page.getByRole('button', { name, exact: true }).last();
  }

  async openPulseSettings(name: string) {
    await this.pulseHeaderButton(name).click();
    await expect(this.page.getByText('Pulse Settings').first()).toBeVisible();
  }

  async renamePulse(currentName: string, newName: string) {
    await this.openPulseSettings(currentName);
    await this.page.getByRole('button', { name: 'Edit' }).click();
    await this.page.locator('#name').fill(newName);
    await this.page.getByRole('button', { name: 'Save' }).click();
    await expect(this.page.locator('#name')).toBeDisabled();
    await this.page.getByRole('button', { name: 'close' }).click();
  }

  /**
   * Delete lives behind an unlabeled icon button in the Setup panel header -
   * its accessible name is the raw i18n key "action.ariaLabel" rather than
   * real text, which is itself a bug worth flagging separately.
   */
  async deletePulse(name: string) {
    await this.openPulseSettings(name);
    await this.page.getByRole('button', { name: 'action.ariaLabel' }).nth(1).click();
    await this.page.getByRole('button', { name: 'Yes' }).click();
  }

  async assertPulseDeleted(name: string) {
    await expect(this.page.getByText('Pulse deleted successfully')).toBeVisible();
    await expect(this.page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
}
