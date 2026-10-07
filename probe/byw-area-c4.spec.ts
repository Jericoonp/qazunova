/**
 * BUILD-YOUR-WORKSPACE AREA C PROBE, step 4 -- rooms.
 * (Steps 1-3 PASS: units, nesting, move, kind, remove, lead, roles.)
 *
 * On MY OWN synthetic draft board (5 people, 1 team; stops otherwise). Draft-only:
 * never presses Send / Review and send / Hand to.
 * Reads the Rooms tab, adds "Synthetic QA Room" to the team, reloads, opens it and
 * reads its controls (private/open, marks) WITHOUT changing them, then removes it.
 *
 * Output: one line BYW_PROBE_RESULT + JSON, plus screenshots c4-*.png.
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



const ROOM = 'Synthetic QA Room';
const UNIT = 'Offshotly_auto';

test('area C step 4: rooms on my synthetic draft', async ({ page }, testInfo) => {
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
      text: (await d.innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 900),
      buttons: (await d.locator('button,[role="radio"],[role="checkbox"],[role="switch"],[role="option"]').evaluateAll((els) =>
        els.map((e) => `${e.getAttribute('role') || e.tagName}:${((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60)}|pressed=${e.getAttribute('aria-pressed') ?? e.getAttribute('aria-checked') ?? ''}`))).slice(0, 40),
      inputs: await d.locator('input,textarea').evaluateAll((els) =>
        els.map((e) => `${(e as HTMLInputElement).type}:${e.getAttribute('placeholder') || e.getAttribute('aria-label') || e.getAttribute('name') || ''}=${(e as HTMLInputElement).value}`)),
    };
  };
  const out: Record<string, unknown> = { stoppedAt: null };
  const report = () => console.log('BYW_PROBE_RESULT ' + JSON.stringify({ ...out, consoleErrors }));
  const roomCount = () => page.getByText(ROOM, { exact: false }).count();

  try {
    await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' });
    await settle();
    const before = await readScreen(page);
    out.before = { people: before.people, ariaMenus: before.ariaMenus, hasRoomAlready: await roomCount() };
    await shot('c4-before.png');
    if (before.people !== '5 people, 1 team' || !(await page.getByText(CARD, { exact: true }).count())) {
      out.stoppedAt = 'not my synthetic board'; return;
    }

    // Rooms tab: read only.
    const roomsTab = page.getByRole('tab', { name: /^Rooms$/ }).or(page.getByRole('button', { name: /^Rooms$/ })).first();
    if (await roomsTab.count()) {
      await roomsTab.click({ timeout: 15000 }); await settle();
      out.roomsTab = (await readScreen(page)).main.slice(0, 1500);
      await shot('c4-rooms-tab.png');
      const teamsTab = page.getByRole('tab', { name: /^Teams$/ }).or(page.getByRole('button', { name: /^Teams$/ })).first();
      if (await teamsTab.count()) { await teamsTab.click({ timeout: 15000 }); await settle(); }
    } else out.roomsTab = 'no Rooms tab';

    // Add a room on the unit.
    const err = await openMenuItem(page, UNIT, /^Add a room$/);
    if (err) { out.stoppedAt = err; return; }
    out.addDialog = await dump();
    await shot('c4-add-dialog.png');
    const nameInput = dlg().locator('input[type="text"],input:not([type]),textarea').first();
    if (!(await nameInput.count())) { out.stoppedAt = 'no name input'; await page.keyboard.press('Escape'); return; }
    await nameInput.fill(ROOM, { timeout: 15000 });
    out.addDialogFilled = await dump();
    const add = dlg().getByRole('button', { name: /^(Add|Add room|Add a room|Create|Save|Done)$/ }).last();
    if (!(await add.count())) { out.stoppedAt = 'no add button'; await page.keyboard.press('Escape'); return; }
    out.addLabel = await add.innerText({ timeout: 3000 }).catch(() => '?');
    await add.click({ timeout: 15000 });
    await settle();
    out.afterAdd = { people: (await readScreen(page)).people, roomHits: await roomCount() };
    await shot('c4-after-add.png');
    await reload();
    const ra = await readScreen(page);
    out.afterAddReload = { people: ra.people, roomHits: await roomCount(), around: ra.main.slice(ra.main.indexOf('FOR EVERYONE'), ra.main.indexOf('FOR EVERYONE') + 500) };
    await shot('c4-after-add-reload.png');

    // Open the room and read its controls (private/open, marks). Read only.
    const chip = page.getByText(ROOM, { exact: false }).first();
    if (await chip.count()) {
      await chip.click({ timeout: 15000 }); await settle();
      out.roomDialog = await dump();
      await shot('c4-room-dialog.png');
    } else out.roomDialog = 'room not on board after reload';
  } catch (e) {
    out.stoppedAt = 'threw: ' + String(e).slice(0, 300);
  } finally {
    // Cleanup: remove my room, whatever stopped above.
    try {
      if (await dlg().count()) { await page.keyboard.press('Escape'); await settle(); }
      await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' }); await settle();
      if (await roomCount()) {
        await page.getByText(ROOM, { exact: false }).first().click({ timeout: 15000 }); await settle();
        const rm = dlg().getByRole('button', { name: /Remove|Delete/ }).first();
        if (await rm.count()) {
          out.removeLabel = await rm.innerText({ timeout: 3000 }).catch(() => '?');
          await rm.click({ timeout: 15000 }); await settle();
          out.removeConfirm = await dump();
          const yes = dlg().getByRole('button', { name: /^(Remove|Delete|Yes|OK)/ }).last();
          if (await yes.count()) { await yes.click({ timeout: 15000 }); await settle(); }
        } else { out.removeLabel = 'no remove button in room dialog'; await page.keyboard.press('Escape'); await settle(); }
        await reload();
      }
      const f = await readScreen(page);
      out.final = { people: f.people, roomHits: await roomCount() };
      await shot('c4-final.png');
    } catch (e) { out.cleanupError = String(e).slice(0, 300); }
    report();
  }
});
