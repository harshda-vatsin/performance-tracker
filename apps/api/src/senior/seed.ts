/**
 * Dev-only sample data for the senior-staff track: three senior employees at different points of the year-end
 * appraisal. Everything goes through the real service functions, so the sample data obeys the same rules, scoring
 * and audit trail as real use. Idempotent: does nothing once any senior cycle exists.
 */
import type pg from 'pg';
import { loadAssignments } from '../rbac/policy.js';
import { quarterOf } from '../fiscal.js';
import { fiscalMonths } from '../scoring/rollup.js';
import { confirmMonth, createCycle, getDetail, replaceGoals, saveAssessment, saveResults, transition, type Ctx, type GoalsInput, type ResultItem } from './service.js';

type K = GoalsInput['kras'][number]['kpis'][number];
const kpi = (name: string, unit: string, direction: K['direction'], presentLevel: number, targets: number[], weight: number): K => ({ name, unit, direction, presentLevel, targets, weight });

const PRIYA: GoalsInput = {
  kras: [
    {
      name: 'Production and quality',
      weight: 60,
      kpis: [kpi('Production output vs plan', '%', 'HIGHER_BETTER', 88, [90, 92, 94, 96], 50), kpi('Rejection', '%', 'LOWER_BETTER', 3.2, [3.0, 2.8, 2.6, 2.4], 50)],
    },
    {
      name: 'Cost and safety',
      weight: 40,
      kpis: [kpi('Energy per ton forged', 'kWh/t', 'LOWER_BETTER', 410, [405, 400, 395, 390], 60), kpi('Unsafe conditions open', 'count', 'LOWER_BETTER', 5, [4, 3, 2, 1], 40)],
    },
  ],
};

const ANAND: GoalsInput = {
  kras: [
    {
      name: 'Customer quality',
      weight: 70,
      kpis: [kpi('Customer complaints', 'count', 'LOWER_BETTER', 6, [5, 4, 3, 2], 50), kpi('On-time delivery', '%', 'HIGHER_BETTER', 91, [92, 93, 94, 95], 50)],
    },
    { name: 'Process improvement', weight: 30, kpis: [kpi('Kaizen suggestions implemented', 'count', 'HIGHER_BETTER', 2, [3, 4, 5, 6], 100)] },
  ],
};

const SANGEETHA: GoalsInput = {
  kras: [
    { name: 'Delivery', weight: 50, kpis: [kpi('On-time delivery', '%', 'HIGHER_BETTER', 90, [91, 92, 93, 94], 100)] },
    {
      name: 'Productivity',
      weight: 50,
      kpis: [kpi('Production output vs plan', '%', 'HIGHER_BETTER', 85, [87, 89, 91, 93], 60), kpi('Rejection', '%', 'LOWER_BETTER', 2.9, [2.8, 2.7, 2.6, 2.5], 40)],
    },
  ],
};

interface Spec {
  employee: string;
  manager: string;
  reviewer: string;
  fiscalYear: number;
  goals: GoalsInput;
  /** How far the cycle is driven. */
  through: 'GOALS_DRAFT' | 'PENDING_ACK' | 'ACKNOWLEDGED' | 'REVIEWER_REVIEW' | 'FINALISED';
  confirmedMonths: number;
  /** Leave the next month partly entered, as a manager would mid-month. */
  draftMonth?: boolean;
}

const HR = 'E0003';
const SPECS: Spec[] = [
  // Managers are HODs. Reviewers are the per-appraisal assignments: the Plant Head (E0102) or Management (E0002).
  // In progress this year (its FY 2026 appraisal, reviewed by E0102, already exists): six months confirmed, October half entered.
  { employee: 'E0107', manager: 'E0103', reviewer: 'E0102', fiscalYear: 2026, goals: PRIYA, through: 'ACKNOWLEDGED', confirmedMonths: 6, draftMonth: true },
  // Last year's appraisal waiting in the reviewer's queue; this year's sheet still being drafted.
  { employee: 'E0108', manager: 'E0104', reviewer: 'E0102', fiscalYear: 2025, goals: ANAND, through: 'REVIEWER_REVIEW', confirmedMonths: 12 },
  { employee: 'E0108', manager: 'E0104', reviewer: 'E0102', fiscalYear: 2026, goals: ANAND, through: 'GOALS_DRAFT', confirmedMonths: 0 },
  // Last year finalised and locked; this year's sheet (appraisal reviewed by E0002) issued and waiting for acknowledgement.
  { employee: 'E0302', manager: 'E0303', reviewer: 'E0002', fiscalYear: 2025, goals: SANGEETHA, through: 'FINALISED', confirmedMonths: 12 },
  { employee: 'E0302', manager: 'E0303', reviewer: 'E0002', fiscalYear: 2026, goals: SANGEETHA, through: 'PENDING_ACK', confirmedMonths: 0 },
];

/** Deterministic, varied monthly results: between 70% and 130% of the way from present level to target. */
function sampleResult(k: { unit: string; presentLevel: number; targets: number[] }, period: string, monthIndex: number, kpiIndex: number): number {
  const target = k.targets[quarterOf(period) - 1];
  const factor = 0.7 + ((monthIndex * 4 + kpiIndex * 3) % 7) * 0.1;
  const value = k.presentLevel + (target - k.presentLevel) * factor;
  if (k.unit === 'count') return Math.max(0, Math.round(value));
  if (k.unit === '%') return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
  return Math.round(value * 100) / 100;
}

/**
 * The sample cycles below are built with reviewers, so the reviewer step is switched on while they are created and put back
 * afterwards: the seeded data is the same whatever the default setting is, and the setting is left as it was.
 */
export async function seedSeniorCycles(pool: pg.Pool): Promise<number> {
  const before = (await pool.query("SELECT enabled FROM core.workflow_setting WHERE key = 'senior.reviewer_step'")).rows[0]?.enabled ?? false;
  await pool.query("UPDATE core.workflow_setting SET enabled = true WHERE key = 'senior.reviewer_step'");
  try {
    return await createSampleCycles(pool);
  } finally {
    await pool.query("UPDATE core.workflow_setting SET enabled = $1 WHERE key = 'senior.reviewer_step'", [before]);
  }
}

async function createSampleCycles(pool: pg.Pool): Promise<number> {
  if ((await pool.query('SELECT 1 FROM core.senior_cycle LIMIT 1')).rowCount) return 0;

  const ctxOf = async (code: string): Promise<Ctx & { userId: string; employeeId: string }> => {
    const { rows } = await pool.query('SELECT u.id, u.employee_id FROM core.user_account u WHERE u.login_id = $1', [code]);
    if (!rows[0]) throw new Error(`seed user ${code} does not exist`);
    return { auth: { userId: rows[0].id, employeeId: rows[0].employee_id, assignments: await loadAssignments(pool, rows[0].id) }, ip: null, userId: rows[0].id, employeeId: rows[0].employee_id };
  };

  // Place the three senior employees in their units so the HR board can show a plant.
  for (const [code, unit] of [['E0107', 'TRY-HAM'], ['E0108', 'TRY-PRS'], ['E0302', 'VLM-FS1']] as const) {
    await pool.query(
      `INSERT INTO core.employee_assignment (employee_id, org_unit_id, category_id, designation, grade, valid)
       SELECT e.id, o.id, c.id, 'Senior staff', 'S1', daterange('2024-04-01', NULL, '[)')
       FROM core.employee e, core.org_unit o, core.employee_category c
       WHERE e.employee_code = $1 AND o.code = $2 AND c.code = 'STAFF'
         AND NOT EXISTS (SELECT 1 FROM core.employee_assignment x WHERE x.employee_id = e.id)`,
      [code, unit],
    );
  }

  const hr = await ctxOf(HR);
  for (const spec of SPECS) {
    const [emp, mgr, rev] = [await ctxOf(spec.employee), await ctxOf(spec.manager), await ctxOf(spec.reviewer)];
    const id = await createCycle(pool, hr, { employeeId: emp.employeeId, fiscalYear: spec.fiscalYear, managerUserId: mgr.userId, reviewerUserId: rev.userId });
    await replaceGoals(pool, mgr, id, spec.goals);
    if (spec.through === 'GOALS_DRAFT') continue;
    await transition(pool, mgr, id, 'issue', null);
    if (spec.through === 'PENDING_ACK') continue;
    await transition(pool, emp, id, 'acknowledge', null);

    const kpis = (await getDetail(pool, mgr, id)).goals.kras.flatMap((k) => k.kpis);
    const months = fiscalMonths(spec.fiscalYear);
    const entries = (period: string, i: number): ResultItem[] => kpis.map((k, j) => ({ kpiId: k.id, result: sampleResult(k, period, i, j) }));
    for (const [i, period] of months.slice(0, spec.confirmedMonths).entries()) {
      await saveResults(pool, mgr, id, period, entries(period, i));
      await confirmMonth(pool, mgr, id, period);
    }
    if (spec.draftMonth) {
      const i = spec.confirmedMonths;
      await saveResults(pool, mgr, id, months[i], entries(months[i], i).slice(0, 2));
    }
    if (spec.through === 'ACKNOWLEDGED') continue;

    await transition(pool, hr, id, 'open_appraisal', null);
    await saveAssessment(pool, emp, id, {
      summary: 'Held the line on delivery and quality through the year. Main learning: earlier escalation of tooling issues.',
    });
    await transition(pool, emp, id, 'submit_self', null);
    await saveAssessment(pool, mgr, id, {
      summary: 'Consistent performer who met most targets. Ready for wider responsibility; should delegate more.',
    });
    await transition(pool, mgr, id, 'submit_manager', null);
    if (spec.through === 'REVIEWER_REVIEW') continue;

    await transition(pool, rev, id, 'sign_off', 'Agreed with the manager assessment.');
    await transition(pool, hr, id, 'finalise', 'Finalised for the year.');
  }
  return SPECS.length;
}
