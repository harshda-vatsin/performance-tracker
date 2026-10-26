import { expect, type Page } from '@playwright/test';
import { as, gotoNav, openUnit, test } from './helpers';

test.describe.configure({ mode: 'serial' });

const KRA = 'Production output vs plan';

async function openScorecard(page: Page, unit: string) {
  await gotoNav(page, 'Scorecards');
  await openUnit(page, unit);
  await expect(page.getByRole('heading', { name: /Scorecard · FY 2026-27/ })).toBeVisible();
}

async function propose(page: Page, month: string, reason: string, targets: string[]) {
  await page.getByRole('button', { name: 'Propose adjustment' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Effective from').selectOption({ label: month });
  await dlg.getByLabel('Reason').fill(reason);
  await dlg.getByLabel(`Change ${KRA}`).check();
  for (const [i, t] of targets.entries()) await dlg.getByLabel(`${KRA} Q${i + 1} target`).fill(t);
  return dlg;
}

test('Plant HR proposes new targets, with the wrong-side check shown as they type', async ({ page }) => {
  await as(page, 'E0101', async () => {
    await openScorecard(page, 'TRY-HAM');
    const dlg = await propose(page, 'Oct 2026', 'Order book is up; raise output targets for the second half', ['70', '89', '91', '93']);
    await expect(dlg.getByRole('alert')).toContainText('A target would be on the wrong side of present level 80 (higher is better)');
    await expect(dlg.getByRole('button', { name: 'Submit proposal' })).toBeDisabled();
    await dlg.getByLabel(`${KRA} Q1 target`).fill('88');
    await dlg.getByRole('button', { name: 'Submit proposal' }).click();
    await expect(page.getByText('Adjustment proposed')).toBeVisible();
    const cr = page.getByTestId('change-request').first();
    await expect(cr).toContainText('Pending');
    await expect(cr).toContainText('From Oct 2026');
    await expect(cr).toContainText('88/89/91/93');
    // A proposer cannot be the one to approve it: no decision buttons for Plant HR.
    await expect(cr.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });
});

test('a different person approves, which creates a new scorecard version', async ({ page }) => {
  await as(page, 'E0102', async () => {
    await openScorecard(page, 'TRY-HAM');
    await expect(page.getByText('Version 1')).toBeVisible();
    await page.getByTestId('change-request').first().getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByLabel('Comment (optional)').fill('Agreed with plant planning');
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved: new scorecard version created')).toBeVisible();
    await expect(page.getByText('Version 2')).toBeVisible();
    await expect(page.getByTestId('change-request').first()).toContainText('Approved');
    const row = page.getByRole('row', { name: new RegExp(KRA) });
    await expect(row).toContainText('88');
  });
});

test('the author of a change cannot approve their own proposal', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await openScorecard(page, 'TRY-PRS');
    await propose(page, 'Nov 2026', 'Press shop capacity expansion', ['86', '90', '92', '94']).then((d) => d.getByRole('button', { name: 'Submit proposal' }).click());
    await expect(page.getByText('Adjustment proposed')).toBeVisible();
    const cr = page.getByTestId('change-request').first();
    await cr.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('the author of a scorecard change cannot approve it');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  });
});

test('months that already have data cannot be adjusted', async ({ page }) => {
  await as(page, 'E0101', async () => {
    await openScorecard(page, 'TRY-PRS');
    const dlg = await propose(page, 'Sep 2026', 'Too late', ['86', '90', '92', '94']);
    await dlg.getByRole('button', { name: 'Submit proposal' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Months from the effective month already have data: 2026-09');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
  });
});
