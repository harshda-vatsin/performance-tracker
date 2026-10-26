import { expect, test as base, type Page } from '@playwright/test';

/**
 * `test` with a guard: any uncaught exception or console error in the page fails the test, so a screen that
 * crashes into a blank page can never pass silently. API refusals (4xx) are expected behaviour and are ignored.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text()}`);
    });
    await use(page);
    expect(problems, 'the page logged errors').toEqual([]);
  },
});

export const API_PORT = 4100;
export const WEB_PORT = 5273;
/** Every seeded user gets this password in the e2e database (SEED_PASSWORD). Dev-only; the DB is dropped each run. */
export const PASSWORD = 'E2e-Passw0rd-dev';
export const DB_NAME = 'mmf_e2e';
/** The month the suite works on (FY 2026-27, Q2). */
export const PERIOD = '2026-09';

/** The seeded users, in seed order (apps/api/src/seed.ts). */
export const USERS = [
  ['E0001', 'ADMIN'], ['E0002', 'MGMT'], ['E0003', 'CHR'], ['E0004', 'CHR'], ['E0005', 'EMP'],
  ['E0101', 'PHR'], ['E0102', 'PH'], ['E0103', 'HOD'], ['E0104', 'HOD'], ['E0105', 'EMP'], ['E0106', 'EMP'], ['E0107', 'EMP'],
  ['E0201', 'PHR'], ['E0202', 'PH'], ['E0203', 'HOD'], ['E0204', 'HOD'], ['E0205', 'EMP'], ['E0206', 'EMP'],
  ['E0301', 'PHR'], ['E0302', 'EMP'],
] as const;

export async function login(page: Page, code: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Employee code').fill(code);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('user-name')).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/** Signs in as `code`, runs the steps, and always signs out so the next user starts clean. */
export async function as(page: Page, code: string, steps: () => Promise<void>): Promise<void> {
  await login(page, code);
  await steps();
  await logout(page);
}

export async function gotoNav(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: label }).click();
}

/** Opens the unit's row in a list/board by its "Open <unit>" link. */
export async function openUnit(page: Page, unitCode: string): Promise<void> {
  await page.getByRole('link', { name: `Open ${unitCode}` }).click();
}

export const stateOf = (page: Page) => page.getByTestId('state-chip').first();
