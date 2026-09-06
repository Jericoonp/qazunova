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

  /**
   * Pulses this test created that are not deleted yet. Both tests delete their own
   * pulse as their final assertion, but a failure anywhere earlier used to skip that
   * line and strand the pulse on the shared staging account forever -- 25 of them had
   * piled up by 6 Sep 2026, from 19 Jul onwards. Registering the name at creation time
   * and sweeping here means a mid-test failure costs us a failure, not an orphan.
   */
  let undeletedPulseNames: string[] = [];

  test.beforeEach(() => {
    undeletedPulseNames = [];
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Screenshot BEFORE the sweep: cleanup navigates, which would destroy the
    // very page state the failure screenshot exists to capture.
    if (testInfo.status !== 'passed') {
      const screenshotPath = buildScreenshotPath(testInfo, 'failed');

      await page.screenshot({ path: screenshotPath, fullPage: true });
      await testInfo.attach('pulse-page-screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    }

    if (undeletedPulseNames.length === 0) {
      return;
    }

    // Best-effort: never let cleanup turn a pass into a failure, or mask the real
    // reason a test failed. A pulse we cannot remove is logged, not thrown.
    const pulsePage = new PulsePage(page);

    for (const name of [...undeletedPulseNames]) {
      try {
        // The test may have died with a modal or panel open on top of everything;
        // reloading gets us back to a state where Pulse Settings is reachable.
        await page.reload();
        await pulsePage.deletePulse(name);
        await expect(page.getByText('Pulse deleted successfully')).toBeVisible();
      } catch (error) {
        console.warn(`[cleanup] could not delete leftover pulse "${name}":`, error);
      }
    }
  });

  test('create a team channel pulse, message in it, rename it, then delete it', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const pulsePage = new PulsePage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await loginPage.assertLoginSuccess();

    await pulsePage.dismissOnboardingIfPresent();

    const channelName = `QA Automation ${Date.now()}`;
    undeletedPulseNames.push(channelName);
    await pulsePage.createTeamChannel(channelName);
    await expect(pulsePage.pulseHeaderButton(channelName)).toBeVisible();
    await expect(page.getByText(`This is the start of ${channelName}'s Team Chat`)).toBeVisible();

    const messageText = 'Hello from the automated pulse test.';
    await pulsePage.sendMessage(messageText);
    // Scoped to the rendered message bubble (a <p>), not the composer input -
    // the composer can briefly still hold the same text after Send on some browsers.
    await expect(page.locator('p').getByText(messageText)).toBeVisible();

    // Track the new name before renaming: if the rename half-lands, the pulse
    // survives under a name the sweep would otherwise not know to look for.
    // (Six "... (Renamed)" orphans on staging are exactly this case.)
    const renamedChannelName = `${channelName} (Renamed)`;
    undeletedPulseNames.push(renamedChannelName);
    await pulsePage.renamePulse(channelName, renamedChannelName);
    await expect(pulsePage.pulseHeaderButton(renamedChannelName)).toBeVisible();

    await pulsePage.deletePulse(renamedChannelName);
    await pulsePage.assertPulseDeleted(renamedChannelName);
    undeletedPulseNames = [];
  });

  test('schedule an event inside a pulse, then delete it', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const pulsePage = new PulsePage(page);

    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await loginPage.assertLoginSuccess();

    await pulsePage.dismissOnboardingIfPresent();

    const channelName = `QA Automation Events ${Date.now()}`;
    undeletedPulseNames.push(channelName);
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
    undeletedPulseNames = [];
  });
});
