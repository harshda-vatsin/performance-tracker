import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { login, logout, PASSWORD, PERIOD, test, USERS } from './helpers';

/**
 * Screenshots every screen each seeded role can reach, into apps/web/screenshots/<login>-<role>/ (git-ignored).
 * It runs last, on the data the earlier specs left behind (templates, scorecards, a locked and a reopened month).
 * Besides the pictures it fails on anything that would also look broken to a person: API errors, "undefined"/"NaN"
 * text, and a page that scrolls sideways.
 */
const OUT = path.resolve('screenshots');
const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/;

test.describe.configure({ mode: 'serial' });

/** Make a screen show the seeded data rather than whatever today's date selects. */
async function pointAtSeededData(page: Page) {
  const month = page.getByLabel('Month', { exact: true });
  if (await month.count()) await month.first().fill(PERIOD);
  const plant = page.getByLabel('Plant', { exact: true });
  if (await plant.count()) {
    const trichy = plant.locator('option', { hasText: 'Trichy' });
    if (await trichy.count()) await plant.selectOption({ label: (await trichy.first().innerText()).trim() });
  }
  const unit = page.getByLabel('Unit', { exact: true });
  if (await unit.count()) {
    // TRY-PRS is the unit left locked by the cycle spec, so its trend screen has data to look at.
    const prs = unit.locator('option', { hasText: 'TRY-PRS' });
    if (await prs.count()) await unit.selectOption({ label: 'TRY-PRS' });
  }
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0);
}

async function check(page: Page, apiProblems: string[], label: string) {
  const text = await page.locator('body').innerText();
  const hit = text.match(BAD_TEXT);
  expect(hit, `${label}: page shows "${hit?.[0]}"`).toBeNull();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
  expect(apiProblems, `${label}: API errors`).toEqual([]);
}

/** The app scrolls inside <main>, so a plain full-page shot misses everything below the fold: grow the viewport to fit it. */
async function shoot(page: Page, dir: string, name: string) {
  fs.mkdirSync(dir, { recursive: true });
  const original = page.viewportSize()!;
  const needed = await page.evaluate(() => {
    const main = document.querySelector('main');
    return main ? main.scrollHeight + (window.innerHeight - main.clientHeight) : document.documentElement.scrollHeight;
  });
  await page.setViewportSize({ width: original.width, height: Math.min(Math.max(needed, original.height), 4000) });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
  await page.setViewportSize(original);
}

for (const [code, role] of USERS) {
  test(`${code} (${role}): every reachable screen`, async ({ page }) => {
    test.setTimeout(240_000);
    const apiProblems: string[] = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/') && res.status() >= 400 && !(url.endsWith('/api/me') && res.status() === 401) && !url.endsWith('/api/auth/login')) {
        apiProblems.push(`${res.status()} ${new URL(url).pathname}`);
      }
    });

    const dir = path.join(OUT, `${code}-${role}`);
    if (code === 'E0106') {
      // Seeded as OTP-only; OTP sign-in is not built yet, so a password is (correctly) refused. Show that, not a session.
      await page.goto('/login');
      await page.getByLabel('Employee code').fill(code);
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('alert')).toContainText('Employee code or password is incorrect');
      await shoot(page, dir, '00-otp-only-user-password-refused');
      return;
    }
    await login(page, code);
    await settle(page);
    await check(page, apiProblems, 'home');
    await shoot(page, dir, '00-home');

    const hrefs = await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
    let n = 1;
    for (const href of hrefs.filter((h) => h !== '/')) {
      await page.goto(href);
      await settle(page);
      await pointAtSeededData(page);
      await settle(page);
      const name = `${String(n++).padStart(2, '0')}-${href.replace(/^\//, '').replace(/\//g, '-')}`;
      await check(page, apiProblems, href);
      await shoot(page, dir, name);

      // One level deeper: the first record of each list, which is where the real work happens.
      const detail = { '/submissions': /^Open /, '/scorecards': /^Open /, '/templates': /./ }[href];
      if (detail) {
        const link = href === '/templates' ? page.locator('tbody a').first() : page.getByRole('link', { name: detail }).first();
        if (await link.count()) {
          await link.click();
          await settle(page);
          await check(page, apiProblems, `${href} detail`);
          await shoot(page, dir, `${name}-detail`);
        }
      }
    }
    await logout(page);
  });
}

test('sign-in, a wrong password, a screen the role does not have, and an unknown page', async ({ page }) => {
  const dir = path.join(OUT, 'anonymous');
  await page.goto('/login');
  await shoot(page, dir, '00-login');
  await page.getByLabel('Employee code').fill('E0101');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Employee code or password is incorrect');
  await shoot(page, dir, '01-login-wrong-password');

  await page.goto('/submissions'); // signed out: redirected to sign-in
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await login(page, 'E0105');
  await page.goto('/submissions');
  await expect(page.getByText('Not available for your role')).toBeVisible();
  await shoot(page, dir, '02-role-has-no-screen');
  await page.goto('/no-such-page');
  await expect(page.getByText('Page not found')).toBeVisible();
  await shoot(page, dir, '03-not-found');
  await logout(page);
});

test('phone and tablet widths for the screens used on the shop floor', async ({ page }) => {
  test.setTimeout(240_000);
  const apiProblems: string[] = [];
  page.on('response', (res) => res.url().includes('/api/') && res.status() >= 400 && !res.url().endsWith('/api/me') && !res.url().endsWith('/api/auth/login') && apiProblems.push(`${res.status()} ${new URL(res.url()).pathname}`));
  await login(page, 'E0101');
  for (const [label, size] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 768, height: 1024 }]] as const) {
    await page.setViewportSize(size);
    for (const href of ['/', '/submissions', '/plants', '/scorecards']) {
      await page.goto(href);
      await settle(page);
      await pointAtSeededData(page);
      await settle(page);
      await check(page, apiProblems, `${label} ${href}`);
      await shoot(page, path.join(OUT, `E0101-PHR-${label}`), href === '/' ? '00-home' : href.slice(1));
    }
    await page.goto('/submissions');
    await settle(page);
    await page.getByLabel('Month', { exact: true }).fill(PERIOD);
    await page.getByRole('link', { name: /^Open TRY-HAM/ }).click();
    await settle(page);
    await check(page, apiProblems, `${label} entry`);
    await shoot(page, path.join(OUT, `E0101-PHR-${label}`), 'submission-detail');
  }
  await page.setViewportSize({ width: 1366, height: 850 });
  await logout(page);
  expect(PASSWORD).toBeTruthy();
});
