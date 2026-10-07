/**
 * BUILD-YOUR-WORKSPACE AREA C PROBE, step 2 -- nesting, move, change kind.
 * (Step 1, run 37689442043: add / rename / remove a top-level unit, PASS.)
 *
 * Step 2: on the existing team, "Add a team inside" -> reload -> Move the inner
 * team to the top -> reload -> change its kind to Client -> reload -> remove it
 * -> reload (back to 5 people, 1 team). Nesting is read from the DOM: how many
 * ancestors up from the parent's menu button until it contains the inner one.
 *
 * Step 1 header follows.
 *
 * Works only on MY OWN synthetic draft board (built by area A run 37687949892:
 * 5 people, 1 team, example.com names). It stops unless the board holds exactly
 * that 5-person draft. Draft-only: it never presses Send / Review and send.
 *
 * Steps: read the board -> "Add a team" -> rename it to a labelled synthetic name
 * -> reload (does the new unit persist?) -> open its "Remove" and read the dialog
 * -> confirm -> reload (is it gone, are the 5 people still there?).
 *
 * Every step records what it saw and stops at the first missing control, so a
 * drifted locator reads as "stoppedAt", never as a product finding.
 *
 * Output: one line starting BYW_PROBE_RESULT followed by JSON, plus screenshots.
 *
 * -- MeQAtron
 */
import { test, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

const ORG_ID = 'a24d9793-4966-4611-975a-f7746e7fecf3';
const PLAN_PATH = `/manager/organizations/${ORG_ID}/workforce/plan`;
const UNIT_NAME = 'Synthetic QA Sub';

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
    text: (await d.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500),
    buttons: await d.locator('button').allInnerTexts().catch(() => []),
    inputs: await d.locator('input,textarea').count(),
  };
};


const nestDepth = (page: Page, parent: string, child: string) =>
  page.evaluate(([p, c]) => {
    const pb = document.querySelector(`[aria-label="More for ${p}"]`);
    const cb = document.querySelector(`[aria-label="More for ${c}"]`);
    if (!pb || !cb) return { found: false, depth: null as number | null };
    let el: Element | null = pb;
    for (let k = 1; k <= 10 && el; k++) {
      el = el.parentElement;
      if (el && el.contains(cb)) return { found: true, depth: k };
    }
    return { found: true, depth: null };
  }, [parent, child]);

const openMenuItem = async (page: Page, unit: string, item: RegExp) => {
  const menu = page.locator(`[aria-label="More for ${unit}"]`).first();
  if (!(await menu.count())) return `no "More for ${unit}" menu`;
  await menu.click({ timeout: 15000 });
  await page.waitForTimeout(1000);
  const mi = page.getByRole('menuitem', { name: item }).first();
  if (!(await mi.count())) { await page.keyboard.press('Escape'); return `menu for ${unit} has no ${item}`; }
  await mi.click({ timeout: 15000 });
  await page.waitForTimeout(1500);
  return null;
};

test('area C step 2: team inside, move, change kind, remove on my synthetic draft', async ({ page }, testInfo) => {
  test.setTimeout(240000);
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
  const dlg = () => page.locator('[role="dialog"]:visible').first();

  await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Start again|What are you bringing in\?/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => undefined);
  await settle();

  const r: Record<string, unknown> = {};
  let stoppedAt: string | null = null;
  const b = await readScreen(page);
  r.before = { people: b.people, ariaMenus: b.ariaMenus };
  await shot('c2-before.png');
  if (b.url.startsWith('/u/')) throw new Error('bounced to login: probe did not arm');
  const parent = (b.ariaMenus[0] || '').replace(/^More for /, '');
  r.parent = parent;
  if (!b.hasAgain) stoppedAt = 'no board on load';
  else if (!b.people || !b.people.startsWith('5 people, 1 team')) stoppedAt = 'board is not my 5-person 1-team draft: ' + b.people;
  else if (b.ariaMenus.length !== 1 || !parent) stoppedAt = 'expected exactly one unit menu, saw ' + JSON.stringify(b.ariaMenus);
  else if (b.ariaMenus.includes(`More for ${UNIT_NAME}`)) stoppedAt = 'leftover probe unit on load';

  // 1. Add a team inside the existing team.
  if (!stoppedAt) stoppedAt = await openMenuItem(page, parent, /^Add a team inside$/);
  if (!stoppedAt) {
    r.insideDialog = await dialogRead(page);
    await shot('c2-inside-dialog.png');
    const input = dlg().locator('input[type="text"], input:not([type]), textarea').first();
    if (!(await input.count())) stoppedAt = 'inside dialog has no text input';
    else {
      await input.fill(UNIT_NAME);
      const save = dlg().getByRole('button', { name: /^(Save|Add|Done|Create|OK)$/ }).last();
      if (!(await save.count())) stoppedAt = 'inside dialog has no Save/Add button';
      else {
        await save.click({ timeout: 15000 });
        await settle();
        await reload();
        const s = await readScreen(page);
        r.reloadAfterInside = { people: s.people, ariaMenus: s.ariaMenus, nest: await nestDepth(page, parent, UNIT_NAME) };
        await shot('c2-reload-after-inside.png');
        if (!s.ariaMenus.includes(`More for ${UNIT_NAME}`)) stoppedAt = 'inner team not on the board after reload';
      }
    }
  }

  // 2. Move the inner team to the top.
  if (!stoppedAt) stoppedAt = await openMenuItem(page, UNIT_NAME, /^Move$/);
  if (!stoppedAt) {
    r.moveDialog = await dialogRead(page);
    await shot('c2-move-dialog.png');
    const combo = dlg().getByRole('combobox').first();
    if (!(await combo.count())) stoppedAt = 'move dialog has no combobox';
    else {
      await combo.click({ timeout: 15000 });
      await page.waitForTimeout(800);
      r.moveOptions = await page.getByRole('option').allInnerTexts().catch(() => []);
      const top = page.getByRole('option', { name: /^Nothing: at the top$/ }).first();
      if (!(await top.count())) { stoppedAt = 'move list has no "Nothing: at the top"'; await page.keyboard.press('Escape'); }
      else {
        await top.click({ timeout: 15000 });
        await page.waitForTimeout(800);
        const save = dlg().getByRole('button', { name: /^(Move|Save|Done|OK)$/ }).last();
        if (!(await save.count())) stoppedAt = 'move dialog has no Move/Save button';
        else {
          await save.click({ timeout: 15000 });
          await settle();
          await reload();
          const s = await readScreen(page);
          r.reloadAfterMove = { people: s.people, ariaMenus: s.ariaMenus, nest: await nestDepth(page, parent, UNIT_NAME) };
          await shot('c2-reload-after-move.png');
        }
      }
    }
  }

  // 3. Change its kind to Client.
  if (!stoppedAt) stoppedAt = await openMenuItem(page, UNIT_NAME, /^Rename or change kind$/);
  if (!stoppedAt) {
    r.editDialog = await dialogRead(page);
    await shot('c2-edit-dialog.png');
    const combo = dlg().getByRole('combobox').first();
    if (!(await combo.count())) stoppedAt = 'edit dialog has no kind combobox';
    else {
      await combo.click({ timeout: 15000 });
      await page.waitForTimeout(800);
      r.kindOptions = await page.getByRole('option').allInnerTexts().catch(() => []);
      const client = page.getByRole('option', { name: /^Client$/ }).first();
      if (!(await client.count())) { stoppedAt = 'kind list has no Client'; await page.keyboard.press('Escape'); }
      else {
        await client.click({ timeout: 15000 });
        await page.waitForTimeout(800);
        r.editDialogAfterPick = await dialogRead(page);
        const save = dlg().getByRole('button', { name: /^(Save|Done|OK|Change)$/ }).last();
        if (!(await save.count())) stoppedAt = 'edit dialog has no Save button';
        else {
          await save.click({ timeout: 15000 });
          await settle();
          await reload();
          const s = await readScreen(page);
          const i = s.main.indexOf(UNIT_NAME);
          r.reloadAfterKind = { people: s.people, ariaMenus: s.ariaMenus, around: i < 0 ? null : s.main.slice(Math.max(0, i - 80), i + 160) };
          await shot('c2-reload-after-kind.png');
        }
      }
    }
  }

  // 4. Clean up: remove the probe unit whatever stopped above, then reload.
  if (await dlg().count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(800); }
  const s0 = await readScreen(page);
  if (s0.ariaMenus.includes(`More for ${UNIT_NAME}`)) {
    const err = await openMenuItem(page, UNIT_NAME, /^Remove/);
    if (err) r.cleanup = err;
    else {
      r.removeDialog = await dialogRead(page);
      const ok = dlg().getByRole('button', { name: /^Remove/ }).last();
      if (!(await ok.count())) r.cleanup = 'remove dialog has no Remove button';
      else {
        await ok.click({ timeout: 15000 });
        await settle();
        await reload();
        const s = await readScreen(page);
        r.reloadAfterRemove = { people: s.people, ariaMenus: s.ariaMenus };
        await shot('c2-reload-after-remove.png');
      }
    }
  }

  console.log('BYW_PROBE_RESULT ' + JSON.stringify({ stoppedAt, ...r, consoleErrors: consoleErrors.slice(0, 15) }));
});
