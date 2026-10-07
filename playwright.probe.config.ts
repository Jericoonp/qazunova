import { defineConfig, devices } from '@playwright/test';

/**
 * Config for one-off READ-ONLY probes (currently: build-your-workspace area A).
 *
 * Separate from playwright.config.ts on purpose: that config's testDir is
 * ./tests, so the probe lives outside it and can never be swept into a
 * scheduled suite run. Nothing here changes the real suite's settings.
 */
export default defineConfig({
  testDir: './probe',
  // No retries: a probe reports what it saw once.
  retries: 0,
  workers: 1,
  timeout: 3 * 60 * 1000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    // The org is on Asia/Manila; a UTC runner gets a "Timezone Mismatch" modal over
    // the page (run 37681723774). Matching the org avoids it with no click.
    timezoneId: 'Asia/Manila',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
});
