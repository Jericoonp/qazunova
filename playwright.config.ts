import { defineConfig, devices } from '@playwright/test';

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
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
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
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
