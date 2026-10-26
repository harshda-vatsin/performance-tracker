// Click-through of the main flows: full appraisal, shift entry with a breakdown, CSV + Excel exports.
// Usage: node scripts/flows.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
fs.mkdirSync('screenshots/downloads', { recursive: true });

const problems = [];
const results = [];
let step = 'startup';
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[console.${m.type()}] ${step}: ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => problems.push(`[pageerror] ${step}: ${String(e).slice(0, 300)}`));
page.on('requestfailed', (r) => problems.push(`[requestfailed] ${step}: ${r.url()}`));

const role = async (label) => {
  await page.locator('header button', { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(400);
};
const nav = async (title) => {
  await page.locator(`aside nav button[title="${title}"]`).click();
  await page.waitForTimeout(500);
};
const bodyText = () => page.locator('main').innerText();

await page.goto(BASE, { waitUntil: 'networkidle' });

// ---------- Flow 1: full appraisal for Karthik (self -> manager -> reviewer -> HR) ----------
step = 'appraisal/self';
await role('Employee'); // default person: Karthik Subramanian
await nav('My Appraisal');
ok('Employee sees Karthik in Self-assessment', (await bodyText()).includes('Self-assessment') && (await bodyText()).includes('Karthik'));
await page.locator('textarea').fill('H1 tonnage ran 16% ahead of plan; OEE gains from SMED on the 2500 T press.');
await page.getByRole('button', { name: 'Submit self-assessment' }).click();
await page.waitForTimeout(500);
ok('Status moved to Manager assessment', (await bodyText()).includes('Pending with:') && (await bodyText()).includes('Reporting Manager'));

step = 'appraisal/manager';
await role('Manager'); // default manager: Rajagopal Iyer
await nav('Appraisals');
await page.locator('tr', { hasText: 'Karthik Subramanian' }).click();
await page.waitForTimeout(500);
await page.locator('textarea').fill('Consistently ahead of plan; recommend stretch role.');
await page.getByRole('button', { name: 'Submit manager assessment' }).click();
await page.waitForTimeout(500);
ok('Status moved to Reviewer sign-off', (await bodyText()).includes('Reviewer'));

step = 'appraisal/reviewer';
await role('Plant Head');
await nav('Appraisals');
await page.locator('tr', { hasText: 'Karthik Subramanian' }).click();
await page.waitForTimeout(500);
await page.locator('textarea').fill('Agree with manager. Top-band increment recommended.');
await page.getByRole('button', { name: 'Sign off as reviewer' }).click();
await page.waitForTimeout(500);
ok('Status moved to HR finalisation', (await bodyText()).includes('HR'));

step = 'appraisal/hr';
await role('HR');
await nav('Appraisals');
await page.locator('tr', { hasText: 'Karthik Subramanian' }).click();
await page.waitForTimeout(500);
await page.locator('textarea').fill('Calibrated and finalised per increment guideline.');
await page.getByRole('button', { name: 'Finalise and lock' }).click();
await page.waitForTimeout(600);
const finalText = await bodyText();
ok('Appraisal Finalised and locked', finalText.includes('Finalised') && finalText.includes('Locked') && finalText.includes('Increment'));
ok('Comment trail has all four steps', ['Self-assessment', 'Manager assessment', 'Reviewer sign-off', 'HR finalisation'].every((s) => finalText.includes(s)));
await page.screenshot({ path: 'screenshots/flow-appraisal-finalised.png', fullPage: false });

// ---------- Flow 2: shift entry with a breakdown ----------
step = 'shift';
await role('Supervisor');
await nav('Shift Entry');
await page.getByRole('button', { name: 'Fill example shift' }).click();
await page.waitForTimeout(300);
const pre = await bodyText();
ok('Preview shows breakdown excluded from standard', /−\s*90 min/.test(pre) || pre.includes('90 min'));
await page.screenshot({ path: 'screenshots/flow-shift-entry-preview.png', fullPage: true });
await page.getByRole('button', { name: 'Save shift record' }).click();
await page.waitForTimeout(600);
const post = await page.locator('body').innerText();
ok('Shift saved (toast shown)', post.includes('Shift data saved'));
ok('New entry appears in Recent entries', (await bodyText()).includes('22 Oct 2026'));
await nav('Operator Scorecards');
ok('Scorecards render after save', (await bodyText()).includes('Arumugam Selvaraj'));

// ---------- Flow 3: exports ----------
step = 'export';
await role('HR');
await nav('Reports');
for (const [label, ext] of [['CSV', 'csv'], ['Excel', 'xlsx']]) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: label, exact: true }).click()]);
  const p = `screenshots/downloads/${dl.suggestedFilename()}`;
  await dl.saveAs(p);
  const size = fs.statSync(p).size;
  ok(`${label} export downloads (${dl.suggestedFilename()})`, dl.suggestedFilename().endsWith('.' + ext) && size > 500, `${size} bytes`);
  if (ext === 'csv') {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    ok('CSV has header + 16 staff rows', lines.length === 17, `${lines.length} lines; header: ${lines[0].slice(0, 90)}`);
  } else {
    const head = fs.readFileSync(p).subarray(0, 2).toString();
    ok('Excel file is a valid zip (xlsx)', head === 'PK');
  }
}
// Dashboard export button too
await nav('HR Dashboard');
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Export to Excel' }).click()]);
ok('HR Dashboard "Export to Excel" downloads', dl2.suggestedFilename().endsWith('.xlsx'), dl2.suggestedFilename());

console.log('\nConsole / network problems during flows:', problems.length);
problems.forEach((p) => console.log(p));
fs.writeFileSync('screenshots/_flows.json', JSON.stringify({ results, problems }, null, 2));
await browser.close();
