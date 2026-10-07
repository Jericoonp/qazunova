/**
 * BUILD-YOUR-WORKSPACE AREA A PROBE -- what does staging's workforce/plan page
 * show to the shared test account right now?
 *
 * Runs in CI because driving the logged-in staging dashboard from my own box
 * exceeds my per-turn memory cap (four kills, latest 8 Oct).
 *
 * READ-ONLY: signs in, opens the page, reads text. It never clicks anything in
 * the app. In particular it never presses "Start again" (that clears a saved
 * plan someone may own) or Send.
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
  const origin = new URL(page.url()).origin;

  const results = [];
  for (const path of PLAN_PATHS) {
    await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    // Let the SPA settle: wait for the step counter or "Start again", else give up after 20s.
    await page
      .waitForFunction(() => /Step \d of 3|Start again/.test(document.body.innerText), null, { timeout: 20000 })
      .catch(() => undefined);
    const read = await page.evaluate((opts) => {
      const t = document.body.innerText;
      const step = (t.match(/Step \d of 3/) || [null])[0];
      const h = [...document.querySelectorAll('h1,h2,h3')].map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 4);
      return {
        url: location.pathname,
        step,
        opts: opts.filter((o) => t.includes(o)),
        hasAgain: t.includes('Start again'),
        hasStartFromHere: t.includes('Start from what is here'),
        h,
        textHead: t.replace(/\s+/g, ' ').slice(0, 300),
      };
    }, OPTIONS);
    results.push({ tried: path, ...read });
    await page.screenshot({ path: testInfo.outputPath(`plan-${results.length}.png`), fullPage: true });
    if (read.step || read.hasAgain) break;
  }
  console.log('BYW_PROBE_RESULT ' + JSON.stringify(results));
});
