/**
 * BUILD-YOUR-WORKSPACE AREA B1 PROBE -- "Bring in from a file", SYNTHETIC files only.
 *
 * For each fixture: open the import dialog from MY synthetic draft board, hand the file
 * to the dialog's file input, read what the dialog says, then Cancel. It NEVER presses
 * "Add N people to the plan" and never Send, so the board must stay at 5 people.
 *
 * Fixtures are generated here (example.com only) so nothing large is committed.
 * Expected outcomes come from WorkforcePlanPage-DQWg78vx.js (staging bundle BOEW7io4):
 *   cap ko = 5*1024*1024 with `size > ko`  -> exactly 5 MiB must be READ, +1 byte TOO_BIG
 *   PK\x03\x04 or D0 CF 11 E0              -> WORKBOOK
 *   decoded text containing \0             -> NOT_TEXT   (a binary WITHOUT a NUL byte
 *                                             falls back to windows-1252: hypothesis H1 =
 *                                             it is read as text, not refused)
 *   0 rows after the header                -> EMPTY
 * Real per-source exports (Google/Slack/M365) are NOT covered: those need genuine files.
 *
 * Privacy claim "The file never leaves your browser": every request while a fixture is
 * in the dialog is logged; a body containing the marker ZQMARK7731 (present in every
 * text fixture) or a body >= 1 MB would refute it. Armed check: the marker is also
 * searched in the dialog text, so a positive is possible.
 *
 * Output: one line starting BYW_PROBE_RESULT followed by JSON. -- MeQAtron
 */
import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { LoginPage } from '../pages/LoginPage';

const ORG_ID = 'a24d9793-4966-4611-975a-f7746e7fecf3';
const PLAN = `/manager/organizations/${ORG_ID}/workforce/plan`;
const MARK = 'ZQMARK7731';
const CAP = 5 * 1024 * 1024;

const csvRow = (cells: string[], sep = ',') =>
  cells.map((c) => (/[",\n;\t]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(sep);

const sizedCsv = (size: number) => {
  // Header + rows of synthetic people, padded so the byte length is EXACT.
  let s = `Name,Email,Job title\n`;
  let i = 0;
  while (true) {
    const line = `Person ${i} ${MARK},p${i}.zq@example.com,Tester\n`;
    if (Buffer.byteLength(s + line) > size - 64) break;
    s += line;
    i++;
  }
  const tail = `Last Person,last.zq@example.com,`;
  const pad = size - Buffer.byteLength(s + tail + '\n');
  s += tail + 'x'.repeat(pad) + '\n';
  return Buffer.from(s, 'utf-8');
};

const pngBytes = () => {
  // A real 1x1 PNG (has NUL bytes in its chunk lengths).
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
};

const noNulBinary = () => {
  // Deterministic bytes 1..255, no 0x00 and no leading magic. H1: read as text.
  const b = Buffer.alloc(4096);
  let x = 7;
  for (let i = 0; i < b.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = 1 + (x % 255); }
  return b;
};

const EDGE_PEOPLE = [
  ['Tanaka, Aiko', 'aiko.zq@example.com', 'Sales', 'Head of "Sales"'],
  ['José Müller', 'jose.zq@example.com', 'Sales', 'Engineer'],
  ['山田 太郎', 'yamada.zq@example.com', 'Ops', ''],
  [`Zoë Ångström ${MARK}`, 'zoe.zq@example.com', 'Ops', ''],
];
const EDGE_HEADER = ['Name', 'Email', 'Department', 'Job title'];
const edgeCsv = (sep: string, eol: string, bom: boolean) => {
  const rows = [
    EDGE_HEADER,
    ...EDGE_PEOPLE,
    EDGE_PEOPLE[1], // exact duplicate -> DUPLICATE skip
    ['', '', '', ''], // no name, no email -> EMPTY skip
    ['Bad Email Person', 'not-an-email', 'Ops', ''], // -> bad email
  ];
  const body = rows.map((r) => csvRow(r, sep)).join(eol) + eol;
  return Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(body, 'utf-8')]);
};

const bigCsv = (n: number) => {
  let s = 'Name,Email,Department\n';
  for (let i = 0; i < n; i++) s += `Bulk Person ${i} ${MARK},bulk${i}.zq@example.com,Dept ${i % 4}\n`;
  return Buffer.from(s, 'utf-8');
};

// Shift_JIS for 山田 太郎 / 佐藤 花子 (hand-encoded, so no iconv dependency).
const sjisCsv = () =>
  Buffer.concat([
    Buffer.from('Name,Email\r\n'),
    Buffer.from([0x8e, 0x52, 0x93, 0x63, 0x20, 0x91, 0xbe, 0x98, 0x59]), Buffer.from(',sj1.zq@example.com\r\n'),
    Buffer.from([0x8d, 0xb2, 0x93, 0xa1, 0x20, 0x89, 0xd4, 0x8e, 0x71]), Buffer.from(`,sj2.zq@example.com\r\n`),
  ]);

const FIXTURES: { id: string; name: string; expect: string; data: () => Buffer }[] = [
  { id: 'header-only', name: 'header-only.csv', expect: 'EMPTY', data: () => Buffer.from('Name,Email,Department\r\n') },
  { id: 'xlsx', name: 'people.xlsx', expect: 'WORKBOOK', data: () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 1)]) },
  { id: 'xls', name: 'people.xls', expect: 'WORKBOOK', data: () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(56, 1)]) },
  { id: 'png', name: 'photo.png', expect: 'NOT_TEXT', data: pngBytes },
  { id: 'binary-no-nul', name: 'blob.bin', expect: 'H1: read as text (no NUL)', data: noNulBinary },
  { id: 'exactly-5MiB', name: 'exact-5MiB.csv', expect: 'READ (not TOO_BIG)', data: () => sizedCsv(CAP) },
  { id: '5MiB-plus-1', name: 'over-5MiB.csv', expect: 'TOO_BIG', data: () => sizedCsv(CAP + 1) },
  { id: 'edge-csv-bom-crlf', name: 'edge.csv', expect: '4 add, 1 dup, 1 empty, 1 bad email; Sales+Ops', data: () => edgeCsv(',', '\r\n', true) },
  { id: 'edge-tsv', name: 'edge.tsv', expect: 'same as edge-csv', data: () => edgeCsv('\t', '\n', false) },
  { id: 'edge-semicolon', name: 'edge-semi.csv', expect: 'same as edge-csv', data: () => edgeCsv(';', '\n', false) },
  { id: 'rows-1200', name: 'bulk-1200.csv', expect: '1200 rows read', data: () => bigCsv(1200) },
  { id: 'shift-jis', name: 'sjis.csv', expect: '2 people, Japanese names intact', data: sjisCsv },
];

test('area B1: synthetic file problem states + edge data + privacy', async ({ page }, testInfo) => {
  test.setTimeout(9 * 60 * 1000);
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

  const settle = (ms = 1500) => page.waitForTimeout(ms);
  const peopleOnBoard = (p: Page) =>
    p.evaluate(() => (document.body.innerText.match(/(\d+) people, \d+ team/) || [])[1] ?? null);

  await page.goto(origin + PLAN, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Start again|What are you bringing in\?/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => undefined);
  await settle(2500);
  if (new URL(page.url()).pathname.startsWith('/u/')) throw new Error('bounced to login: probe did not arm');
  const peopleBefore = await peopleOnBoard(page);
  let stoppedAt: string | null = null;
  if (peopleBefore !== '5') stoppedAt = 'board is not my 5-person draft: ' + peopleBefore;

  // Network log for the privacy claim. Only requests while a file is in the dialog count.
  let activeFx: string | null = null;
  const net: { fx: string; method: string; url: string; bodyLen: number; hasMark: boolean }[] = [];
  page.on('request', (r) => {
    if (!activeFx) return;
    const body = r.postDataBuffer();
    net.push({
      fx: activeFx, method: r.method(), url: r.url().slice(0, 140),
      bodyLen: body ? body.length : 0,
      hasMark: body ? body.includes(MARK) : false,
    });
  });

  const dlg = () => page.locator('[role="dialog"]:visible').last();
  const results: Record<string, unknown>[] = [];
  const openButton = page.getByRole('button', { name: 'Bring in from a file', exact: true }).first();
  if (!stoppedAt && !(await openButton.count())) stoppedAt = '"Bring in from a file" not on the board';

  for (const fx of stoppedAt ? [] : FIXTURES) {
    const r: Record<string, unknown> = { id: fx.id, expect: fx.expect };
    try {
      const path = testInfo.outputPath(fx.name);
      const data = fx.data();
      fs.writeFileSync(path, data);
      r.bytes = data.length;
      await openButton.click({ timeout: 15000 });
      await settle(1000);
      if (!(await dlg().count())) throw new Error('import dialog did not open');
      const input = dlg().locator('input[type="file"]');
      r.inputs = await input.count();
      r.accept = await input.first().getAttribute('accept').catch(() => null);
      activeFx = fx.id;
      const t0 = Date.now();
      await input.first().setInputFiles(path);
      await page.waitForFunction(() => !/Reading the file…/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => undefined);
      await settle(2000);
      r.ms = Date.now() - t0;
      const text = (await dlg().innerText().catch(() => '')).replace(/\s+/g, ' ');
      r.markInDialog = text.includes(MARK);
      // Drop the "how to" boilerplate: start at the first result line we know of.
      const anchors = ['This is an Excel', 'This file is not', 'This file is over', 'There is nobody', 'The file could not', 'Read as', 'This is a ', 'This file has', 'This file would'];
      const at = Math.min(...anchors.map((a) => text.indexOf(a)).filter((i) => i >= 0), text.length);
      r.text = (at < text.length ? text.slice(at) : text).slice(0, 1400);
      r.buttons = await dlg().locator('button').allInnerTexts().catch(() => []);
      await page.screenshot({ path: testInfo.outputPath(`b1-${fx.id}.png`), fullPage: false });
      activeFx = null;
      // Close WITHOUT adding: Cancel, else Escape.
      const cancel = dlg().getByRole('button', { name: /^(Cancel|Close)$/ }).first();
      if (await cancel.count()) await cancel.click({ timeout: 10000 });
      else await page.keyboard.press('Escape');
      await settle(1000);
      if (await dlg().count()) { await page.keyboard.press('Escape'); await settle(800); }
      r.dialogClosed = (await dlg().count()) === 0;
      if (!r.dialogClosed) { results.push(r); stoppedAt = `dialog would not close after ${fx.id}`; break; }
    } catch (e) {
      activeFx = null;
      r.error = String(e).slice(0, 300);
      await page.keyboard.press('Escape').catch(() => undefined);
      await settle(800);
    }
    results.push(r);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
  await settle(4000);
  const peopleAfterReload = await peopleOnBoard(page);
  await page.screenshot({ path: testInfo.outputPath('b1-board-after.png'), fullPage: true });

  const netSummary = {
    requests: net.length,
    withBody: net.filter((n) => n.bodyLen > 0).length,
    maxBody: Math.max(0, ...net.map((n) => n.bodyLen)),
    withMark: net.filter((n) => n.hasMark),
    hosts: [...new Set(net.map((n) => { try { return new URL(n.url).host; } catch { return n.url; } }))],
  };
  console.log('BYW_PROBE_RESULT ' + JSON.stringify({
    stoppedAt, peopleBefore, peopleAfterReload, netSummary, results, consoleErrors: consoleErrors.slice(0, 15),
  }));
});
