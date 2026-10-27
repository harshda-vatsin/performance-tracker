import { expect, type Page } from '@playwright/test';
import { as, gotoNav, LAST_LOCKED, OPEN_MONTH, test } from './helpers';

test.describe.configure({ mode: 'serial' });

/**
 * docs/DEMO-SCRIPT.md, step for step, in the browser, against the simplified demo data in mmf_demo (apps/api/src/seed-demo.ts).
 * It runs on the default settings: Plant HR submits and Corporate HR locks, with no HOD verify or Plant Head approval, and
 * the senior appraisal goes self -> manager -> Corporate HR with no reviewer.
 */
const stateOf = (page: Page) => page.getByTestId('state-chip').first();
const result = (page: Page, kra: string) => page.getByLabel(`Result for ${kra}`, { exact: true });
const OPEN_SENIOR = { name: 'Open goal sheet for senior 2026' };

// October for Plant A, continuing its improving trend.
const OCTOBER = {
  'Production output vs plan': '95.8',
  Rejection: '2.4',
  'Energy per ton forged': '390.5',
  'On-time delivery': '94.9',
  'Unsafe conditions open': '1',
  'Kaizen suggestions implemented': '6',
};

test('1. md opens the management dashboard: three plants, three different trends', async ({ page }) => {
  await as(page, 'md', async () => {
    await gotoNav(page, 'Management');
    await page.getByLabel('Month', { exact: true }).fill(LAST_LOCKED);
    for (const plant of ['PLANT-A', 'PLANT-B', 'PLANT-C']) {
      const row = page.getByTestId(`mgmt-row-${plant}`);
      await expect(row).toContainText('1 of 1');
      await expect(row).toContainText(/\d+\.\d\d/);
    }
  });
});

test('2. planthr enters October for Plant A and submits it', async ({ page }) => {
  await as(page, 'planthr', async () => {
    await gotoNav(page, 'Monthly entry');
    await page.getByLabel('Month', { exact: true }).first().fill(OPEN_MONTH);
    await page.getByRole('link', { name: 'Open PLANT-A' }).click();
    await expect(page.getByRole('heading', { name: 'PLANT-A · Oct 2026' })).toBeVisible();
    await expect(stateOf(page)).toHaveText('Draft');
    for (const [kra, value] of Object.entries(OCTOBER)) await result(page, kra).fill(value);
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(stateOf(page)).toHaveText('Submitted');
    // No HOD or Plant Head step is in the way, and Plant HR cannot lock what they entered.
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Lock' })).toHaveCount(0);
  });
});

test('3. hr locks the month, and the scores become official', async ({ page }) => {
  await as(page, 'hr', async () => {
    await gotoNav(page, 'Plant status');
    await page.getByLabel('Plant').selectOption({ label: 'Plant A' });
    await page.getByLabel('Month', { exact: true }).fill(OPEN_MONTH);
    await expect(page.getByTestId('board-PLANT-A')).toContainText('Submitted');
    await expect(page.getByRole('button', { name: 'Approve all' })).toHaveCount(0); // the Plant Head step is off
    await page.getByRole('button', { name: 'Lock all' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Lock 1 unit' }).click();
    await expect(page.getByText('Locked 1 unit')).toBeVisible();
    await expect(page.getByTestId('board-PLANT-A')).toContainText('Locked');
    await expect(page.getByTestId('board-PLANT-A')).toContainText(/\d+\.\d\d/);
  });
});

test('4. md sees October appear on the dashboard', async ({ page }) => {
  await as(page, 'md', async () => {
    await gotoNav(page, 'Management');
    await page.getByLabel('Month', { exact: true }).fill(OPEN_MONTH);
    const row = page.getByTestId('mgmt-row-PLANT-A');
    await expect(row).toContainText('1 of 1');
    await expect(row).toContainText(/\d+\.\d\d/);
    await expect(page.getByTestId('mgmt-row-PLANT-B')).toContainText('0 of 1'); // October is only open at Plant A
  });
});

test('5. employee sees their own results and bonus', async ({ page }) => {
  await as(page, 'employee', async () => {
    await gotoNav(page, 'My results');
    const results = page.getByRole('table', { name: 'My results' });
    await expect(results).toContainText('Oct 2026');
    await expect(results).toContainText('Sep 2026');
    await expect(results).toContainText('Supervisor');
    const bonus = page.getByRole('table', { name: 'My bonus' });
    await expect(bonus).toContainText('Sep 2026');
    await expect(bonus).toContainText('₹');
    await expect(page.getByTestId('bonus-total')).toContainText('₹');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Bonus' })).toHaveCount(0); // own statement only
  });
});

test('6. senior reads the goals and submits the self-assessment', async ({ page }) => {
  await as(page, 'senior', async () => {
    await gotoNav(page, 'My goals');
    await page.getByRole('link', { name: OPEN_SENIOR.name }).click();
    await expect(page.getByRole('heading', { name: /Sanjay Patil · FY 2026-27/ })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Goal sheet' })).toContainText('Customer complaints');
    await expect(page.getByRole('table', { name: 'Roll-up' })).toBeVisible();
    await page.getByLabel('Overall summary of the year').fill('Met most of my targets. Delivery was steady; I want to start earlier on tooling issues.');
    await page.getByRole('button', { name: 'Save assessment draft' }).click();
    await page.getByRole('button', { name: 'Submit self-assessment' }).click();
    await expect(page.getByRole('button', { name: 'Save assessment draft' })).toHaveCount(0); // locked once submitted
  });
});

test('7. manager assesses, then hr finalises: no reviewer in between', async ({ page }) => {
  await as(page, 'manager', async () => {
    await gotoNav(page, 'Team goals');
    await page.getByRole('link', { name: OPEN_SENIOR.name }).click();
    await expect(page.getByTestId('assessment-SELF')).toContainText('tooling issues');
    await page.getByLabel('Overall summary of the year').fill('Reliable all year and well regarded by other teams. Ready for a wider scope.');
    await page.getByRole('button', { name: 'Save assessment draft' }).click();
    await page.getByRole('button', { name: 'Submit to Corporate HR' }).click();
    await expect(page.getByRole('button', { name: 'Save assessment draft' })).toHaveCount(0);
  });
  await as(page, 'hr', async () => {
    await gotoNav(page, 'Appraisal board');
    await page.getByRole('link', { name: OPEN_SENIOR.name }).click();
    await expect(page.getByTestId('assessment-MANAGER')).toContainText('Ready for a wider scope');
    await page.getByRole('button', { name: 'Finalise and lock' }).click();
    await page.getByRole('button', { name: 'Yes, finalise' }).click();
    await expect(page.getByTestId('final-rating')).toBeVisible();
    await expect(page.getByTestId('final-rating')).toContainText(/\d+\.\d\d/);
  });
});

test('8. hr runs the October bonus, and a different person, hrhead, approves it', async ({ page }) => {
  await as(page, 'hr', async () => {
    await gotoNav(page, 'Bonus');
    await page.getByLabel('Month', { exact: true }).fill(OPEN_MONTH);
    await page.getByRole('button', { name: 'Calculate bonus' }).click();
    // Only Plant A is locked for October; the other plants are reported, not paid.
    await expect(page.getByText(/Not calculated: .*PLANT-B/)).toBeVisible();
    const batch = page.getByTestId('bonus-batch');
    await expect(batch).toHaveCount(1);
    await expect(batch).toContainText('Plant A');
    await expect(batch).toContainText('Calculated');
    await page.getByRole('button', { name: 'Open Plant A bonus' }).click();
    await expect(page.getByRole('table', { name: 'Bonus lines' })).toContainText('Asha Menon');
    await expect(page.getByText('You calculated this batch, so a different Corporate HR user has to approve it.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and lock' })).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  });
  await as(page, 'hrhead', async () => {
    await gotoNav(page, 'Bonus');
    await page.getByLabel('Month', { exact: true }).fill(OPEN_MONTH);
    await page.getByRole('button', { name: 'Open Plant A bonus' }).click();
    await page.getByRole('button', { name: 'Approve and lock' }).click();
    await expect(page.getByText('Approved and locked')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('bonus-batch')).toContainText('Locked');
    await expect(page.getByRole('link', { name: 'CSV' })).toBeVisible();
  });
  await as(page, 'employee', async () => {
    await gotoNav(page, 'My results');
    await expect(page.getByRole('table', { name: 'My bonus' })).toContainText('Oct 2026');
  });
});

test('9. admin sees the audit log, and no scores or pay', async ({ page }) => {
  await as(page, 'admin', async () => {
    await gotoNav(page, 'Audit log');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByText('LOGIN_OK').first()).toBeVisible();
    await expect(page.getByText(/chain.*intact|intact/i).first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    for (const hidden of ['Bonus', 'Management', 'Monthly entry']) await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
    expect((await page.request.get('/api/bonus/batches')).status()).toBe(403);
    expect((await page.request.get('/api/bonus/export?period=2026-09')).status()).toBe(403);
  });
});
