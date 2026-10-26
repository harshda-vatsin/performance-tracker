import { expect } from '@playwright/test';
import { as, gotoNav, test } from './helpers';

test.describe.configure({ mode: 'serial' });

// The seed has two FY 2026 appraisals: E0107 reviewed by the Plant Head (E0102), E0302 reviewed by Management (E0002).

test('Corporate HR assigns reviewers; only an HOD / Manager, Plant Head or Management user will do', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await gotoNav(page, 'Appraisals');
    await page.getByLabel('Fiscal year').fill('2026');
    await expect(page.getByTestId('appraisal-E0107')).toContainText('E0102');
    await expect(page.getByTestId('appraisal-E0302')).toContainText('E0002');

    await page.getByRole('button', { name: 'Change reviewer for E0107' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Reviewer').fill('E0105'); // an Employee
    await dlg.getByRole('button', { name: 'Assign reviewer' }).click();
    await expect(dlg.getByRole('alert')).toContainText('a reviewer must hold HOD / Manager, Plant Head or Management');
    await dlg.getByLabel('Reviewer').fill('E0107'); // the appraisee, even if they held a qualifying role
    await dlg.getByRole('button', { name: 'Assign reviewer' }).click();
    await expect(dlg.getByRole('alert')).toBeVisible();
    await dlg.getByLabel('Reviewer').fill('E0103'); // an HOD
    await dlg.getByRole('button', { name: 'Assign reviewer' }).click();
    await expect(page.getByText('Reviewer assigned')).toBeVisible();
    await expect(page.getByTestId('appraisal-E0107')).toContainText('E0103');

    await page.getByRole('button', { name: 'New appraisal' }).click();
    await dlg.getByLabel('Employee code').fill('E0206');
    await dlg.getByLabel('Fiscal year').fill('2026');
    await dlg.getByLabel('Reviewer (optional)').fill('E0104');
    await dlg.getByRole('button', { name: 'Add appraisal' }).click();
    await expect(page.getByText('Appraisal added')).toBeVisible();
    await expect(page.getByTestId('appraisal-E0206')).toContainText('E0104');
  });
});

test('a reviewer sees the appraisals assigned to them and cannot change them', async ({ page }) => {
  await as(page, 'E0103', async () => {
    await gotoNav(page, 'Appraisals');
    await page.getByLabel('Fiscal year').fill('2026');
    await expect(page.getByTestId('appraisal-E0107')).toBeVisible();
    await expect(page.getByTestId('appraisal-E0206')).toHaveCount(0); // E0104 reviews that one
    await expect(page.getByRole('button', { name: 'New appraisal' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Change reviewer/ })).toHaveCount(0);
  });
});

test('an Employee has no appraisals screen and sees their own results', async ({ page }) => {
  await as(page, 'E0105', async () => {
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Appraisals' })).toHaveCount(0);
    await page.goto('/appraisals');
    await expect(page.getByText('Not available for your role')).toBeVisible();

    await page.route('**/api/me/scores', (route) =>
      route.fulfill({
        json: { unitMonths: [{ period: '2026-09', unitCode: 'TRY-HAM', unitName: 'Hammer Shop', levelCode: 'HOD', levelName: 'HOD', daysInUnit: 30, score: '91.5' }] },
      }),
    );
    await gotoNav(page, 'My results');
    const row = page.getByRole('table', { name: 'My results' }).locator('tbody tr');
    await expect(row).toContainText('Sep 2026');
    await expect(row).toContainText('Hammer Shop');
    await expect(row).toContainText('91.50');
  });
});
