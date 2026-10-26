import { expect, type Page } from '@playwright/test';
import { as, gotoNav, login, logout, test } from './helpers';

test.describe.configure({ mode: 'serial' });

/** KRA design for the Forge plant type: [library KPI name, present level, Q1..Q4 targets, weights HOD / SHIFT_INCHARGE / SUPERVISOR]. */
const KRAS: [string, string, string[], string[]][] = [
  ['Production output vs plan', '80', ['85', '88', '90', '92'], ['25', '25', '20']],
  ['Rejection', '5', ['4.5', '4', '3.5', '3'], ['20', '20', '25']],
  ['Energy per ton forged', '900', ['880', '860', '840', '820'], ['15', '15', '15']],
  ['On-time delivery', '90', ['92', '94', '95', '96'], ['15', '15', '15']],
  ['Unsafe conditions reported open', '10', ['8', '6', '4', '2'], ['15', '15', '15']],
  ['Kaizen suggestions implemented', '2', ['3', '4', '5', '6'], ['10', '10', '10']],
];

async function fillRow(page: Page, index: number, present: string, targets: string[], weights: string[]) {
  const row = page.locator('table[aria-label="KRAs"] tbody tr').nth(index);
  await row.getByLabel('Present level').fill(present);
  for (const [i, t] of targets.entries()) await row.getByLabel(`Q${i + 1} target`).fill(t);
  for (const [i, code] of ['HOD', 'SHIFT_INCHARGE', 'SUPERVISOR'].entries()) await row.getByLabel(`Weight ${code}`).fill(weights[i]);
}

test('Corporate HR adds a KPI to the library', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await gotoNav(page, 'KPI library');
    await expect(page.getByRole('cell', { name: 'Production output vs plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Add KPI' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Code').fill('SCRAP_RECOVERY');
    await dlg.getByLabel('Unit').fill('%');
    await dlg.getByLabel('Name').fill('Scrap recovery');
    await dlg.getByLabel('Category').selectOption('C');
    await dlg.getByLabel('Better when').selectOption('HIGHER_BETTER');
    await dlg.getByRole('button', { name: 'Add KPI' }).click();
    await expect(page.getByRole('cell', { name: 'Scrap recovery' })).toBeVisible();
  });
});

test('a KRA template is drafted by one person and approved by another', async ({ page }) => {
  await login(page, 'E0003'); // Corporate HR: author
  await gotoNav(page, 'KRA templates');
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByRole('dialog').getByLabel('Plant type').selectOption({ label: 'Forge shop' });
  await page.getByRole('dialog').getByLabel('Template name').fill('Forge shop KRAs');
  await page.getByRole('dialog').getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: 'Forge shop KRAs · v1' })).toBeVisible();
  await expect(page.getByText('You are the author')).toBeVisible();

  await page.getByRole('button', { name: 'Edit KRAs' }).click();
  for (const [name] of KRAS) {
    await page.getByRole('button', { name: 'From KPI library' }).click();
    await page.getByRole('dialog').locator('li', { hasText: name }).getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.locator('table[aria-label="KRAs"] tbody tr')).toHaveCount(KRAS.length + 1); // + totals row

  for (const [i, [, present, targets, weights]] of KRAS.entries()) await fillRow(page, i, present, targets, weights);

  // Live validation: break one weight, see the specific message, fix it.
  const hod = page.getByLabel('Weight HOD').first();
  await hod.fill('20');
  await expect(page.getByRole('list', { name: 'Errors' })).toContainText('Level HOD weights total 95 (must be exactly 100)');
  await expect(page.getByTestId('weight-total-HOD')).toHaveText('95');
  await hod.fill('25');
  await expect(page.getByRole('list', { name: 'Errors' })).toHaveCount(0);
  await expect(page.getByText('All checks pass.')).toBeVisible();

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved (6 KRAs)')).toBeVisible();
  // The author cannot approve their own draft.
  await expect(page.getByRole('button', { name: 'Approve and activate' })).toHaveCount(0);
  await logout(page);

  await as(page, 'E0004', async () => {
    // A second Corporate HR user: the checker
    await expect(page.getByText('Template to approve · Forge shop KRAs v1')).toBeVisible();
    await page.getByText('Template to approve · Forge shop KRAs v1').click();
    await page.getByRole('button', { name: 'Approve and activate' }).click();
    await expect(page.getByText('Template activated')).toBeVisible();
    await expect(page.getByTestId('state-chip').first()).toHaveText('Active');
  });
});

test('Plant HR adds employees and creates the scorecards', async ({ page }) => {
  await as(page, 'E0101', async () => {
    const people: [string, string, string][] = [
      ['T1001', 'Ravi Kumar', 'Hammer Shop (TRY-HAM)'],
      ['T1002', 'Siva Raj', 'Hammer Shop (TRY-HAM)'],
      ['T1003', 'Mani Vel', 'Hammer Shop (TRY-HAM)'],
      ['T2001', 'Arul Das', 'Press Shop (TRY-PRS)'],
      ['T2002', 'Bala Murugan', 'Press Shop (TRY-PRS)'],
    ];
    await gotoNav(page, 'Employees');
    for (const [code, name, unit] of people) {
      await page.getByRole('button', { name: 'Add employee' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Employee code').fill(code);
      await dlg.getByLabel('Full name').fill(name);
      await dlg.getByLabel('Unit').selectOption({ label: unit });
      await dlg.getByLabel('Designation').fill('Operator');
      await dlg.getByRole('button', { name: 'Add employee' }).click();
      await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
    }
    await page.getByLabel('Search employees').fill('Arul');
    await expect(page.getByRole('row', { name: /Arul Das/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Ravi Kumar/ })).toHaveCount(0);

    await gotoNav(page, 'Scorecards');
    for (const unit of ['Hammer Shop (TRY-HAM)', 'Press Shop (TRY-PRS)']) {
      await page.getByRole('button', { name: 'Create scorecard' }).click();
      await page.getByRole('dialog').getByLabel('Unit').selectOption({ label: unit });
      await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
      await expect(page.getByRole('heading', { name: /Scorecard · FY 2026-27/ })).toBeVisible();
      await gotoNav(page, 'Scorecards');
    }
    await expect(page.getByRole('link', { name: 'Open TRY-HAM' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open TRY-PRS' })).toBeVisible();
  });
});

test('role and scope are respected in navigation and data', async ({ page }) => {
  await as(page, 'E0103', async () => {
    // HOD of the Hammer Shop: sees verification work but no master-data editing or plant bulk actions on other plants.
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Monthly entry' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'KPI library' })).toHaveCount(0); // HOD has no kpi:read
    await expect(nav.getByRole('link', { name: 'KRA templates' })).toHaveCount(0);
    await gotoNav(page, 'Employees');
    await expect(page.getByRole('button', { name: 'Add employee' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Ravi Kumar' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Arul Das' })).toHaveCount(0); // Press Shop is outside this HOD's scope
  });
  await as(page, 'E0105', async () => {
    // Employee: only their own results, none of the unit screens.
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'My results' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Monthly entry' })).toHaveCount(0);
    await gotoNav(page, 'My results');
    await expect(page.getByText('No results yet')).toBeVisible();
    await page.goto('/submissions');
    await expect(page.getByText('Not available for your role')).toBeVisible();
  });
});
