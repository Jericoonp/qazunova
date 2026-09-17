import { defineConfig, devices } from '@playwright/test';

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

/**
 * How many tests may safely run at once: one per isolated staging account.
 *
 * Deliberately a lazy require rather than a top-level import --
 * credentials/loginCredentials.ts reads process.env as it is evaluated, and a
 * top-level import would be hoisted ABOVE the dotenv.config() call on the
 * line before this, so a local .env would be ignored and every run would see
 * an empty pool.
 */
function resolveWorkers(): number {
  const { ACCOUNT_POOL_SIZE } = require('./credentials/loginCredentials') as {
    ACCOUNT_POOL_SIZE: number;
  };

  const requested = Number(process.env.PW_WORKERS);

  if (Number.isInteger(requested) && requested > 0) {
    // Clamp, never trust. PW_WORKERS above the pool size would hand one
    // account to two workers and surface as data loss in an unrelated test.
    return Math.min(requested, ACCOUNT_POOL_SIZE);
  }

  return ACCOUNT_POOL_SIZE;
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* One throwaway login before the workers fan out, so the first thing each
   * worker's preflight does is not also this environment's cold boot. See
   * utils/globalSetup.ts for the run that pinned cold start -- not
   * concurrency -- as the cause. Deliberately non-fatal. */
  globalSetup: require.resolve('./utils/globalSetup'),
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only.
   * Dropped from 2 to 1: on run 30323518312 the webkit shard spent ~12 of its
   * 60 minutes on a single failing tasks test. Each retry re-ran that file's
   * beforeAll, which burned its full 300s hook timeout before failing --
   * producing two 0ms "retries" that never had a chance to pass and taking 6
   * unrelated tests down with them. On a suite where every test costs 20-40s,
   * a second retry buys very little and costs a lot when a file is broken. */
  retries: process.env.CI ? 1 : 0,
  /* One worker per isolated staging account -- never more.
   *
   * This used to be a flat `workers: 1` on CI, which made a run cost the SUM
   * of its 68 tests: 42.6 min on run 30604925581, roughly 20 min of which was
   * the same login + navigation repeated across 53 tests. The setting was
   * never the real constraint. notes.spec.ts and tasks.spec.ts bulk-clear
   * their account in beforeAll and several tests assert on whole-list state,
   * so two workers sharing one staging account delete each other's fixtures
   * mid-run.
   *
   * Each worker now owns its own account (credentials/loginCredentials.ts +
   * utils/testFixtures.ts), so the safe worker count is exactly the number of
   * accounts configured. Deriving it here instead of hard-coding a number
   * makes that an invariant of the config: adding a LOGIN_TEST_USER_2/_3 pair
   * is all it takes to widen a run, and an environment holding only the one
   * account quietly falls back to the old serial behaviour rather than
   * corrupting itself.
   *
   * PW_WORKERS can lower it for a one-off (e.g. to test an ordering
   * suspicion); resolveWorkers() clamps it so it can never exceed the pool. */
  workers: resolveWorkers(),
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['list'], ['html']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: process.env.LOGIN_PAGE_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  /* Chromium is the DEFAULT; firefox and webkit are OPT-IN.
   *
   * Automatic cross-browser fan-out is off by request (Earl Dominic,
   * 2026-07-31): every run fanned out into three parallel browser shards,
   * and the extra two paid
   * for themselves in noise rather than defects. Evidence from run
   * 30323518312, where all three shards ran the same suite: firefox and webkit
   * surfaced no product bug chromium missed, and webkit's only two failures
   * were teardown/timeout artifacts. Meanwhile webkit took 61min against
   * chromium's 37min, so every run waited on the slowest, least informative
   * shard.
   *
   * These project blocks are DEFINED but never selected by default -- every
   * caller passes --project explicitly, and scheduled/push/PR runs pass
   * --project=chromium. Defining them costs nothing and means a one-off
   * cross-browser check needs no code change: run the workflow manually with
   * the `browsers` input (see .github/workflows/playwright.yml), or locally
   * with `npx playwright test --project=webkit`.
   *
   * NOTE: firefox and webkit each need their OWN staging account, or they
   * corrupt each other's data (notes.spec.ts bulk-clears its account in
   * beforeAll). The workflow wires LOGIN_TEST_USER_FIREFOX / _WEBKIT for
   * exactly that reason -- never run two browsers against one account.
   *
   * The one area with real cross-engine risk is the Quill (contenteditable)
   * Notes and Tasks editors, so if that code changes materially, a one-off
   * webkit run is worth doing by hand. */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      // Safari's engine -- "Safari" and "webkit" are the same target here.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
