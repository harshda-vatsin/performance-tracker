import { expect } from '@playwright/test';
import { as, gotoNav, test } from './helpers';

test.describe.configure({ mode: 'serial' });

// Runs after the journeys in 01-03, so the log already holds template, scorecard and employee events.

test('Admin reads system events only', async ({ page }) => {
  await as(page, 'E0001', async () => {
    await gotoNav(page, 'Audit log');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByTestId('chain-status')).toContainText('Hash chain intact');
    await expect(page.getByTestId('audit-LOGIN_OK').first()).toBeVisible();
    await expect(page.getByTestId('audit-TEMPLATE_ACTIVATED')).toHaveCount(0);
    await expect(page.getByLabel('Category')).toHaveCount(0); // one category: nothing to choose

    // Filter to one actor, then clear.
    await page.getByLabel('Actor').fill('E0003');
    await page.getByRole('button', { name: 'Apply' }).click();
    const rows = page.getByRole('table', { name: 'Audit events' }).locator('tbody tr');
    await expect(rows.first()).toContainText('E0003');
    for (const text of await rows.allInnerTexts()) expect(text).toContain('E0003');
    await page.getByLabel('Actor').fill('E9999');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('No matching events')).toBeVisible();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByTestId('audit-LOGIN_OK').first()).toBeVisible();
  });
});

test('Corporate HR reads business events only, with the before and after of a change', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await gotoNav(page, 'Audit log');
    await expect(page.getByTestId('audit-TEMPLATE_ACTIVATED').first()).toBeVisible();
    await expect(page.getByTestId('audit-LOGIN_OK')).toHaveCount(0);
    await expect(page.getByTestId('audit-ACCESS_DENIED')).toHaveCount(0);

    await page.getByLabel('Action').fill('TEMPLATE_ACTIVATED');
    await page.getByRole('button', { name: 'Apply' }).click();
    const row = page.getByTestId('audit-TEMPLATE_ACTIVATED').first();
    await row.getByText('View').click();
    await expect(row.locator('pre')).toContainText('"status": "ACTIVE"');
  });
});

test('nobody else gets the audit log', async ({ page }) => {
  for (const code of ['E0102', 'E0103', 'E0002', 'E0105']) {
    await as(page, code, async () => {
      await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Audit log' })).toHaveCount(0);
      await page.goto('/audit');
      await expect(page.getByText('Not available for your role')).toBeVisible();
    });
  }
});
