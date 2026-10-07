/**
 * BUILD-YOUR-WORKSPACE AREA D PROBE, step 2 -- waves toggle (lives INSIDE Review, run 37697183605).
 * (Areas A and C PASS.)
 *
 * On MY OWN synthetic draft board (5 people, 1 team; stops otherwise). Draft-only:
 * never presses Send / Send wave / Hand to (safeClick refuses them). Review opens and
 * is closed with Escape. Reads the review counts, reads Waves, switches to In waves and
 * back, and nests a sub-team to settle whether the header "N teams" counts nested units.
 * Cleanup in finally: sub removed, Everyone at once restored.
 *
 * Output: one line BYW_PROBE_RESULT + JSON, plus screenshots d1-*.png.
 *
 * -- MeQAtron
 */
import { test, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

const ORG_ID = 'a24d9793-4966-4611-975a-f7746e7fecf3';
const PLAN_PATH = `/manager/organizations/${ORG_ID}/workforce/plan`;
const CARD = 'Carl'; // board person cards show the FIRST name only (run 37693648277 c3-before.png), so the board guard and the person tap use this
const LEAD = 'Carl Synthetic'; // synthetic; lead-dialog button names carry an avatar letter first ("C\n\nCarl Synthetic"), so never anchor with ^. From the email-only line carl.synthetic@example.com

const readScreen = (page: Page) =>
  page.evaluate(() => {
    const t = document.body.innerText;
    const main = t.slice(Math.max(0, t.lastIndexOf('Build your workspace')));
    return {
      url: location.pathname,
      people: (main.match(/(\d+) people?, \d+ (?:team|department|unit)s?/) || [])[0] ?? null,
      hasAgain: t.includes('Start again'),
      buttons: [...document.querySelectorAll('button,[role="button"]')]
        .map((e) => (e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .slice(-40),
      ariaMenus: [...document.querySelectorAll('[aria-label^="More for"]')].map((e) => e.getAttribute('aria-label')),
      main: main.replace(/\s+/g, ' ').slice(0, 2500),
    };
  });

const dialogRead = async (page: Page) => {
  const d = page.locator('[role="dialog"]:visible, [role="presentation"] .MuiPaper-root:visible').first();
  if (!(await d.count())) return null;
  return {
    text: (await d.innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 500),
    buttons: await d.locator('button').allInnerTexts().catch(() => []),
    inputs: await d.locator('input,textarea').count(),
  };
};



const UNIT = 'Offshotly_auto';
const SUB = 'Synthetic QA Sub';
const NEVER = /send|hand to/i; // never click anything that sends or hands off

test('area D step 2: waves toggle inside review on my synthetic draft', async ({ page }, testInfo) => {
  test.setTimeout(300000);
  const user = process.env.LOGIN_TEST_USER;
  const password = process.env.LOGIN_TEST_PASSWORD;
  if (!user || !password) throw new Error('LOGIN_TEST_USER / LOGIN_TEST_PASSWORD missing');
  const login = new LoginPage(page);
  await login.goto(process.env.LOGIN_PAGE_URL);
  await login.login(user, password);
  await login.assertLoginSuccess();
  const origin = new URL(process.env.LOGIN_PAGE_URL!).origin;
  await page.waitForURL((u) => u.origin === origin && !u.pathname.startsWith('/u/'), { timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);

  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
  };
  const reload = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await settle(); };
  const dlg = () => page.locator('[role="dialog"]:visible, .MuiDrawer-paper:visible').first();
  const dump = async () => {
    if (!(await dlg().count())) return null;
    const d = dlg();
    return {
      text: (await d.innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500),
      buttons: (await d.locator('button,[role="radio"],[role="tab"]').evaluateAll((els) =>
        els.map((e) => `${e.getAttribute('role') || e.tagName}:${((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60)}|pressed=${e.getAttribute('aria-pressed') ?? e.getAttribute('aria-selected') ?? e.getAttribute('aria-checked') ?? ''}`))).slice(0, 40),
    };
  };
  const safeClick = async (loc: ReturnType<Page['locator']>, what: string) => {
    const label = ((await loc.innerText({ timeout: 3000 }).catch(() => '')) || (await loc.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (NEVER.test(label) && !/^Review and send$/.test(label)) throw new Error(`refused to click "${label}" (${what})`);
    await loc.click({ timeout: 15000 });
  };
  const out: Record<string, unknown> = { stoppedAt: null };
  const report = () => console.log('BYW_PROBE_RESULT ' + JSON.stringify({ ...out, consoleErrors }));
  const closeDlg = async () => { if (await dlg().count()) { await page.keyboard.press('Escape'); await settle(); } };
  const openReview = async (tag: string) => {
    const rv = page.getByRole('button', { name: /^Review and send$/ }).first();
    if (!(await rv.count())) return 'no Review and send button';
    await safeClick(rv, 'open review'); await settle();
    const d = await dump();
    const all = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const i = all.indexOf('What will be made');
    out[tag] = { dialog: d, page: i >= 0 ? all.slice(Math.max(0, i - 200), i + 1500) : null };
    await shot(`d1-${tag}.png`);
    await closeDlg();
    return null;
  };

  const inDlg = (name: RegExp) => dlg().getByRole('button', { name }).first();
  const dlgText = async () => ((await dlg().innerText({ timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ');
  const wavesPart = async () => { const t = await dlgText(); const i = t.indexOf('Waves'); return i >= 0 ? t.slice(i, i + 900) : 'no Waves in dialog'; };
  const openRv = async () => {
    const rv = page.getByRole('button', { name: /^Review and send$/ }).first();
    if (!(await rv.count())) return false;
    await safeClick(rv, 'open review'); await settle(); return (await dlg().count()) > 0;
  };

  try {
    await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' });
    await settle();
    const before = await readScreen(page);
    out.before = { people: before.people };
    if (before.people !== '5 people, 1 team' || !(await page.getByText(CARD, { exact: true }).count())) {
      out.stoppedAt = 'not my synthetic board'; return;
    }
    if (!(await openRv())) { out.stoppedAt = 'review did not open'; return; }
    out.wavesAll = await wavesPart();
    const some = inDlg(/^In waves$/);
    if (!(await some.count())) { out.stoppedAt = 'no In waves in review'; return; }
    await safeClick(some, 'in waves'); await settle();
    out.wavesSome = await wavesPart();
    out.wavesSomeButtons = (await dump())?.buttons;
    await shot('d2-waves-some.png');
    // Persisted? close, reload, reopen.
    await closeDlg(); await reload();
    out.boardAfterReload = (await readScreen(page)).main.slice(0, 600);
    if (await openRv()) {
      out.wavesSomeReopened = await wavesPart();
      out.pressedReopened = (await dump())?.buttons?.filter((b) => /Everyone at once|In waves/.test(b));
      await shot('d2-waves-reopened.png');
    }
    } catch (err) {
    out.stoppedAt = 'threw: ' + String(err).slice(0, 300);
  } finally {
    try {
      await closeDlg();
      await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' }); await settle();
      if (await openRv()) {
        const all = inDlg(/^Everyone at once$/);
        if (await all.count()) { await all.click({ timeout: 15000 }); await settle(); }
        await closeDlg();
      }
      await reload();
      const f = await readScreen(page);
      const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      out.final = { people: f.people, wave1OnBoard: /Wave 1/.test(t) };
      if (await openRv()) { out.finalPressed = (await dump())?.buttons?.filter((b) => /Everyone at once|In waves/.test(b)); out.finalWaves = await wavesPart(); await closeDlg(); }
      await shot('d2-final.png');
    } catch (err) { out.cleanupError = String(err).slice(0, 300); }
    report();
  }
});
