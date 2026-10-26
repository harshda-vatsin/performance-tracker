import { expect, type Page } from '@playwright/test';
import { as, gotoNav, stateOf, test } from './helpers';

test.describe.configure({ mode: 'serial' });

/**
 * One senior employee's whole FY 2026-27 cycle, clicked through in the browser, one person at a time:
 *   HR starts the goal sheet and sets goals -> issues -> employee acknowledges -> manager enters and confirms a month
 *   -> HR opens the year-end appraisal -> employee self-assesses -> manager assesses -> reviewer signs off -> HR finalises.
 * Employee E0105 has no cycle in the seed, so the spec creates it. Manager E0103 (HOD), reviewer E0102 (Plant Head), HR E0003.
 */
const ROW = 'senior-E0105-2026';
const OPEN = { name: 'Open goal sheet for E0105 2026' };

/** From a list screen, open the cycle's goal sheet. */
async function openCycle(page: Page, nav: string): Promise<void> {
  await gotoNav(page, nav);
  await page.getByRole('link', { name: OPEN.name }).click();
  await expect(page.getByRole('heading', { name: /Dinesh M .* · FY 2026-27/ })).toBeVisible();
}

test('Corporate HR starts a goal sheet and sets the KRA and KPI, then issues it', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await gotoNav(page, 'Appraisal board');
    await page.getByRole('button', { name: 'New goal sheet' }).click();
    const dlg = page.getByRole('dialog', { name: 'Start a goal sheet' });
    await dlg.getByLabel('Employee').selectOption({ label: 'Dinesh M (Shift Incharge) (E0105)' });
    await dlg.getByLabel('Fiscal year').fill('2026');
    await dlg.getByLabel('Manager').selectOption({ label: 'Senthil K (HOD, Hammer Shop) (E0103)' });
    await dlg.getByLabel('Reviewer').selectOption({ label: 'Murugan S (Plant Head, Trichy) (E0102)' });
    await dlg.getByRole('button', { name: 'Start goal sheet' }).click();
    await expect(page.getByRole('heading', { name: /Dinesh M .* · FY 2026-27/ })).toBeVisible();
    await expect(stateOf(page)).toHaveText('Goals being drafted');

    // Weights that do not total 100 cannot be issued, and the screen says why.
    await page.getByLabel('KRA name').fill('Delivery');
    await page.getByLabel('KRA weight').fill('60');
    await page.getByLabel('KPI name').fill('On-time delivery');
    await page.getByLabel('Present level').fill('90');
    for (const [i, t] of ['92', '94', '96', '98'].entries()) await page.getByLabel(`Q${i + 1} target`).fill(t);
    await page.getByLabel('KPI weight').fill('100');
    await page.getByRole('button', { name: 'Save goal sheet' }).click();
    await expect(page.getByText('Goal sheet saved')).toBeVisible();
    await expect(page.getByText('KRA weights total 60 (must be exactly 100).')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Issue goal sheet' })).toBeDisabled();

    await page.getByLabel('KRA weight').fill('100');
    await page.getByRole('button', { name: 'Save goal sheet' }).click();
    await expect(page.getByText('KRA weights total 100 / 100')).toBeVisible();
    await page.getByRole('button', { name: 'Issue goal sheet' }).click();
    await expect(stateOf(page)).toHaveText('Awaiting acknowledgement');
    // Frozen from issue: the editor is gone and the sheet is a read-only table.
    await expect(page.getByRole('button', { name: 'Save goal sheet' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Goal sheet' })).toContainText('On-time delivery');
  });
});

test('the employee acknowledges the goal sheet', async ({ page }) => {
  await as(page, 'E0105', async () => {
    await gotoNav(page, 'My goals');
    await expect(page.getByTestId(ROW)).toContainText('Your goal sheet is ready for you to acknowledge.');
    await page.getByRole('link', { name: OPEN.name }).click();
    await expect(page.getByRole('table', { name: 'Goal sheet' })).toContainText('On-time delivery');
    await page.getByRole('button', { name: 'Acknowledge goal sheet' }).click();
    await expect(stateOf(page)).toHaveText('In progress');
    await expect(page.getByText(/Acknowledged \d/)).toBeVisible();
  });
});

test('the manager enters and confirms April, which is scored and locked', async ({ page }) => {
  await as(page, 'E0103', async () => {
    await openCycle(page, 'Team goals');
    await page.getByLabel('Result for On-time delivery').fill('92'); // the Q1 target: scores 100
    await page.getByRole('button', { name: 'Save month draft' }).click();
    await expect(page.getByText('Apr 2026 saved as a draft')).toBeVisible();
    await expect(page.getByTestId('month-total')).toHaveText('100.00');
    await page.getByRole('button', { name: 'Save and confirm month' }).click();
    await expect(page.getByText('Apr 2026 confirmed and locked')).toBeVisible();
    await expect(page.getByTestId('senior-score')).toHaveText('100.00');
    await expect(page.getByRole('button', { name: 'Apr 2026, confirmed' })).toBeVisible();
    // A confirmed month is read-only.
    await expect(page.getByLabel('Result for On-time delivery')).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Roll-up' })).toContainText('100.00');
  });
});

test('the employee cannot enter results; Corporate HR opens the year-end appraisal', async ({ page }) => {
  await as(page, 'E0105', async () => {
    await openCycle(page, 'My goals');
    await expect(page.getByLabel('Result for On-time delivery')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save and confirm month' })).toHaveCount(0);
  });
  await as(page, 'E0003', async () => {
    await openCycle(page, 'Appraisal board');
    await page.getByRole('button', { name: 'Open year-end appraisal' }).click();
    await expect(stateOf(page)).toHaveText('Self-assessment');
  });
});

test('the employee writes and submits the self-assessment', async ({ page }) => {
  await as(page, 'E0105', async () => {
    await openCycle(page, 'My goals');
    await page.getByRole('button', { name: 'Submit self-assessment' }).click();
    await expect(page.getByRole('alert')).toContainText('write the assessment summary before submitting');
    await page.getByLabel('Overall summary of the year').fill('Delivered on time every month and cleared the Q1 backlog.');
    await page.getByRole('button', { name: 'Save assessment draft' }).click();
    await expect(page.getByText('Assessment draft saved')).toBeVisible();
    await page.getByRole('button', { name: 'Submit self-assessment' }).click();
    await expect(stateOf(page)).toHaveText('Manager assessment');
    await expect(page.getByRole('button', { name: 'Save assessment draft' })).toHaveCount(0); // locked once submitted
  });
});

test('the manager sends it back with a comment, then submits their own assessment', async ({ page }) => {
  await as(page, 'E0103', async () => {
    await openCycle(page, 'Team goals');
    await expect(page.getByTestId('assessment-SELF')).toContainText('cleared the Q1 backlog');
    // Send back needs a comment.
    await expect(page.getByRole('button', { name: 'Send back' })).toBeDisabled();
    await page.getByLabel('Comment').fill('Please add the number of orders in the backlog.');
    await page.getByRole('button', { name: 'Send back' }).click();
    await expect(stateOf(page)).toHaveText('Self-assessment');
  });
  await as(page, 'E0105', async () => {
    await openCycle(page, 'My goals');
    await expect(page.getByRole('list', { name: 'History' })).toContainText('Please add the number of orders in the backlog.'); // addressed to the employee
    await page.getByLabel('Overall summary of the year').fill('Delivered on time every month and cleared a Q1 backlog of 140 orders.');
    await page.getByRole('button', { name: 'Save assessment draft' }).click();
    await expect(page.getByText('Assessment draft saved')).toBeVisible();
    await page.getByRole('button', { name: 'Submit self-assessment' }).click();
    await expect(stateOf(page)).toHaveText('Manager assessment');
  });
  await as(page, 'E0103', async () => {
    await openCycle(page, 'Team goals');
    await page.getByLabel('Overall summary of the year').fill('Reliable delivery all year. Ready for a wider scope.');
    await page.getByRole('button', { name: 'Save assessment draft' }).click();
    await expect(page.getByText('Assessment draft saved')).toBeVisible();
    await page.getByRole('button', { name: 'Submit to reviewer' }).click();
    await expect(stateOf(page)).toHaveText('With reviewer');
    // The month is frozen once the manager has submitted.
    await expect(page.getByRole('button', { name: 'Save and confirm month' })).toHaveCount(0);
  });
});

test('the manager assessment stays private from the employee until the appraisal is finalised', async ({ page }) => {
  await as(page, 'E0105', async () => {
    await openCycle(page, 'My goals');
    await expect(stateOf(page)).toHaveText('With reviewer');
    await expect(page.getByTestId('assessment-MANAGER')).toHaveCount(0);
  });
});

test('the reviewer signs off from the review queue', async ({ page }) => {
  await as(page, 'E0102', async () => {
    await gotoNav(page, 'Review queue');
    await expect(page.getByRole('table', { name: 'Awaiting your sign-off' })).toContainText('Dinesh M');
    await page.getByRole('link', { name: OPEN.name }).click();
    await expect(page.getByTestId('assessment-MANAGER')).toContainText('Ready for a wider scope');
    await page.getByRole('button', { name: 'Sign off' }).click();
    await expect(stateOf(page)).toHaveText('With Corporate HR');
    // Signed off: the reviewer has nothing more to do on it.
    await expect(page.getByRole('button', { name: 'Sign off' })).toHaveCount(0);
  });
});

test('Corporate HR finalises: the score maps to a rating band and everything is locked', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await openCycle(page, 'Appraisal board');
    await page.getByRole('button', { name: 'Finalise and lock' }).click();
    await expect(page.getByText('This locks the appraisal permanently.')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, finalise' }).click();
    await expect(stateOf(page)).toHaveText('Finalised');
    await expect(page.getByTestId('final-rating')).toContainText('Exceeds expectations');
    await expect(page.getByTestId('final-rating')).toContainText('100.00');
    await expect(page.getByText('Finalised and locked.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What you can do now' })).toHaveCount(0); // no action is left
    await expect(page.getByRole('list', { name: 'History' })).toContainText('Corporate HR');
  });
});

test('after finalisation the board and the employee both show the final result', async ({ page }) => {
  await as(page, 'E0003', async () => {
    await gotoNav(page, 'Appraisal board');
    await expect(page.getByTestId(ROW)).toContainText('Finalised');
    await expect(page.getByTestId(ROW)).toContainText('Exceeds expectations');
    await page.getByRole('button', { name: /^Finalised/ }).click(); // the status filter
    await expect(page.getByTestId(ROW)).toBeVisible();
  });
  await as(page, 'E0105', async () => {
    await openCycle(page, 'My goals');
    await expect(page.getByTestId('assessment-MANAGER')).toContainText('Ready for a wider scope'); // now visible
    await expect(page.getByTestId('final-rating')).toContainText('Exceeds expectations');
    await expect(page.getByRole('button', { name: 'Submit self-assessment' })).toHaveCount(0);
  });
});
