import { expect, type Page } from '@playwright/test';
import { as, gotoNav, PERIOD, stateOf, test } from './helpers';

test.describe.configure({ mode: 'serial' });

const HAM = { 'Production output vs plan': '90', Rejection: '3.5', 'Energy per ton forged': '850', 'On-time delivery': '95', 'Unsafe conditions reported open': '4', 'Kaizen suggestions implemented': '10' };
const PRS = { 'Production output vs plan': '86', Rejection: '4.2', 'Energy per ton forged': '880', 'On-time delivery': '93', 'Unsafe conditions reported open': '6', 'Kaizen suggestions implemented': '4' };

const sub: { ham?: string; prs?: string; hamHodScore?: number } = {};
const idFromUrl = (page: Page) => page.url().split('/').pop()!;
const result = (page: Page, kra: string) => page.getByLabel(`Result for ${kra}`, { exact: true });
const rowIssue = (page: Page, kra: string) => page.getByTestId(`row-${kra}`).getByTestId('row-issue');

async function startMonth(page: Page, unit: string) {
  await gotoNav(page, 'Monthly entry');
  await page.getByLabel('Month', { exact: true }).first().fill(PERIOD);
  await page.getByRole('button', { name: 'Start a month' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Month', { exact: true }).fill(PERIOD);
  await dlg.getByLabel('Unit').selectOption({ label: unit });
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: `${unit} · Sep 2026` })).toBeVisible();
  await expect(stateOf(page)).toHaveText('Draft');
}

async function fillResults(page: Page, values: Record<string, string>) {
  for (const [kra, v] of Object.entries(values)) await result(page, kra).fill(v);
}

async function placePeople(page: Page, people: [string, string][]) {
  for (const [name, level] of people) {
    await page.getByLabel(`Include ${name}`).check();
    await page.getByLabel(`Level for ${name}`).selectOption(level);
  }
  await page.getByRole('button', { name: 'Save people' }).click();
  await expect(page.getByText('People saved')).toBeVisible();
}

test('Plant HR enters the Hammer Shop month; the form explains every problem', async ({ page }) => {
  await as(page, 'E0101', async () => {
    await startMonth(page, 'TRY-HAM');
    sub.ham = idFromUrl(page);

    // Range and unit checks, specific to the row.
    await result(page, 'Production output vs plan').fill('150');
    await result(page, 'Unsafe conditions reported open').fill('2.5');
    await expect(rowIssue(page, 'Production output vs plan')).toHaveText('A percentage must be between 0 and 100');
    await expect(rowIssue(page, 'Unsafe conditions reported open')).toHaveText('A count must be a whole number, zero or more');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Fix 2 highlighted rows before saving');

    // Valid values, but one result is an outlier with no comment, and one KRA is left blank.
    await fillResults(page, HAM);
    await result(page, 'Rejection').fill('');
    await expect(rowIssue(page, 'Kaizen suggestions implemented')).toHaveText('Outlier: add a comment explaining this result');
    await placePeople(page, [['Ravi Kumar', 'HOD'], ['Siva Raj', 'SHIFT_INCHARGE'], ['Mani Vel', 'SUPERVISOR']]);
    await expect(result(page, 'Production output vs plan')).toHaveValue('90'); // saving people kept the unsaved results

    await page.getByRole('button', { name: 'Submit for verification' }).click();
    const blocked = page.getByRole('alert').filter({ hasText: 'Cannot submit yet' });
    await expect(blocked).toContainText('"Rejection" needs a result or an N/A reason');
    await expect(blocked).toContainText('"Kaizen suggestions implemented" is an outlier and needs a comment');
    await expect(stateOf(page)).toHaveText('Draft');

    // Fix both and submit.
    await result(page, 'Rejection').fill('3.5');
    await page.getByLabel('Comment for Kaizen suggestions implemented').fill('Kaizen drive in September');
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(stateOf(page)).toHaveText('Submitted');
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0); // the person who entered it cannot verify it
    await expect(page.getByTestId('level-HOD')).toContainText(/\d/);
  });
});

test('Plant HR enters the Press Shop month', async ({ page }) => {
  await as(page, 'E0101', async () => {
    await startMonth(page, 'TRY-PRS');
    sub.prs = idFromUrl(page);
    await fillResults(page, PRS);
    await placePeople(page, [['Arul Das', 'HOD'], ['Bala Murugan', 'SUPERVISOR']]);
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(stateOf(page)).toHaveText('Submitted');
  });
});

test('each HOD verifies only their own department', async ({ page }) => {
  await as(page, 'E0103', async () => {
    await expect(page.getByTestId('waiting-list')).toContainText('TRY-HAM · Sep 2026');
    await page.getByTestId('waiting-list').getByText('TRY-HAM · Sep 2026').click();
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(stateOf(page)).toHaveText('Verified');
    // The other department is outside this HOD's scope: the API answers as if it did not exist.
    await page.goto(`/submissions/${sub.prs}`);
    await expect(page.getByText('not found, or it is outside your scope')).toBeVisible();
  });
  await as(page, 'E0104', async () => {
    await page.goto(`/submissions/${sub.prs}`);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(stateOf(page)).toHaveText('Verified');
  });
});

test('dashboards are empty before anything is locked', async ({ page }) => {
  await as(page, 'E0002', async () => {
    await gotoNav(page, 'Management');
    await page.getByLabel('Month', { exact: true }).fill(PERIOD);
    await expect(page.getByTestId('mgmt-row-TRY')).toContainText('0 of 2');
    await expect(page.getByText('Nothing locked for this month yet').first()).toBeVisible();
    await gotoNav(page, 'Unit trend');
    await page.getByLabel('Unit', { exact: true }).selectOption({ label: 'TRY-HAM' });
    await expect(page.getByText('No locked months yet')).toBeVisible();
  });
});

test('the Plant Head approves the whole plant month at once', async ({ page }) => {
  await as(page, 'E0102', async () => {
    await gotoNav(page, 'Plant status');
    await page.getByLabel('Month', { exact: true }).fill(PERIOD);
    await expect(page.getByTestId('board-TRY-HAM')).toContainText('Verified');
    await expect(page.getByTestId('board-TRY-PRS')).toContainText('Verified');
    await expect(page.getByRole('button', { name: 'Lock all' })).toHaveCount(0); // locking is not this role's job
    await page.getByRole('button', { name: 'Approve all' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve 2 units' }).click();
    await expect(page.getByText('Approved 2 units')).toBeVisible();
    await expect(page.getByTestId('board-TRY-HAM')).toContainText('Approved');
    await expect(page.getByTestId('board-TRY-PRS')).toContainText('Approved');
  });
});

test('Corporate HR locks the plant month and the scores become official', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await gotoNav(page, 'Plant status');
    await page.getByLabel('Plant').selectOption({ label: 'Trichy (Forge)' });
    await page.getByLabel('Month', { exact: true }).fill(PERIOD);
    await page.getByRole('button', { name: 'Lock all' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Lock 2 units' }).click();
    await expect(page.getByText('Locked 2 units')).toBeVisible();
    await expect(page.getByTestId('board-TRY-HAM')).toContainText('Locked');
    await expect(page.getByTestId('board-TRY-HAM')).toContainText(/\d+\.\d\d/); // official level scores now on the board

    await page.getByRole('link', { name: 'Open TRY-HAM' }).click();
    await expect(stateOf(page)).toHaveText('Locked');
    await expect(page.getByText('Official', { exact: true })).toBeVisible();
    sub.hamHodScore = parseFloat((await page.getByTestId('level-HOD').innerText()).match(/[\d.]+/g)!.pop()!);
    expect(sub.hamHodScore).toBeGreaterThan(0);
    // Locked results are read-only.
    await expect(result(page, 'Rejection')).toHaveCount(0);
  });
});

test('dashboards update once the month is locked', async ({ page }) => {
  await as(page, 'E0002', async () => {
    await gotoNav(page, 'Management');
    await page.getByLabel('Month', { exact: true }).fill(PERIOD);
    const trichy = page.getByTestId('mgmt-row-TRY');
    await expect(trichy).toContainText('2 of 2');
    await expect(trichy).toContainText(/\d+\.\d\d/);

    await gotoNav(page, 'Unit trend');
    await page.getByLabel('Unit', { exact: true }).selectOption({ label: 'TRY-HAM' });
    const hod = page.getByTestId('rollup-HOD');
    await expect(hod).toBeVisible();
    const q2 = parseFloat(await hod.locator('td').nth(2).innerText());
    expect(Math.abs(q2 - sub.hamHodScore!)).toBeLessThan(0.011); // Q2 holds only September, so it equals the monthly score
    await expect(hod.locator('td').nth(5)).toContainText(/\d/); // year roll-up
  });
});

test('a reopened month drops out of the dashboards until it is locked again', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await page.goto(`/submissions/${sub.ham}`);
    await page.getByRole('button', { name: 'Request reopen' }).click();
    await page.getByLabel('Why does this month need to change?').fill('Energy reading was entered from the wrong meter');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Reopen requested')).toBeVisible();
  });
  await as(page, 'E0004', async () => {
    await expect(page.getByTestId('waiting-list')).toContainText('Reopen request · TRY-HAM');
    await gotoNav(page, 'Reopen requests');
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Month reopened')).toBeVisible();
  });
  await as(page, 'E0002', async () => {
    await gotoNav(page, 'Management');
    await page.getByLabel('Month', { exact: true }).fill(PERIOD);
    await expect(page.getByTestId('mgmt-row-TRY')).toContainText('1 of 2');
    await gotoNav(page, 'Unit trend');
    await page.getByLabel('Unit', { exact: true }).selectOption({ label: 'TRY-HAM' });
    await expect(page.getByText('No locked months yet')).toBeVisible();
  });
  await as(page, 'E0101', async () => {
    await page.goto(`/submissions/${sub.ham}`);
    await expect(stateOf(page)).toHaveText('Reopened');
    await expect(page.getByText('This month was reopened')).toBeVisible();
    await expect(result(page, 'Rejection')).toBeEditable();
  });
});
