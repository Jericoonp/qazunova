import { expect, type Locator, type Page } from '@playwright/test';

// The product tour (react-joyride) mounts noticeably later than the rest of the
// page, so it gets a longer budget than the other dismissal steps -- same value
// PulsePage.ts / NotesPage.ts / TasksPage.ts settled on.
const TOUR_TIMEOUT_MS = 20000;
const DISMISS_TIMEOUT_MS = 10000;

/**
 * Page object for the workspace Home that Zunou renders once a user is signed in.
 *
 * NOTE ON WHAT THIS ASSERTS, AND WHY IT CHANGED:
 * This suite previously asserted the "Welcome / Enter Zunou" landing (with its
 * onboarding sections and coding-agent cards) as the guaranteed post-login
 * surface. That screen is *first-run only* -- every other page object in this
 * repo already treats it as optional (see PulsePage.dismissOnboardingIfPresent).
 * Once the shared staging account consumed its onboarding, login started going
 * straight to the workspace, and all four dashboard tests failed deterministically
 * on every browser. That was the suite asserting a one-time state as if it were
 * permanent -- not a product regression.
 *
 * So this page object now targets the surface that IS durable for a signed-in
 * user: the workspace Home at /pulse/<id>/dashboard. The welcome landing is
 * handled the way the rest of the repo handles it -- dismissed if present.
 *
 * Locators are anchored on accessible roles and visible text rather than the
 * app's hashed MUI CSS classes, so they survive styling/build changes.
 */
export class DashboardPage {
  readonly page: Page;
  /** Time-of-day greeting rendered at the top of Home ("Good morning, <email>"). */
  readonly greeting: Locator;
  readonly homeNavButton: Locator;
  readonly calendarNavButton: Locator;
  readonly askAiButton: Locator;
  readonly startMeetingButton: Locator;
  readonly feedButton: Locator;
  readonly assistantSpeakButton: Locator;
  readonly assistantTypeButton: Locator;
  /** First-run-only onboarding controls -- present on a fresh account, absent after. */
  readonly enterButton: Locator;
  readonly skipTourButton: Locator;
  readonly cancelTimezoneMismatchButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.greeting = page.getByText(/Good (morning|afternoon|evening)/i).first();
    this.homeNavButton = page.getByRole('button', { name: 'Home', exact: true });
    this.calendarNavButton = page.getByRole('button', { name: 'Calendar', exact: true });
    this.askAiButton = page.getByRole('button', { name: 'Ask AI', exact: true });
    this.startMeetingButton = page.getByRole('button', { name: 'Start Meeting', exact: true });
    this.feedButton = page.getByRole('button', { name: 'Feed', exact: true });
    this.assistantSpeakButton = page.getByRole('button', { name: 'Speak', exact: true });
    this.assistantTypeButton = page.getByRole('button', { name: 'Type', exact: true });
    this.enterButton = page.getByRole('button', { name: /Enter Zunou/i }).first();
    this.skipTourButton = page.getByRole('button', { name: 'Skip' });
    this.cancelTimezoneMismatchButton = page.getByRole('button', { name: 'Cancel' });
  }

  /**
   * Clear anything first-run sitting between login and Home. Every step is
   * best-effort: on an account that has already been onboarded none of them
   * appear, which is the normal case now.
   *
   * Order matters. The tour must be skipped before the timezone dialog: the
   * tour's full-page overlay sits on top of the dialog's buttons even though
   * the dialog renders visually in front of it (a real app z-index bug, see
   * PulsePage.ts). CI runners run in UTC, which differs from the account's
   * organization timezone (Asia/Manila), so the timezone dialog fires on
   * essentially every CI login.
   */
  async dismissOnboardingIfPresent() {
    await this.enterButton.click({ timeout: DISMISS_TIMEOUT_MS }).catch(() => undefined);
    await this.skipTourButton.click({ timeout: TOUR_TIMEOUT_MS }).catch(() => undefined);
    await this.cancelTimezoneMismatchButton
      .click({ timeout: DISMISS_TIMEOUT_MS })
      .catch(() => undefined);
  }

  /**
   * Assert the signed-in user landed in their workspace.
   *
   * The URL check is the load-bearing one: reaching /pulse/<id>/dashboard is
   * what "the authenticated app is up" actually means. The pulse id is
   * account-dependent, so it is matched as a pattern rather than hardcoded.
   */
  async assertLoaded(signedInEmail?: string) {
    await expect(this.page).toHaveURL(/\/pulse\/[0-9a-f-]+\/dashboard/i, { timeout: 30000 });
    await expect(this.greeting).toBeVisible({ timeout: 20000 });
    if (signedInEmail) {
      await expect(this.page.getByText(signedInEmail, { exact: false }).first()).toBeVisible();
    }
  }

  /** Assert the persistent workspace navigation rendered around Home. */
  async assertWorkspaceChrome() {
    await expect(this.homeNavButton).toBeVisible();
    await expect(this.calendarNavButton).toBeVisible();
    await expect(this.askAiButton).toBeVisible();
    await expect(this.startMeetingButton).toBeVisible();
    await expect(this.feedButton).toBeVisible();
  }

  /** Assert the Zunou Assistant composer on Home offers both input modes. */
  async assertAssistantComposer() {
    await expect(this.assistantSpeakButton).toBeVisible();
    await expect(this.assistantTypeButton).toBeVisible();
  }
}
