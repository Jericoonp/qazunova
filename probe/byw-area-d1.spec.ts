/**
 * BUILD-YOUR-WORKSPACE AREA D PROBE, step 1 -- waves and review.
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

test('area D step 1: waves and review on my synthetic draft', async ({ page }, testInfo) => {
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

  try {
    await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' });
    await settle();
    const before = await readScreen(page);
    out.before = { people: before.people, buttons: before.buttons };
    await shot('d1-before.png');
    if (before.people !== '5 people, 1 team' || !(await page.getByText(CARD, { exact: true }).count())) {
      out.stoppedAt = 'not my synthetic board'; return;
    }

    // 1. Review as-is (read only; Escape closes it; never Send).
    let e = await openReview('review0');
    if (e) out.review0 = e;

    // 2. Waves: find the section, read it.
    const wavesCtl = page.getByRole('tab', { name: /^Waves$/ }).or(page.getByRole('button', { name: /^Waves$/ })).first();
    if (await wavesCtl.count()) { await safeClick(wavesCtl, 'waves tab'); await settle(); }
    const w = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const wi = w.indexOf('Everyone at once');
    out.waves0 = { ctl: await wavesCtl.count(), text: wi >= 0 ? w.slice(Math.max(0, wi - 300), wi + 900) : 'no "Everyone at once" on page' };
    await shot('d1-waves0.png');

    // 3. Switch to In waves, read defaults, then switch back and prove it stuck.
    const some = page.getByRole('button', { name: /^In waves$/ }).or(page.getByRole('radio', { name: /^In waves$/ })).or(page.getByText('In waves', { exact: true })).first();
    if (await some.count()) {
      await safeClick(some, 'in waves'); await settle();
      const s = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      const si = s.indexOf('In waves');
      out.wavesSome = s.slice(Math.max(0, si - 100), si + 1200);
      await shot('d1-waves-some.png');
      await reload();
      const r = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      out.wavesSomeReloadHasWave1 = /Wave 1/.test(r);
      e = await openReview('reviewWaves');
      if (e) out.reviewWaves = e;
    } else out.wavesSome = 'no In waves control';

    // 4. Teams-count question: nest a sub, compare header vs review "units, teams".
    const menu = page.locator(`[aria-label="More for ${UNIT}"]`).first();
    if (await menu.count()) {
      await menu.click({ timeout: 15000 }); await page.waitForTimeout(1000);
      const mi = page.getByRole('menuitem', { name: /^Add a team inside$/ }).first();
      if (await mi.count()) {
        await mi.click({ timeout: 15000 }); await settle();
        await dlg().locator('input[type="text"],input:not([type])').first().fill(SUB, { timeout: 15000 });
        await dlg().getByRole('button', { name: /^Add$/ }).last().click({ timeout: 15000 }); await settle();
        out.withSubHeader = (await readScreen(page)).people;
        e = await openReview('reviewWithSub');
        if (e) out.reviewWithSub = e;
      } else { await page.keyboard.press('Escape'); out.withSubHeader = 'no Add a team inside'; }
    }
  } catch (err) {
    out.stoppedAt = 'threw: ' + String(err).slice(0, 300);
  } finally {
    try {
      await closeDlg();
      await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' }); await settle();
      // Undo the sub.
      const sm = page.locator(`[aria-label="More for ${SUB}"]`).first();
      if (await sm.count()) {
        await sm.click({ timeout: 15000 }); await page.waitForTimeout(1000);
        await page.getByRole('menuitem', { name: /^Remove$/ }).first().click({ timeout: 15000 }); await settle();
        const yes = dlg().getByRole('button', { name: /^Remove/ }).last();
        if (await yes.count()) { await yes.click({ timeout: 15000 }); await settle(); }
      }
      // Undo waves mode.
      const wavesCtl = page.getByRole('tab', { name: /^Waves$/ }).or(page.getByRole('button', { name: /^Waves$/ })).first();
      if (await wavesCtl.count()) { await wavesCtl.click({ timeout: 15000 }); await settle(); }
      const all = page.getByRole('button', { name: /^Everyone at once$/ }).or(page.getByRole('radio', { name: /^Everyone at once$/ })).or(page.getByText('Everyone at once', { exact: true })).first();
      if (await all.count()) { await all.click({ timeout: 15000 }); await settle(); }
      await reload();
      const f = await readScreen(page);
      const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      out.final = { people: f.people, subHits: await page.getByText(SUB).count(), wave1: /Wave 1/.test(t) };
      await shot('d1-final.png');
    } catch (err) { out.cleanupError = String(err).slice(0, 300); }
    report();
  }
});
