import { expect, type Page } from '@playwright/test';

export { test } from '../e2e/helpers';

export const DEMO_API_PORT = 4300;
export const DEMO_WEB_PORT = 5373;
export const DEMO_DB = 'mmf_demo';
/** The one password every demo login shares (apps/api/src/seed-demo.ts). */
export const DEMO_PASSWORD = 'Demo-2026-Pass';
/** The open month, and the last locked one. */
export const OPEN_MONTH = '2026-10';
export const LAST_LOCKED = '2026-09';

export async function login(page: Page, code: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Employee code').fill(code);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('user-name')).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/** Signs in as `code`, runs the steps, and always signs out so the next person starts clean. */
export async function as(page: Page, code: string, steps: () => Promise<void>): Promise<void> {
  await login(page, code);
  await steps();
  await logout(page);
}

export async function gotoNav(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: label }).click();
}
