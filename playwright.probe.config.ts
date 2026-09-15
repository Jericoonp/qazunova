import { defineConfig, devices } from '@playwright/test';

/**
 * Config for the TM2-T014 account-access probe ONLY.
 *
 * Separate from playwright.config.ts on purpose: that config's testDir is
 * ./tests, so the probe lives outside it and can never be swept into a
 * scheduled suite run. Nothing here changes the real suite's settings.
 */
export default defineConfig({
  testDir: './probe',
  // No retries: a retry would mask an intermittent access failure, which is the
  // very thing being measured.
  retries: 0,
  // One at a time. Three simultaneous logins widen the pre-resolution
  // "Access Denied" window that this probe is trying to rule out.
  workers: 1,
  // Generous per-test budget: each arm may pay two PREFLIGHT_TIMEOUT_MS waits
  // (45s race + 45s provisional-denial confirmation) plus the login itself.
  timeout: 3 * 60 * 1000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    // chromium regardless of which account we are testing: PR #21's pool hands
    // the firefox/webkit ACCOUNTS to chromium workers, so the browser is not
    // the variable here -- the account is.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
});
