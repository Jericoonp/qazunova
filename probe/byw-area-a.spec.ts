/**
 * BUILD-YOUR-WORKSPACE AREA A PROBE -- what does staging's workforce/plan page
 * show to the shared test account right now?
 *
 * Runs in CI because driving the logged-in staging dashboard from my own box
 * exceeds my per-turn memory cap (four kills, latest 8 Oct).
 *
 * Signs in, opens the page, makes sure "A small team" is picked, presses Next,
 * reads step 2, then reloads to see whether the draft was saved. Draft-only: it never presses
 * "Start again" (that clears a saved plan someone may own) or Send.
 *
 * Output: one line starting BYW_PROBE_RESULT followed by JSON, plus a
 * full-page screenshot per URL tried, under test-results/.
 *
 * -- MeQAtron
 */
import { test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

const ORG_ID = 'a24d9793-4966-4611-975a-f7746e7fecf3';
const PLAN_PATHS = [
  `/manager/organizations/${ORG_ID}/workforce/plan`,
  `/organizations/${ORG_ID}/workforce/plan`,
];
const OPTIONS = [
  'The whole company',
  'A department or team',
  'A small team',
  'A startup built around AI',
  'Just me',
];

test('area A: read the workforce/plan entry state', async ({ page }, testInfo) => {
  const user = process.env.LOGIN_TEST_USER;
  const password = process.env.LOGIN_TEST_PASSWORD;
  if (!user || !password) throw new Error('LOGIN_TEST_USER / LOGIN_TEST_PASSWORD missing');

  const login = new LoginPage(page);
  await login.goto(process.env.LOGIN_PAGE_URL);
  await login.login(user, password);
  await login.assertLoginSuccess();
  // Run 37680382456 navigated before the Auth0 callback finished and was bounced
  // back to /u/login. Wait until the app itself has loaded and has left the login page.
  const appOrigin = new URL(process.env.LOGIN_PAGE_URL!).origin;
  await page.waitForURL((u) => u.origin === appOrigin && !u.pathname.startsWith('/u/'), { timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
  const origin = appOrigin;
  const landedOn = new URL(page.url()).pathname;

  // Step 1 of area A: pick ONE option and read the screen it leads to.
  // Draft-only: the plan saves as you go, but nothing reaches the real
  // workspace until Send, which this probe never presses.
  const PICK = 'A small team';
  const path = PLAN_PATHS[0];
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => /What are you bringing in\?|Start again/.test(document.body.innerText), null, { timeout: 30000 })
    .catch(() => undefined);

  // Name-independent read: every button's text, every short line mentioning "of 3".
  const readScreen = () =>
    page.evaluate((opts) => {
      const t = document.body.innerText;
      return {
        url: location.pathname,
        stepLines: t.split('\n').map((l) => l.trim()).filter((l) => /\bof 3\b/.test(l) && l.length < 80),
        opts: opts.filter((o) => t.includes(o)),
        hasAgain: t.includes('Start again'),
        h: [...document.querySelectorAll('h1,h2,h3')].map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 6),
        buttons: [...document.querySelectorAll('button,[role="button"]')]
          .map((e) => (e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '))
          .filter(Boolean)
          .slice(-30),
        textHead: t.replace(/\s+/g, ' ').slice(0, 1500),
      };
    }, OPTIONS);

  const before = await readScreen();
  await page.screenshot({ path: testInfo.outputPath('plan-before.png'), fullPage: true });
  if (before.url.startsWith('/u/')) throw new Error('bounced to login: probe did not arm');

  // Step 2 of area A (run 5). Run 37682553998 showed clicking a card only SELECTS it;
  // a Next button moves on. The draft on this shared test org is mine (I picked
  // "A small team" in that run), so a saved board is no longer a stop condition.
  // Still draft-only: never "Start again" (clears a plan), never Send.
  // Persistence: the left preview read "Your workspace" before run 4's pick and
  // "Offshotly_auto / A small team" after it. A fresh load showing the latter means it was saved.
  const persistedOnLoad = /Offshotly_auto\s*A small team/.test(before.textHead);
  // Any modal still over the page (tour, dialog) would eat the click: record it and stop.
  const modal = await page
    .locator('.MuiModal-root:not([aria-hidden="true"])')
    .first()
    .innerText({ timeout: 2000 })
    .catch(() => null);
  let picked = false;
  let next = null;
  let reloaded = null;
  if (!modal && before.opts.includes(PICK)) {
    if (!persistedOnLoad) {
      await page.getByText(PICK, { exact: true }).first().click({ timeout: 15000 });
      picked = true;
      await page.waitForTimeout(3000);
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click({ timeout: 15000 });
    await page.waitForTimeout(4000);
    next = await readScreen();
    await page.screenshot({ path: testInfo.outputPath('plan-step2.png'), fullPage: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
    reloaded = await readScreen();
    await page.screenshot({ path: testInfo.outputPath('plan-reloaded.png'), fullPage: true });
  }
  const results = {
    landedOn, pick: PICK, persistedOnLoad, picked,
    modal: modal && modal.replace(/\s+/g, ' ').slice(0, 200),
    before, next, reloaded,
  };
  console.log('BYW_PROBE_RESULT ' + JSON.stringify(results));
});
