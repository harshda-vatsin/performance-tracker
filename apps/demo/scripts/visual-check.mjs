// Visual check: screenshots every sidebar page for every role + tablet shots, and records console/network problems.
// Usage: node scripts/visual-check.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = 'screenshots';
fs.mkdirSync(OUT, { recursive: true });

const ROLES = [
  { key: 'employee', label: 'Employee' },
  { key: 'manager', label: 'Manager' },
  { key: 'hr', label: 'HR' },
  { key: 'management', label: 'Plant Head' },
  { key: 'supervisor', label: 'Supervisor' },
];

const problems = [];
let current = 'startup';
const note = (kind, detail) => problems.push({ where: current, kind, detail });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') note(`console.${m.type()}`, m.text().slice(0, 400));
});
page.on('pageerror', (e) => note('pageerror', String(e).slice(0, 400)));
page.on('requestfailed', (r) => note('requestfailed', `${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => r.status() >= 400 && note('http' + r.status(), r.url()));

async function shot(file, width, fit = true) {
  if (fit) {
    const h = await page.evaluate(() => {
      const main = document.querySelector('main');
      const header = document.querySelector('header');
      return (main?.scrollHeight ?? 900) + (header?.getBoundingClientRect().height ?? 56) + 4;
    });
    await page.setViewportSize({ width, height: Math.round(Math.min(Math.max(h, 700), 6000)) });
    await page.waitForTimeout(400); // let charts re-measure
  }
  await page.screenshot({ path: `${OUT}/${file}.png` });
  const blank = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').trim().length);
  if (blank < 60) note('blank-page', `${file}: main text length ${blank}`);
  await page.setViewportSize({ width, height: 900 });
}

async function selectRole(label, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  if (width >= 1280) {
    await page.locator('header button', { hasText: new RegExp(`^${label}$`) }).first().click();
  } else {
    const map = { Employee: 'employee', Manager: 'manager', HR: 'hr', 'Plant Head': 'management', Supervisor: 'supervisor' };
    await page.locator('header select[aria-label="Switch role"]').selectOption(map[label]);
  }
  await page.waitForTimeout(500);
}

await page.goto(BASE, { waitUntil: 'networkidle' });

for (const role of ROLES) {
  current = role.key;
  await selectRole(role.label);
  const items = await page.locator('aside nav button').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  for (const title of items) {
    current = `${role.key}/${title}`;
    await page.locator(`aside nav button[title="${title}"]`).click();
    await page.waitForTimeout(700);
    await shot(`${role.key}-${slug(title)}`, 1440);
  }
}

// Tablet (768px) shots
for (const [roleLabel, roleKey, navTitle, name] of [
  ['Supervisor', 'supervisor', 'Shift Entry', 'shift-entry'],
  ['Supervisor', 'supervisor', 'Operator Scorecards', 'operator-scorecards'],
  ['HR', 'hr', 'Operator Scorecards', 'operator-scorecards'],
]) {
  current = `tablet/${roleKey}/${navTitle}`;
  await selectRole(roleLabel, 768);
  await page.locator(`aside nav button[title="${navTitle}"]`).click();
  await page.waitForTimeout(700);
  await shot(`tablet768-${roleKey}-${name}`, 768);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  if (overflow) note('horizontal-page-overflow', `${roleKey}/${navTitle} at 768px`);
}

fs.writeFileSync(`${OUT}/_report.json`, JSON.stringify(problems, null, 2));
console.log(`done. ${problems.length} problem(s) recorded`);
for (const p of problems) console.log(`[${p.kind}] ${p.where}: ${p.detail}`);
await browser.close();
