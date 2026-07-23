import path from 'path';
import { expect, test } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_PASSWORD, VALID_USERNAME } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { PulsePage } from '../pages/PulsePage';

function buildScreenshotPath(testInfo: any, outcome: 'passed' | 'failed') {
  const safeName = `${testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  return path.resolve(process.cwd(), 'screenshots', outcome, safeName);
}

test.describe('Pulse (team channel) lifecycle', () => {
  // Login + the onboarding tour dismissal alone can take 15-20s on CI runners,
  // leaving too little of the default 30s test timeout for create/message/rename/delete.
  test.describe.configure({ timeout: 90_000 });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === 'passed') {
      return;
    }

    const screenshotPath = buildScreenshotPath(testInfo, 'failed');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('pulse-page-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test('create a team channel pulse, message in it, rename it, then delete it', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const pulsePage = new PulsePage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await loginPage.assertLoginSuccess();

    await pulsePage.dismissOnboardingIfPresent();

    const channelName = `QA Automation ${Date.now()}`;
    await pulsePage.createTeamChannel(channelName);
    await expect(pulsePage.pulseHeaderButton(channelName)).toBeVisible();
    await expect(page.getByText(`This is the start of ${channelName}'s Team Chat`)).toBeVisible();

    const messageText = 'Hello from the automated pulse test.';
    await pulsePage.sendMessage(messageText);
    // Scoped to the rendered message bubble (a <p>), not the composer input -
    // the composer can briefly still hold the same text after Send on some browsers.
    await expect(page.locator('p').getByText(messageText)).toBeVisible();

    const renamedChannelName = `${channelName} (Renamed)`;
    await pulsePage.renamePulse(channelName, renamedChannelName);
    await expect(pulsePage.pulseHeaderButton(renamedChannelName)).toBeVisible();

    await pulsePage.deletePulse(renamedChannelName);
    await pulsePage.assertPulseDeleted(renamedChannelName);
  });

  test('schedule an event inside a pulse, then delete it', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const pulsePage = new PulsePage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await loginPage.assertLoginSuccess();

    await pulsePage.dismissOnboardingIfPresent();

    const channelName = `QA Automation Events ${Date.now()}`;
    await pulsePage.createTeamChannel(channelName);
    await expect(pulsePage.pulseHeaderButton(channelName)).toBeVisible();

    const eventTitle = `QA Automation Event ${Date.now()}`;
    await pulsePage.scheduleEvent(eventTitle);
    await pulsePage.closeEventDetail();
    await expect(pulsePage.eventListRow(eventTitle)).toBeVisible();

    await pulsePage.deleteEvent(eventTitle);
    await pulsePage.assertEventDeleted(eventTitle);

    await pulsePage.deletePulse(channelName);
    await pulsePage.assertPulseDeleted(channelName);
  });
});
