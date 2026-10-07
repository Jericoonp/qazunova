/**
 * BUILD-YOUR-WORKSPACE AREA C PROBE, step 1 -- the unit lifecycle on the board.
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
const UNIT_NAME = 'Synthetic QA Unit';

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

test('area C step 1: add, rename, remove a unit on my synthetic draft', async ({ page }, testInfo) => {
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

  await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Start again|What are you bringing in\?/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => undefined);
  await settle();

  const r: Record<string, unknown> = {};
  let stoppedAt: string | null = null;
  r.before = await readScreen(page);
  await shot('c-before.png');
  const b = r.before as Awaited<ReturnType<typeof readScreen>>;
  if (b.url.startsWith('/u/')) throw new Error('bounced to login: probe did not arm');
  const modal = await page.locator('.MuiModal-root:not([aria-hidden="true"])').first().innerText({ timeout: 2000 }).catch(() => null);

  if (!b.hasAgain) stoppedAt = 'no board on load';
  else if (!b.people || !b.people.startsWith('5 people')) stoppedAt = 'board is not my 5-person draft: ' + b.people;
  else if (modal) stoppedAt = 'modal open on load: ' + modal.replace(/\s+/g, ' ').slice(0, 150);

  // 1. Add a team.
  if (!stoppedAt) {
    const add = page.getByRole('button', { name: /^Add a (team|department)$/ }).first();
    if (!(await add.count())) stoppedAt = 'no "Add a team/department" button';
    else {
      r.addLabel = await add.innerText();
      await add.click({ timeout: 15000 });
      await page.waitForTimeout(2500);
      r.addDialog = await dialogRead(page);
      r.afterAdd = await readScreen(page);
      await shot('c-after-add.png');
    }
  }

  // 2. Rename: if the add opened a dialog with an input, name it there; otherwise
  //    use the new card's menu -> "Rename or change kind".
  if (!stoppedAt) {
    let d = page.locator('[role="dialog"]:visible').first();
    if (!(await d.count())) {
      const menu = page.locator('[aria-label^="More for New "]').last();
      if (!(await menu.count())) stoppedAt = 'no dialog after add and no "More for New …" menu';
      else {
        await menu.click({ timeout: 15000 });
        await page.waitForTimeout(1000);
        const item = page.getByRole('menuitem', { name: 'Rename or change kind' }).first();
        if (!(await item.count())) stoppedAt = 'menu has no "Rename or change kind"';
        else {
          await item.click({ timeout: 15000 });
          await page.waitForTimeout(1500);
          d = page.locator('[role="dialog"]:visible').first();
        }
      }
    }
    if (!stoppedAt) {
      r.renameDialog = await dialogRead(page);
      await shot('c-rename-dialog.png');
      const input = d.locator('input[type="text"], input:not([type]), textarea').first();
      if (!(await input.count())) stoppedAt = 'rename dialog has no text input';
      else {
        await input.fill(UNIT_NAME);
        const save = d.getByRole('button', { name: /^(Save|Add|Done|Create|OK)$/ }).last();
        if (!(await save.count())) stoppedAt = 'rename dialog has no Save/Add/Done button';
        else {
          await save.click({ timeout: 15000 });
          await settle();
          r.afterRename = await readScreen(page);
          await shot('c-after-rename.png');
        }
      }
    }
  }

  // 3. Reload: does the renamed unit persist?
  if (!stoppedAt) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle();
    const s = await readScreen(page);
    r.reloadAfterRename = { people: s.people, hasUnit: s.main.includes(UNIT_NAME), ariaMenus: s.ariaMenus };
    await shot('c-reload-after-rename.png');
    if (!s.main.includes(UNIT_NAME)) stoppedAt = 'renamed unit not on the board after reload';
  }

  // 4. Remove it: read the confirm text, confirm, reload.
  if (!stoppedAt) {
    const menu = page.locator(`[aria-label="More for ${UNIT_NAME}"]`).first();
    if (!(await menu.count())) stoppedAt = `no "More for ${UNIT_NAME}" menu`;
    else {
      await menu.click({ timeout: 15000 });
      await page.waitForTimeout(1000);
      r.menuItems = await page.getByRole('menuitem').allInnerTexts().catch(() => []);
      const rm = page.getByRole('menuitem', { name: /^Remove/ }).first();
      if (!(await rm.count())) stoppedAt = 'unit menu has no Remove';
      else {
        await rm.click({ timeout: 15000 });
        await page.waitForTimeout(1500);
        r.removeDialog = await dialogRead(page);
        await shot('c-remove-dialog.png');
        const ok = page.locator('[role="dialog"]:visible').getByRole('button', { name: /^Remove/ }).last();
        if (!(await ok.count())) stoppedAt = 'remove dialog has no Remove button';
        else {
          await ok.click({ timeout: 15000 });
          await settle();
          r.afterRemove = await readScreen(page);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await settle();
          const s = await readScreen(page);
          r.reloadAfterRemove = { people: s.people, hasUnit: s.main.includes(UNIT_NAME), main: s.main.slice(0, 1200) };
          await shot('c-reload-after-remove.png');
        }
      }
    }
  }

  console.log('BYW_PROBE_RESULT ' + JSON.stringify({ stoppedAt, ...r, consoleErrors: consoleErrors.slice(0, 15) }));
});
