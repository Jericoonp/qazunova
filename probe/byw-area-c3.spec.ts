/**
 * BUILD-YOUR-WORKSPACE AREA C PROBE, step 3 -- lead and person role.
 * (Step 1 run 37689442043 and step 2 run 37691828971: units, nesting, move, kind, remove. PASS.)
 *
 * On MY OWN synthetic draft board (5 people, 1 team; stops otherwise). Draft-only:
 * never presses Send / Review and send / Hand to its lead.
 *
 * 1. Read "Hand to its lead" before any lead (expect disabled, "Set its lead first.").
 * 2. Set the lead of the team to Carl (synthetic) -> reload -> is Hand to its lead enabled?
 * 3. Open Carl's card -> read the person dialog -> role Guest -> reload ->
 *    is Hand to its lead blocked with the GUEST reason?
 * 4. Restore, whatever stopped above: Carl back to Member, lead -> "No lead" -> reload.
 *
 * Output: one line BYW_PROBE_RESULT + JSON, plus screenshots c3-*.png.
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


const handState = async (page: Page, unit: string) => {
  const menu = page.locator(`[aria-label="More for ${unit}"]`).first();
  if (!(await menu.count())) return { error: 'no menu' };
  await menu.click({ timeout: 15000 });
  await page.waitForTimeout(1000);
  const mi = page.getByRole('menuitem', { name: /Hand to its lead/ }).first();
  const out = (await mi.count())
    ? {
        text: (await mi.innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' '),
        ariaDisabled: await mi.getAttribute('aria-disabled'),
        cls: ((await mi.getAttribute('class')) || '').includes('Mui-disabled'),
      }
    : {
        error: 'no Hand to its lead item',
        // Name-independent: the label may change once a lead exists.
        items: await page.getByRole('menuitem').evaluateAll((els) =>
          els.map((e) => ({
            text: ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 120),
            ariaDisabled: e.getAttribute('aria-disabled'),
          })),
        ),
      };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  return out;
};

test('area C step 3: lead and person role on my synthetic draft', async ({ page }, testInfo) => {
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
  // The person panel is a MUI Drawer whose paper carries NO role="dialog" (run 37693890661), so match its paper too.
  const dlg = () => page.locator('[role="dialog"]:visible, .MuiDrawer-paper:visible').first();
  const closeDlg = async () => {
    if (!(await dlg().count())) return 'no dialog';
    const done = dlg().getByRole('button', { name: /^(Save|Done|OK|Close)$/ }).last();
    // Read the label BEFORE clicking: the button detaches on close and a post-click innerText waits forever (run 37694305175 hung 256s here).
    if (await done.count()) { const label = await done.innerText({ timeout: 3000 }).catch(() => '?'); await done.click({ timeout: 15000 }); await settle(); return 'clicked ' + label; }
    await page.keyboard.press('Escape'); await settle(); return 'escape';
  };
  const pickLead = async (parent: string, choice: RegExp, tag: string) => {
    const err = await openMenuItem(page, parent, /^Set the lead$/);
    if (err) return err;
    r[tag + 'Dialog'] = await dialogRead(page);
    await shot(`c3-${tag}-dialog.png`);
    const combo = dlg().getByRole('combobox').first();
    if (await combo.count()) {
      await combo.click({ timeout: 15000 });
      await page.waitForTimeout(800);
      r[tag + 'Options'] = await page.getByRole('option').allInnerTexts().catch(() => []);
      const opt = page.getByRole('option', { name: choice }).first();
      if (!(await opt.count())) { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); return `lead list has no ${choice}`; }
      await opt.click({ timeout: 15000 });
    } else {
      const opt = dlg().getByRole('radio', { name: choice }).or(dlg().getByRole('button', { name: choice })).or(dlg().getByRole('option', { name: choice })).first();
      r[tag + 'Options'] = 'no combobox';
      if (!(await opt.count())) { await page.keyboard.press('Escape'); return `lead dialog has no ${choice}`; }
      await opt.click({ timeout: 15000 });
    }
    await page.waitForTimeout(800);
    r[tag + 'Close'] = await closeDlg();
    await reload();
    return null;
  };
  const setRole = async (role: RegExp, tag: string) => {
    const card = page.getByText(CARD, { exact: true }).first();
    if (!(await card.count())) return `no person card "${CARD}"`;
    await card.click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    r[tag + 'PersonDialog'] = await dialogRead(page);
    await shot(`c3-${tag}-person.png`);
    if (!(await dlg().count())) return 'tapping the person opened no dialog';
    const radio = dlg().getByRole('radio', { name: role }).first();
    const btn = dlg().getByRole('button', { name: role }).first();
    const combo = dlg().getByRole('combobox', { name: /In the workspace|Role/ }).first();
    if (await radio.count()) await radio.check({ timeout: 15000 });
    else if (await btn.count()) await btn.click({ timeout: 15000 });
    else if (await combo.count()) {
      await combo.click({ timeout: 15000 });
      await page.waitForTimeout(800);
      r[tag + 'RoleOptions'] = await page.getByRole('option').allInnerTexts().catch(() => []);
      const opt = page.getByRole('option', { name: role }).first();
      if (!(await opt.count())) { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); return `role list has no ${role}`; }
      await opt.click({ timeout: 15000 });
    } else { await page.keyboard.press('Escape'); return 'person dialog has no role control'; }
    await page.waitForTimeout(800);
    r[tag + 'PersonAfterPick'] = await dialogRead(page);
    r[tag + 'Close'] = await closeDlg();
    await reload();
    return null;
  };

  await page.goto(origin + PLAN_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Start again|What are you bringing in\?/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => undefined);
  await settle();

  const r: Record<string, unknown> = {};
  let stoppedAt: string | null = null;
  const b = await readScreen(page);
  r.before = { people: b.people, ariaMenus: b.ariaMenus };
  await shot('c3-before.png');
  if (b.url.startsWith('/u/')) throw new Error('bounced to login: probe did not arm');
  const parent = (b.ariaMenus[0] || '').replace(/^More for /, '');
  r.parent = parent;
  if (!b.hasAgain) stoppedAt = 'no board on load';
  else if (!b.people || !b.people.startsWith('5 people, 1 team')) stoppedAt = 'board is not my 5-person 1-team draft: ' + b.people;
  else if (b.ariaMenus.length !== 1 || !parent) stoppedAt = 'expected exactly one unit menu, saw ' + JSON.stringify(b.ariaMenus);
  else if (!b.main.includes(CARD)) stoppedAt = `no "${CARD}" card on the board`;

  if (!stoppedAt) r.handBefore = await handState(page, parent);

  // 2. Lead = Carl.
  let leadSet = false;
  if (!stoppedAt) {
    stoppedAt = await pickLead(parent, new RegExp(LEAD), 'lead');
    if (!stoppedAt) {
      leadSet = true;
      const s = await readScreen(page);
      const i = s.main.indexOf(parent);
      r.reloadAfterLead = { people: s.people, around: s.main.slice(Math.max(0, i - 40), i + 300) };
      await shot('c3-reload-after-lead.png');
      r.handWithLead = await handState(page, parent);
    }
  }

  // 3. Carl -> Guest.
  let guestSet = false;
  if (!stoppedAt) {
    stoppedAt = await setRole(/^Guest/, 'guest');
    if (!stoppedAt) {
      guestSet = true;
      const s = await readScreen(page);
      r.reloadAfterGuest = { people: s.people, main: s.main.slice(0, 900) };
      await shot('c3-reload-after-guest.png');
      r.handWithGuestLead = await handState(page, parent);
    }
  }

  // 4. Restore whatever stopped above.
  if (await dlg().count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(800); }
  if (await dlg().count()) await reload(); // never leave a modal over the unit menu (run 37693890661 died here)
  if (guestSet) r.restoreRole = (await setRole(/^Member/, 'member')) ?? 'ok';
  if (leadSet) {
    r.restoreLead = (await pickLead(parent, /No lead|Nobody|No one|Remove( the)? lead|Clear/i, 'nolead')) ?? 'ok';
    r.handAfterClear = await handState(page, parent);
  }
  const s = await readScreen(page);
  r.final = { people: s.people, ariaMenus: s.ariaMenus };
  await shot('c3-final.png');

  console.log('BYW_PROBE_RESULT ' + JSON.stringify({ stoppedAt, ...r, consoleErrors: consoleErrors.slice(0, 15) }));
});
