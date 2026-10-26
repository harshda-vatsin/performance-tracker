/**
 * Senior-staff (Module A) domain logic: goal sheets, acknowledgement, monthly results, the year-end appraisal chain.
 * Authorisation to *reach* an endpoint is the route's job; this layer enforces who may act on a given cycle, the
 * state machine, validation and audit, so the HTTP routes and the dev seed share one set of rules.
 */
import type pg from 'pg';
import { audit } from '../audit.js';
import type { AuthContext } from '../auth/service.js';
import { withTransaction, type Db } from '../db.js';
import { fiscalYearOf, isPeriod, quarterOf } from '../fiscal.js';
import { unitProblem } from '../routes/util.js';
import { ENGINE_VERSION, hashInputs } from '../scoring/monthly.js';
import { rollupFiscalYear } from '../scoring/rollup.js';
import { bandFor, computeSeniorMonth, rollupSenior, seniorParams, type RatingBand, type SeniorKraInput, type SeniorMonthScores } from './scoring.js';

export class SeniorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}
const fail = (status: number, code: string, message?: string) => new SeniorError(status, code, message);

export type CycleState =
  | 'GOALS_DRAFT'
  | 'PENDING_ACK'
  | 'ACKNOWLEDGED'
  | 'SELF_ASSESSMENT'
  | 'MANAGER_ASSESSMENT'
  | 'REVIEWER_REVIEW'
  | 'HR_FINALISATION'
  | 'FINALISED';

type Role = 'employee' | 'manager' | 'reviewer' | 'hr';
type Auth = Pick<AuthContext, 'userId' | 'employeeId' | 'assignments'>;
export type Ctx = { auth: Auth; ip?: string | null };

const permsOf = (a: Pick<AuthContext, 'assignments'>) => new Set(a.assignments.flatMap((x) => x.permissions));

/** Doc 06 §3 plus the send-backs. `send_back` appears once per stage it can be issued from. */
const RULES: { action: string; from: CycleState; to: CycleState; by: Role[]; comment?: boolean }[] = [
  { action: 'issue', from: 'GOALS_DRAFT', to: 'PENDING_ACK', by: ['hr', 'manager'] },
  { action: 'acknowledge', from: 'PENDING_ACK', to: 'ACKNOWLEDGED', by: ['employee'] },
  { action: 'dispute', from: 'PENDING_ACK', to: 'GOALS_DRAFT', by: ['employee'], comment: true },
  { action: 'open_appraisal', from: 'ACKNOWLEDGED', to: 'SELF_ASSESSMENT', by: ['hr'] },
  { action: 'submit_self', from: 'SELF_ASSESSMENT', to: 'MANAGER_ASSESSMENT', by: ['employee'] },
  { action: 'submit_manager', from: 'MANAGER_ASSESSMENT', to: 'REVIEWER_REVIEW', by: ['manager'] },
  { action: 'sign_off', from: 'REVIEWER_REVIEW', to: 'HR_FINALISATION', by: ['reviewer'] },
  { action: 'finalise', from: 'HR_FINALISATION', to: 'FINALISED', by: ['hr'] },
  { action: 'send_back', from: 'MANAGER_ASSESSMENT', to: 'SELF_ASSESSMENT', by: ['manager'], comment: true },
  { action: 'send_back', from: 'REVIEWER_REVIEW', to: 'MANAGER_ASSESSMENT', by: ['reviewer'], comment: true },
  { action: 'send_back', from: 'HR_FINALISATION', to: 'REVIEWER_REVIEW', by: ['hr'], comment: true },
];

const ENTRY_STATES: CycleState[] = ['ACKNOWLEDGED', 'SELF_ASSESSMENT', 'MANAGER_ASSESSMENT'];

const PENDING_ON: Record<CycleState, string> = {
  GOALS_DRAFT: 'Manager / Corporate HR',
  PENDING_ACK: 'Employee',
  ACKNOWLEDGED: 'Manager',
  SELF_ASSESSMENT: 'Employee',
  MANAGER_ASSESSMENT: 'Manager',
  REVIEWER_REVIEW: 'Reviewer',
  HR_FINALISATION: 'Corporate HR',
  FINALISED: '',
};

interface Cycle {
  id: string;
  employeeId: string;
  employeeUserId: string | null;
  employeeCode: string;
  employeeName: string;
  fiscalYear: number;
  managerId: string;
  managerName: string;
  reviewerId: string;
  reviewerName: string;
  state: CycleState;
  goalVersion: number;
  acknowledgedAt: string | null;
  acknowledgedVersion: number | null;
  revision: number;
  finalScore: number | null;
  finalBandCode: string | null;
  finalBandLabel: string | null;
  finalRollup: unknown;
  finalParams: unknown;
  finalisedAt: string | null;
  finalisedByName: string | null;
}

export interface Kpi {
  id: string;
  libraryId: string | null;
  nameEn: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  unit: string;
  presentLevel: number;
  targets: [number, number, number, number];
  weight: number;
}
export interface Kra {
  id: string;
  nameEn: string;
  description: string | null;
  weight: number;
  kpis: Kpi[];
}

export interface GoalsInput {
  kras: {
    name: string;
    description?: string | null;
    weight: number;
    kpis: {
      name: string;
      unit: string;
      direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
      presentLevel: number;
      targets: number[];
      weight: number;
      kpiLibraryId?: string | null;
    }[];
  }[];
}

interface ResultRow {
  result: number | null;
  naReason: string | null;
  remarks: string | null;
  target: number;
  presentLevel: number;
}

// ---------------------------------------------------------------- loading

async function loadCycle(db: Db, id: string): Promise<Cycle | undefined> {
  return (
    await db.query(
      `SELECT c.id, ap.employee_id AS "employeeId", eu.id AS "employeeUserId", e.employee_code AS "employeeCode", e.full_name AS "employeeName",
              ap.fiscal_year AS "fiscalYear", c.manager_id AS "managerId", mn.full_name AS "managerName",
              ap.reviewer_user_id AS "reviewerId", rn.full_name AS "reviewerName", c.state,
              c.goal_version AS "goalVersion", c.acknowledged_at AS "acknowledgedAt", c.acknowledged_version AS "acknowledgedVersion",
              c.revision, c.final_score::float8 AS "finalScore", c.final_band_code AS "finalBandCode", c.final_band_label AS "finalBandLabel",
              c.final_rollup AS "finalRollup", c.final_params AS "finalParams", c.finalised_at AS "finalisedAt", fe.full_name AS "finalisedByName"
       FROM core.senior_cycle c
       JOIN core.appraisal ap ON ap.id = c.appraisal_id
       JOIN core.employee e ON e.id = ap.employee_id
       LEFT JOIN core.user_account eu ON eu.employee_id = ap.employee_id
       JOIN core.user_account mu ON mu.id = c.manager_id JOIN core.employee mn ON mn.id = mu.employee_id
       JOIN core.user_account ru ON ru.id = ap.reviewer_user_id JOIN core.employee rn ON rn.id = ru.employee_id
       LEFT JOIN core.user_account fu ON fu.id = c.finalised_by LEFT JOIN core.employee fe ON fe.id = fu.employee_id
       WHERE c.id = $1`,
      [id],
    )
  ).rows[0];
}

async function loadGoals(db: Db, cycleId: string): Promise<Kra[]> {
  const kras = (
    await db.query(
      'SELECT id, name_en AS "nameEn", description, weight::float8 AS weight FROM core.senior_kra WHERE cycle_id = $1 ORDER BY sort_order, id',
      [cycleId],
    )
  ).rows as Omit<Kra, 'kpis'>[];
  const kpis = (
    await db.query(
      `SELECT p.id, p.kra_id AS "kraId", p.kpi_id AS "libraryId", p.name_en AS "nameEn", p.direction, p.unit,
              p.present_level::float8 AS "presentLevel", p.weight::float8 AS weight,
              ARRAY[p.q1_target::float8, p.q2_target::float8, p.q3_target::float8, p.q4_target::float8] AS targets
       FROM core.senior_kpi p JOIN core.senior_kra k ON k.id = p.kra_id
       WHERE k.cycle_id = $1 ORDER BY k.sort_order, k.id, p.sort_order, p.id`,
      [cycleId],
    )
  ).rows as (Kpi & { kraId: string })[];
  return kras.map((k) => ({ ...k, kpis: kpis.filter((p) => p.kraId === k.id).map(({ kraId: _k, ...p }) => p) }));
}

async function loadSettings(db: Db) {
  const setting = (await db.query("SELECT value FROM core.senior_setting WHERE key = 'scoring'")).rows[0]?.value ?? {};
  const bands = (
    await db.query('SELECT code, label, min_score::float8 AS "minScore", rank FROM core.rating_band ORDER BY min_score DESC')
  ).rows as RatingBand[];
  return { params: seniorParams(setting), bands };
}

interface MonthRow {
  period: string;
  state: 'DRAFT' | 'CONFIRMED';
  scores: SeniorMonthScores | null;
  confirmedAt: string | null;
  results: Map<string, ResultRow>;
}

async function loadMonths(db: Db, cycleId: string): Promise<MonthRow[]> {
  const months = (
    await db.query('SELECT period, state, scores, confirmed_at AS "confirmedAt" FROM core.senior_month WHERE cycle_id = $1 ORDER BY period', [cycleId])
  ).rows as Omit<MonthRow, 'results'>[];
  const results = (
    await db.query(
      `SELECT period, kpi_id AS "kpiId", result::float8 AS result, na_reason AS "naReason", remarks,
              target_used::float8 AS target, present_level_used::float8 AS "presentLevel"
       FROM core.senior_result WHERE cycle_id = $1`,
      [cycleId],
    )
  ).rows as (ResultRow & { period: string; kpiId: string })[];
  return months.map((m) => ({
    ...m,
    results: new Map(results.filter((r) => r.period === m.period).map((r) => [r.kpiId, r])),
  }));
}

/** KPI inputs for one month; a KPI with no row yet is simply unscored. */
function monthInputs(goals: Kra[], month: MonthRow, quarter: 1 | 2 | 3 | 4): SeniorKraInput[] {
  return goals.map((k) => ({
    kraId: k.id,
    weight: k.weight,
    kpis: k.kpis.map((p) => {
      const r = month.results.get(p.id);
      return {
        kpiId: p.id,
        nameEn: p.nameEn,
        direction: p.direction,
        presentLevel: r?.presentLevel ?? p.presentLevel,
        target: r?.target ?? p.targets[quarter - 1],
        result: r?.result ?? null,
        naReason: r?.naReason ?? null,
        weight: p.weight,
      };
    }),
  }));
}

const confirmedMonths = (months: MonthRow[]) =>
  months.filter((m) => m.state === 'CONFIRMED' && m.scores).map((m) => ({ period: m.period, scores: m.scores as SeniorMonthScores }));

// ------------------------------------------------------------------ access

function rolesOn(c: Cycle, auth: Auth): Role[] {
  const p = permsOf(auth);
  const roles: Role[] = [];
  if (c.employeeUserId === auth.userId && p.has('senior:own')) roles.push('employee');
  if (c.managerId === auth.userId && p.has('senior:manage')) roles.push('manager');
  if (c.reviewerId === auth.userId && p.has('senior:review')) roles.push('reviewer');
  if (p.has('senior:hr')) roles.push('hr');
  return roles;
}

/** A cycle the caller may see; anything else is a 404 so existence cannot be probed. */
async function visibleCycle(db: Db, auth: Auth, id: string): Promise<{ cycle: Cycle; roles: Role[] }> {
  const cycle = isUuid(id) ? await loadCycle(db, id) : undefined;
  const roles = cycle ? rolesOn(cycle, auth) : [];
  if (!cycle || (roles.length === 0 && !permsOf(auth).has('senior:read_all'))) throw fail(404, 'NOT_FOUND');
  return { cycle, roles };
}

const need = (roles: Role[], ...allowed: Role[]) => {
  if (!allowed.some((r) => roles.includes(r))) throw fail(403, 'FORBIDDEN');
};

// -------------------------------------------------------------- goal sheet

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const cents = (n: number) => Math.round(n * 100);

/** Human-readable weight problems for the editor; the database enforces the same rules when the sheet is issued. */
export function goalIssues(kras: Kra[]): string[] {
  const issues: string[] = [];
  if (kras.length === 0) return ['The goal sheet has no KRAs yet.'];
  const total = kras.reduce((s, k) => s + cents(k.weight), 0) / 100;
  if (total !== 100) issues.push(`KRA weights total ${total} (must be exactly 100).`);
  for (const k of kras) {
    if (k.kpis.length === 0) issues.push(`KRA "${k.nameEn}" has no KPIs.`);
    else {
      const t = k.kpis.reduce((s, p) => s + cents(p.weight), 0) / 100;
      if (t !== 100) issues.push(`KPI weights in "${k.nameEn}" total ${t} (must be exactly 100).`);
    }
  }
  return issues;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t !== '' && t.length <= max ? t : null;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const weightOk = (w: number | null): w is number => w !== null && w > 0 && w <= 100 && Math.abs(w * 100 - Math.round(w * 100)) < 1e-6;

export function parseGoals(body: unknown): GoalsInput {
  const kras = (body as { kras?: unknown } | null)?.kras;
  if (!Array.isArray(kras) || kras.length === 0 || kras.length > 20) throw fail(400, 'BAD_REQUEST', 'kras must be a list of 1 to 20 KRAs');
  return {
    kras: kras.map((rawKra, i) => {
      const k = (rawKra ?? {}) as Record<string, unknown>;
      const name = text(k.name, 200);
      const weight = num(k.weight);
      if (!name) throw fail(400, 'BAD_REQUEST', `kras[${i}]: name is required`);
      if (!weightOk(weight)) throw fail(400, 'BAD_REQUEST', `kras[${i}] "${name}": weight must be above 0, at most 100, with at most 2 decimals`);
      const kpis = k.kpis;
      if (!Array.isArray(kpis) || kpis.length === 0 || kpis.length > 20) throw fail(400, 'BAD_REQUEST', `kras[${i}] "${name}": kpis must be a list of 1 to 20 KPIs`);
      return {
        name,
        description: k.description === undefined || k.description === null ? null : text(k.description, 1000),
        weight,
        kpis: kpis.map((rawKpi, j) => {
          const p = (rawKpi ?? {}) as Record<string, unknown>;
          const where = `kras[${i}].kpis[${j}]`;
          const pName = text(p.name, 200);
          const unit = text(p.unit, 30);
          const pl = num(p.presentLevel);
          const pWeight = num(p.weight);
          const targets = p.targets;
          if (!pName) throw fail(400, 'BAD_REQUEST', `${where}: name is required`);
          if (!unit) throw fail(400, 'BAD_REQUEST', `${where} "${pName}": unit is required`);
          if (p.direction !== 'HIGHER_BETTER' && p.direction !== 'LOWER_BETTER') throw fail(400, 'BAD_REQUEST', `${where} "${pName}": direction must be HIGHER_BETTER or LOWER_BETTER`);
          if (pl === null) throw fail(400, 'BAD_REQUEST', `${where} "${pName}": presentLevel must be a number`);
          if (!Array.isArray(targets) || targets.length !== 4 || targets.some((t) => num(t) === null)) {
            throw fail(400, 'BAD_REQUEST', `${where} "${pName}": targets must be four numbers (Q1 to Q4)`);
          }
          if (!weightOk(pWeight)) throw fail(400, 'BAD_REQUEST', `${where} "${pName}": weight must be above 0, at most 100, with at most 2 decimals`);
          const wrongSide = p.direction === 'HIGHER_BETTER' ? Math.min(...(targets as number[])) < pl : Math.max(...(targets as number[])) > pl;
          if (wrongSide) throw fail(400, 'BAD_REQUEST', `${where} "${pName}": a target is on the wrong side of the present level for ${p.direction}`);
          if (p.kpiLibraryId !== undefined && p.kpiLibraryId !== null && !isUuid(p.kpiLibraryId)) throw fail(400, 'BAD_REQUEST', `${where}: kpiLibraryId must be an id`);
          return { name: pName, unit, direction: p.direction, presentLevel: pl, targets: targets as number[], weight: pWeight, kpiLibraryId: (p.kpiLibraryId as string | null | undefined) ?? null };
        }),
      };
    }),
  };
}

export async function replaceGoals(pool: pg.Pool, { auth, ip }: Ctx, cycleId: string, goals: GoalsInput): Promise<{ kras: number; kpis: number }> {
  return withTransaction(pool, async (tx) => {
    const { cycle, roles } = await lockedCycle(tx, auth, cycleId);
    need(roles, 'hr', 'manager');
    if (cycle.state !== 'GOALS_DRAFT') throw fail(409, 'SENIOR_NOT_EDITABLE', `the goal sheet is ${cycle.state} and can no longer be edited`);

    const before = await loadGoals(tx, cycleId);
    await tx.query('DELETE FROM core.senior_kra WHERE cycle_id = $1', [cycleId]);
    let kpis = 0;
    for (const [i, k] of goals.kras.entries()) {
      const kra = await tx.query('INSERT INTO core.senior_kra (cycle_id, name_en, description, weight, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
        cycleId,
        k.name,
        k.description ?? null,
        k.weight,
        i,
      ]);
      for (const [j, p] of k.kpis.entries()) {
        await tx.query(
          `INSERT INTO core.senior_kpi (kra_id, kpi_id, name_en, direction, unit, present_level, q1_target, q2_target, q3_target, q4_target, weight, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [kra.rows[0].id, p.kpiLibraryId ?? null, p.name, p.direction, p.unit, p.presentLevel, ...p.targets, p.weight, j],
        );
        kpis++;
      }
    }
    await audit(tx, {
      actorId: auth.userId,
      action: 'SENIOR_GOALS_SAVED',
      entityType: 'senior_cycle',
      entityId: cycleId,
      before: { kras: before.length },
      after: { kras: goals.kras.length, kpis },
      ip,
    });
    return { kras: goals.kras.length, kpis };
  });
}

/** Row-locks the cycle for the rest of the transaction, then applies the usual visibility rule. */
async function lockedCycle(tx: Db, auth: Auth, cycleId: string) {
  if (isUuid(cycleId)) await tx.query('SELECT 1 FROM core.senior_cycle WHERE id = $1 FOR UPDATE', [cycleId]);
  return visibleCycle(tx, auth, cycleId);
}

// ------------------------------------------------------------------ cycles

export async function createCycle(
  pool: pg.Pool,
  { auth, ip }: Ctx,
  input: { employeeId: string; fiscalYear: number; managerUserId: string; reviewerUserId?: string | null },
): Promise<string> {
  if (!permsOf(auth).has('senior:hr')) throw fail(403, 'FORBIDDEN');
  if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 2020 || input.fiscalYear > 2100) throw fail(400, 'BAD_REQUEST', 'fiscalYear must be a start year such as 2026');
  if (!isUuid(input.employeeId) || !isUuid(input.managerUserId)) throw fail(400, 'BAD_REQUEST', 'employeeId and managerUserId are required');
  if (input.reviewerUserId != null && !isUuid(input.reviewerUserId)) throw fail(400, 'BAD_REQUEST', 'reviewerUserId must be an id');
  if (input.managerUserId === input.reviewerUserId) throw fail(400, 'BAD_REQUEST', 'the manager and the reviewer must be different people');

  const holds = async (userId: string, codes: string[]) =>
    (
      await pool.query(
        `SELECT 1 FROM core.role_assignment ra JOIN core.role r ON r.id = ra.role_id JOIN core.user_account u ON u.id = ra.user_id
         WHERE ra.user_id = $1 AND r.code = ANY($2) AND ra.valid @> current_date AND u.status = 'ACTIVE' LIMIT 1`,
        [userId, codes],
      )
    ).rowCount === 1;
  const emp = (await pool.query('SELECT u.id FROM core.user_account u WHERE u.employee_id = $1', [input.employeeId])).rows[0];
  if (!emp || !(await holds(emp.id, ['EMP']))) throw fail(400, 'BAD_REQUEST', 'the employee is not an active Employee');
  if (!(await holds(input.managerUserId, ['HOD']))) throw fail(400, 'BAD_REQUEST', 'the manager must be an active HOD / Manager');
  if (input.reviewerUserId && !(await holds(input.reviewerUserId, REVIEWER_ROLES))) {
    throw fail(400, 'BAD_REQUEST', 'the reviewer must be an active HOD / Manager, Plant Head or Management user');
  }

  return withTransaction(pool, async (tx) => {
    // The appraisal (employee + fiscal year + reviewer) is the anchor. Reuse the one that exists, or create it here.
    let appraisal = (
      await tx.query('SELECT id, reviewer_user_id AS "reviewerId" FROM core.appraisal WHERE employee_id = $1 AND fiscal_year = $2', [input.employeeId, input.fiscalYear])
    ).rows[0] as { id: string; reviewerId: string | null } | undefined;
    if (!appraisal) {
      appraisal = (
        await tx.query(
          `INSERT INTO core.appraisal (employee_id, fiscal_year, reviewer_user_id, assigned_by, created_by) VALUES ($1,$2,$3,$4,$5)
           RETURNING id, reviewer_user_id AS "reviewerId"`,
          [input.employeeId, input.fiscalYear, input.reviewerUserId ?? null, input.reviewerUserId ? auth.userId : null, auth.userId],
        )
      ).rows[0];
      await audit(tx, { actorId: auth.userId, action: 'APPRAISAL_CREATED', entityType: 'appraisal', entityId: appraisal!.id, after: { employeeId: input.employeeId, fiscalYear: input.fiscalYear }, ip });
    } else if (input.reviewerUserId && input.reviewerUserId !== appraisal.reviewerId) {
      await tx.query('UPDATE core.appraisal SET reviewer_user_id = $2, assigned_by = $3 WHERE id = $1', [appraisal.id, input.reviewerUserId, auth.userId]);
      await audit(tx, { actorId: auth.userId, action: 'APPRAISAL_REVIEWER_ASSIGNED', entityType: 'appraisal', entityId: appraisal.id, after: { reviewerUserId: input.reviewerUserId }, ip });
    }
    const { rows } = await tx.query('INSERT INTO core.senior_cycle (appraisal_id, manager_id, created_by) VALUES ($1,$2,$3) RETURNING id', [
      appraisal!.id,
      input.managerUserId,
      auth.userId,
    ]);
    await audit(tx, { actorId: auth.userId, action: 'SENIOR_CYCLE_CREATED', entityType: 'senior_cycle', entityId: rows[0].id, after: { ...input, appraisalId: appraisal!.id }, ip });
    return rows[0].id as string;
  });
}

/** Who can be assigned to review an appraisal (matches core.appraisal_reviewer_check). */
const REVIEWER_ROLES = ['HOD', 'PH', 'MGMT'];

export async function listPeople(pool: pg.Pool) {
  const { rows } = await pool.query(
    `SELECT u.id AS "userId", e.id AS "employeeId", e.employee_code AS "employeeCode", e.full_name AS "fullName",
            array_agg(DISTINCT r.code) AS roles
     FROM core.user_account u
     JOIN core.employee e ON e.id = u.employee_id
     JOIN core.role_assignment ra ON ra.user_id = u.id AND ra.valid @> current_date
     JOIN core.role r ON r.id = ra.role_id
     WHERE u.status = 'ACTIVE' AND r.code IN ('EMP','HOD','PH','MGMT')
     GROUP BY u.id, e.id, e.employee_code, e.full_name ORDER BY e.employee_code`,
  );
  const has = (r: { roles: string[] }, ...codes: string[]) => codes.some((c) => r.roles.includes(c));
  return {
    employees: rows.filter((r) => has(r, 'EMP')),
    managers: rows.filter((r) => has(r, 'HOD')),
    reviewers: rows.filter((r) => has(r, ...REVIEWER_ROLES)),
  };
}

export async function getConfig(pool: pg.Pool) {
  const { params, bands } = await loadSettings(pool);
  return { params, bands };
}

export type ListView = 'mine' | 'team' | 'review' | 'all';
const VIEW_PERMISSION: Record<ListView, string> = { mine: 'senior:own', team: 'senior:manage', review: 'senior:review', all: 'senior:read_all' };
export const isListView = (v: unknown): v is ListView => typeof v === 'string' && v in VIEW_PERMISSION;

export async function listCycles(pool: pg.Pool, { auth }: Ctx, view: ListView, filter: { fiscalYear?: number | null; state?: string | null }) {
  if (!permsOf(auth).has(VIEW_PERMISSION[view])) throw fail(403, 'FORBIDDEN');
  const { params, bands } = await loadSettings(pool);
  const { rows } = await pool.query(
    `SELECT c.id, ap.fiscal_year AS "fiscalYear", c.state, c.goal_version AS "goalVersion",
            e.employee_code AS "employeeCode", e.full_name AS "employeeName", mn.full_name AS "managerName", rn.full_name AS "reviewerName",
            c.final_score::float8 AS "finalScore", c.final_band_code AS "finalBandCode", c.final_band_label AS "finalBandLabel",
            plant.code AS "plantCode",
            (SELECT max(w.at) FROM core.workflow_event w WHERE w.entity_type = 'SENIOR_CYCLE' AND w.entity_id = c.id) AS "lastActionAt",
            (SELECT count(*)::int FROM core.senior_month m WHERE m.cycle_id = c.id AND m.state = 'CONFIRMED') AS "monthsConfirmed"
     FROM core.senior_cycle c
     JOIN core.appraisal ap ON ap.id = c.appraisal_id
     JOIN core.employee e ON e.id = ap.employee_id
     JOIN core.user_account mu ON mu.id = c.manager_id JOIN core.employee mn ON mn.id = mu.employee_id
     JOIN core.user_account ru ON ru.id = ap.reviewer_user_id JOIN core.employee rn ON rn.id = ru.employee_id
     LEFT JOIN LATERAL (
       SELECT p.code FROM core.employee_assignment ea
       JOIN core.org_unit u ON u.id = ea.org_unit_id
       JOIN core.org_unit p ON p.unit_type = 'PLANT' AND u.path <@ p.path
       WHERE ea.employee_id = ap.employee_id AND ea.valid @> current_date LIMIT 1
     ) plant ON true
     WHERE (CASE $1::text
              WHEN 'mine'   THEN ap.employee_id = $2::uuid
              WHEN 'team'   THEN c.manager_id = $3::uuid
              WHEN 'review' THEN ap.reviewer_user_id = $3::uuid
              ELSE true END)
       AND ($4::int IS NULL OR ap.fiscal_year = $4) AND ($5::text IS NULL OR c.state = $5)
     ORDER BY ap.fiscal_year DESC, e.employee_code`,
    [view, auth.employeeId, auth.userId, filter.fiscalYear ?? null, filter.state ?? null],
  );
  const monthly = (
    await pool.query(
      "SELECT cycle_id AS \"cycleId\", period, total_score::float8 AS total FROM core.senior_month WHERE cycle_id = ANY($1::uuid[]) AND state = 'CONFIRMED'",
      [rows.map((r) => r.id)],
    )
  ).rows as { cycleId: string; period: string; total: number | null }[];

  return {
    cycles: rows.map((r) => {
      const score =
        r.state === 'FINALISED'
          ? (r.finalScore as number | null)
          : rollupFiscalYear(r.fiscalYear, new Map(monthly.filter((m) => m.cycleId === r.id).map((m) => [m.period, m.total])), params).year.score;
      const band = r.state === 'FINALISED' ? { code: r.finalBandCode, label: r.finalBandLabel } : bandFor(score, bands);
      return {
        ...r,
        score,
        band: band ? { code: band.code, label: band.label } : null,
        provisional: r.state !== 'FINALISED',
        pendingOn: PENDING_ON[r.state as CycleState],
      };
    }),
  };
}

// ------------------------------------------------------------------ detail

export async function getDetail(pool: pg.Pool, { auth }: Ctx, cycleId: string) {
  const { cycle, roles } = await visibleCycle(pool, auth, cycleId);
  const employeeOnly = roles.length === 1 && roles[0] === 'employee';
  const { params, bands } = await loadSettings(pool);
  const goals = await loadGoals(pool, cycleId);
  const months = await loadMonths(pool, cycleId);
  const finalised = cycle.state === 'FINALISED';

  const monthViews = months.map((m) => {
    const q = quarterOf(m.period);
    const scores = m.state === 'CONFIRMED' && m.scores ? m.scores : computeSeniorMonth(monthInputs(goals, m, q), params);
    return {
      period: m.period,
      state: m.state,
      confirmedAt: m.confirmedAt,
      total: scores.total,
      kras: scores.kras,
      kpis: goals.flatMap((k) =>
        k.kpis.map((p) => {
          const r = m.results.get(p.id);
          const s = scores.kpis.find((x) => x.kpiId === p.id);
          return {
            kpiId: p.id,
            target: r?.target ?? p.targets[q - 1],
            presentLevel: r?.presentLevel ?? p.presentLevel,
            result: r?.result ?? null,
            naReason: r?.naReason ?? null,
            remarks: r?.remarks ?? null,
            score: s?.final ?? null,
            flags: s?.flags ?? [],
          };
        }),
      ),
    };
  });

  const rollup = finalised && cycle.finalRollup ? (cycle.finalRollup as ReturnType<typeof rollupSenior>) : rollupSenior(cycle.fiscalYear, confirmedMonths(months), params);
  const score = finalised ? cycle.finalScore : rollup.total.year.score;
  const band = finalised ? { code: cycle.finalBandCode, label: cycle.finalBandLabel } : bandFor(score, bands);

  const assessments = (
    await pool.query(
      `SELECT a.stage, a.summary, a.kra_comments AS "kraComments", a.submitted_at AS "submittedAt", e.full_name AS author
       FROM core.senior_assessment a JOIN core.user_account u ON u.id = a.author_id JOIN core.employee e ON e.id = u.employee_id
       WHERE a.cycle_id = $1`,
      [cycleId],
    )
  ).rows as { stage: 'SELF' | 'MANAGER'; summary: string; kraComments: Record<string, string>; submittedAt: string | null; author: string }[];
  // The manager's assessment stays private to the review chain until the appraisal is finalised.
  const visibleAssessments = assessments.filter((a) => !(employeeOnly && a.stage === 'MANAGER' && !finalised));

  const events = (
    await pool.query(
      `SELECT w.revision, w.from_state AS "fromState", w.to_state AS "toState", e.full_name AS actor, w.comment, w.at
       FROM core.workflow_event w JOIN core.user_account u ON u.id = w.actor_id JOIN core.employee e ON e.id = u.employee_id
       WHERE w.entity_type = 'SENIOR_CYCLE' AND w.entity_id = $1 ORDER BY w.id`,
      [cycleId],
    )
  ).rows as { fromState: string; toState: string; comment: string | null }[];
  // Until finalisation the employee sees comments addressed to them (goals, acknowledgement, a send-back to self-assessment),
  // not the manager / reviewer / HR conversation.
  const addressedToEmployee = (e: { fromState: string; toState: string }) =>
    ['GOALS_DRAFT', 'PENDING_ACK', 'ACKNOWLEDGED', 'SELF_ASSESSMENT'].includes(e.fromState) || (e.fromState === 'MANAGER_ASSESSMENT' && e.toState === 'SELF_ASSESSMENT');
  const shownEvents = events.map((e) => (employeeOnly && !finalised && !addressedToEmployee(e) ? { ...e, comment: null } : e));

  return {
    cycle: {
      id: cycle.id,
      fiscalYear: cycle.fiscalYear,
      state: cycle.state,
      pendingOn: PENDING_ON[cycle.state],
      goalVersion: cycle.goalVersion,
      acknowledgedAt: cycle.acknowledgedAt,
      acknowledgedVersion: cycle.acknowledgedVersion,
      revision: cycle.revision,
      employee: { code: cycle.employeeCode, name: cycle.employeeName },
      manager: { name: cycle.managerName },
      reviewer: { name: cycle.reviewerName },
      final: finalised ? { score: cycle.finalScore, band, finalisedAt: cycle.finalisedAt, finalisedBy: cycle.finalisedByName } : null,
    },
    viewer: {
      roles,
      actions: [...new Set(RULES.filter((r) => r.from === cycle.state && r.by.some((b) => roles.includes(b))).map((r) => r.action))],
      canEditGoals: cycle.state === 'GOALS_DRAFT' && (roles.includes('hr') || roles.includes('manager')),
      canEnterResults: roles.includes('manager') && ENTRY_STATES.includes(cycle.state),
      assessmentStage: roles.includes('employee') && cycle.state === 'SELF_ASSESSMENT' ? 'SELF' : roles.includes('manager') && cycle.state === 'MANAGER_ASSESSMENT' ? 'MANAGER' : null,
    },
    goals: { kras: goals, issues: goalIssues(goals) },
    months: monthViews,
    rollup,
    score,
    band,
    provisional: !finalised,
    bands,
    assessments: visibleAssessments,
    events: shownEvents,
  };
}

// ----------------------------------------------------------- monthly results

export interface ResultItem {
  kpiId: string;
  result?: number | null;
  naReason?: string | null;
  remarks?: string | null;
}

export function parseResults(body: unknown): ResultItem[] {
  const items = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(items) || items.length === 0) throw fail(400, 'BAD_REQUEST', 'results must be a non-empty array');
  return items.map((raw, i) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    if (!isUuid(it.kpiId)) throw fail(400, 'BAD_REQUEST', `results[${i}]: kpiId is required`);
    const out: ResultItem = { kpiId: it.kpiId };
    if ('result' in it) {
      if (it.result !== null && num(it.result) === null) throw fail(400, 'BAD_REQUEST', `results[${i}]: result must be a number or null`);
      out.result = it.result as number | null;
    }
    if ('naReason' in it) {
      if (it.naReason !== null && !text(it.naReason, 500)) throw fail(400, 'BAD_REQUEST', `results[${i}]: naReason must be text or null`);
      if (it.naReason !== null && it.result !== undefined && it.result !== null) throw fail(400, 'BAD_REQUEST', `results[${i}]: give either a result or an N/A reason, not both`);
      out.naReason = it.naReason === null ? null : text(it.naReason, 500);
    }
    if ('remarks' in it) out.remarks = it.remarks === null ? null : text(it.remarks, 1000);
    return out;
  });
}

async function editableMonth(tx: Db, cycle: Cycle, roles: Role[], period: string): Promise<void> {
  need(roles, 'manager');
  if (!isPeriod(period) || fiscalYearOf(period) !== cycle.fiscalYear) throw fail(400, 'BAD_REQUEST', `period must be a month (YYYY-MM) inside FY ${cycle.fiscalYear}-${String(cycle.fiscalYear + 1).slice(2)}`);
  if (!ENTRY_STATES.includes(cycle.state)) throw fail(409, 'SENIOR_NOT_EDITABLE', `monthly results cannot be entered while the appraisal is ${cycle.state}`);
  const m = (await tx.query('SELECT state FROM core.senior_month WHERE cycle_id = $1 AND period = $2', [cycle.id, period])).rows[0];
  if (m?.state === 'CONFIRMED') throw fail(409, 'SENIOR_MONTH_CONFIRMED', `${period} is confirmed and can no longer change`);
}

export async function saveResults(pool: pg.Pool, { auth, ip }: Ctx, cycleId: string, period: string, items: ResultItem[]): Promise<{ saved: number }> {
  return withTransaction(pool, async (tx) => {
    const { cycle, roles } = await lockedCycle(tx, auth, cycleId);
    await editableMonth(tx, cycle, roles, period);
    const goals = await loadGoals(tx, cycleId);
    const kpis = new Map(goals.flatMap((k) => k.kpis).map((p) => [p.id, p]));
    const q = quarterOf(period);

    // Creating the month creates a row per KPI with the targets in force now, so an old month never depends on the sheet.
    await tx.query('INSERT INTO core.senior_month (cycle_id, period) VALUES ($1,$2) ON CONFLICT DO NOTHING', [cycleId, period]);
    for (const p of kpis.values()) {
      await tx.query(
        `INSERT INTO core.senior_result (cycle_id, period, kpi_id, target_used, present_level_used) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (cycle_id, period, kpi_id) DO NOTHING`,
        [cycleId, period, p.id, p.targets[q - 1], p.presentLevel],
      );
    }
    const current = (await loadMonths(tx, cycleId)).find((m) => m.period === period)!.results;

    for (const [i, it] of items.entries()) {
      const kpi = kpis.get(it.kpiId);
      if (!kpi) throw fail(400, 'BAD_REQUEST', `results[${i}]: unknown kpiId`);
      const row = current.get(it.kpiId)!;
      let { result, naReason, remarks } = row;
      if ('result' in it) {
        result = it.result ?? null;
        if (result !== null) {
          const problem = unitProblem(kpi.unit, result);
          if (problem) throw fail(400, 'BAD_REQUEST', `results[${i}] "${kpi.nameEn}": ${problem}`);
          naReason = null;
        }
      }
      if ('naReason' in it) {
        naReason = it.naReason ?? null;
        if (naReason !== null) result = null;
      }
      if ('remarks' in it) remarks = it.remarks ?? null;
      await tx.query(
        `UPDATE core.senior_result SET result = $4, na_reason = $5, remarks = $6, updated_by = $7, updated_at = now()
         WHERE cycle_id = $1 AND period = $2 AND kpi_id = $3`,
        [cycleId, period, it.kpiId, result, naReason, remarks, auth.userId],
      );
    }
    await audit(tx, { actorId: auth.userId, action: 'SENIOR_RESULTS_SAVED', entityType: 'senior_cycle', entityId: cycleId, after: { period, rows: items.length }, ip });
    return { saved: items.length };
  });
}

/** Locks a month: every KPI needs a result or an N/A reason, then the official score is computed and frozen. */
export async function confirmMonth(pool: pg.Pool, { auth, ip }: Ctx, cycleId: string, period: string): Promise<{ total: number | null }> {
  return withTransaction(pool, async (tx) => {
    const { cycle, roles } = await lockedCycle(tx, auth, cycleId);
    await editableMonth(tx, cycle, roles, period);
    const goals = await loadGoals(tx, cycleId);
    const month = (await loadMonths(tx, cycleId)).find((m) => m.period === period);
    if (!month) throw fail(409, 'SENIOR_NO_RESULTS', `no results have been entered for ${period}`);

    const missing = goals.flatMap((k) => k.kpis).filter((p) => {
      const r = month.results.get(p.id);
      return !r || (r.result === null && !r.naReason);
    });
    if (missing.length > 0) {
      throw fail(409, 'SENIOR_INCOMPLETE', `every KPI needs a result or an N/A reason; missing: ${missing.map((p) => `"${p.nameEn}"`).join(', ')}`);
    }

    const { params } = await loadSettings(tx);
    const inputs = monthInputs(goals, month, quarterOf(period));
    const scores = computeSeniorMonth(inputs, params);
    await tx.query(
      `UPDATE core.senior_month SET state = 'CONFIRMED', scores = $3, total_score = $4, params = $5, engine_version = $6, input_hash = $7,
              confirmed_by = $8, confirmed_at = now()
       WHERE cycle_id = $1 AND period = $2`,
      [cycleId, period, JSON.stringify(scores), scores.total, JSON.stringify(params), ENGINE_VERSION, hashInputs({ period, inputs, params, engine: ENGINE_VERSION }), auth.userId],
    );
    await audit(tx, { actorId: auth.userId, action: 'SENIOR_MONTH_CONFIRMED', entityType: 'senior_cycle', entityId: cycleId, after: { period, total: scores.total }, ip });
    return { total: scores.total };
  });
}

// ------------------------------------------------------------- assessments

export async function saveAssessment(
  pool: pg.Pool,
  { auth, ip }: Ctx,
  cycleId: string,
  body: { summary?: unknown; kraComments?: unknown },
): Promise<{ stage: 'SELF' | 'MANAGER' }> {
  const summary = body.summary === undefined ? '' : typeof body.summary === 'string' && body.summary.length <= 4000 ? body.summary.trim() : null;
  if (summary === null) throw fail(400, 'BAD_REQUEST', 'summary must be text of at most 4000 characters');
  const raw = body.kraComments ?? {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail(400, 'BAD_REQUEST', 'kraComments must be an object of KRA id to text');

  return withTransaction(pool, async (tx) => {
    const { cycle, roles } = await lockedCycle(tx, auth, cycleId);
    const stage: 'SELF' | 'MANAGER' | null =
      roles.includes('employee') && cycle.state === 'SELF_ASSESSMENT' ? 'SELF' : roles.includes('manager') && cycle.state === 'MANAGER_ASSESSMENT' ? 'MANAGER' : null;
    if (!stage) throw fail(roles.length ? 409 : 403, roles.length ? 'SENIOR_NOT_EDITABLE' : 'FORBIDDEN', 'there is no assessment for you to write at this stage');

    const kraIds = new Set((await loadGoals(tx, cycleId)).map((k) => k.id));
    const comments: Record<string, string> = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!kraIds.has(id)) throw fail(400, 'BAD_REQUEST', 'kraComments refers to an unknown KRA');
      if (typeof v !== 'string' || v.length > 2000) throw fail(400, 'BAD_REQUEST', 'each KRA comment must be text of at most 2000 characters');
      if (v.trim()) comments[id] = v.trim();
    }
    await tx.query(
      `INSERT INTO core.senior_assessment (cycle_id, stage, author_id, summary, kra_comments) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (cycle_id, stage) DO UPDATE SET author_id = $3, summary = $4, kra_comments = $5, updated_at = now()`,
      [cycleId, stage, auth.userId, summary, JSON.stringify(comments)],
    );
    await audit(tx, { actorId: auth.userId, action: 'SENIOR_ASSESSMENT_SAVED', entityType: 'senior_cycle', entityId: cycleId, after: { stage, length: summary.length }, ip });
    return { stage };
  });
}

// ------------------------------------------------------------- transitions

export async function transition(pool: pg.Pool, { auth, ip }: Ctx, cycleId: string, action: string, rawComment: unknown): Promise<{ state: CycleState }> {
  const comment = rawComment === undefined || rawComment === null ? null : text(rawComment, 1000);
  if (rawComment !== undefined && rawComment !== null && comment === null) throw fail(400, 'BAD_REQUEST', 'comment must be text of at most 1000 characters');

  return withTransaction(pool, async (tx) => {
    const { cycle, roles } = await lockedCycle(tx, auth, cycleId);
    const candidates = RULES.filter((r) => r.action === action);
    if (candidates.length === 0) throw fail(400, 'BAD_REQUEST', `unknown action "${action}"`);
    const rule = candidates.find((r) => r.from === cycle.state);
    if (!rule) throw fail(409, 'SENIOR_WRONG_STATE', `"${action}" is not possible while the appraisal is ${cycle.state}`);
    need(roles, ...rule.by);
    if (rule.comment && !comment) throw fail(400, 'SENIOR_COMMENT_REQUIRED', `"${action}" needs a comment explaining why`);

    // Stage-specific gates.
    if (action === 'submit_self' || action === 'submit_manager') {
      const stage = action === 'submit_self' ? 'SELF' : 'MANAGER';
      const a = (await tx.query('SELECT summary FROM core.senior_assessment WHERE cycle_id = $1 AND stage = $2', [cycleId, stage])).rows[0];
      if (!a || !a.summary) throw fail(409, 'SENIOR_ASSESSMENT_REQUIRED', 'write the assessment summary before submitting');
      await tx.query('UPDATE core.senior_assessment SET submitted_at = now() WHERE cycle_id = $1 AND stage = $2', [cycleId, stage]);
    }
    if (action === 'send_back') {
      // Re-open the assessment of the stage being sent back to, so its author can edit and resubmit.
      const stage = rule.to === 'SELF_ASSESSMENT' ? 'SELF' : rule.to === 'MANAGER_ASSESSMENT' ? 'MANAGER' : null;
      if (stage) await tx.query('UPDATE core.senior_assessment SET submitted_at = NULL WHERE cycle_id = $1 AND stage = $2', [cycleId, stage]);
    }

    if (action === 'finalise') {
      const { params, bands } = await loadSettings(tx);
      const rollup = rollupSenior(cycle.fiscalYear, confirmedMonths(await loadMonths(tx, cycleId)), params);
      const score = rollup.total.year.score;
      if (score === null) throw fail(409, 'SENIOR_NO_SCORES', 'at least one confirmed month is needed to finalise');
      const band = bandFor(score, bands);
      if (!band) throw fail(409, 'SENIOR_NO_BAND', 'no rating band covers this score; check the rating band configuration');
      await tx.query(
        `UPDATE core.senior_cycle SET state = 'FINALISED', final_score = $2, final_band_code = $3, final_band_label = $4, final_rollup = $5,
                final_params = $6, finalised_by = $7, finalised_at = now() WHERE id = $1`,
        [cycleId, score, band.code, band.label, JSON.stringify(rollup), JSON.stringify(params), auth.userId],
      );
    } else if (action === 'issue') {
      await tx.query('UPDATE core.senior_cycle SET state = $2, goal_version = goal_version + 1 WHERE id = $1', [cycleId, rule.to]);
    } else if (action === 'acknowledge') {
      await tx.query('UPDATE core.senior_cycle SET state = $2, acknowledged_at = now(), acknowledged_version = goal_version WHERE id = $1', [cycleId, rule.to]);
    } else if (action === 'send_back') {
      await tx.query('UPDATE core.senior_cycle SET state = $2, revision = revision + 1 WHERE id = $1', [cycleId, rule.to]);
    } else {
      await tx.query('UPDATE core.senior_cycle SET state = $2 WHERE id = $1', [cycleId, rule.to]);
    }

    await tx.query(
      `INSERT INTO core.workflow_event (entity_type, entity_id, revision, from_state, to_state, actor_id, comment)
       VALUES ('SENIOR_CYCLE',$1,$2,$3,$4,$5,$6)`,
      [cycleId, cycle.revision, cycle.state, rule.to, auth.userId, comment],
    );
    await audit(tx, {
      actorId: auth.userId,
      action: `SENIOR_${action.toUpperCase()}`,
      entityType: 'senior_cycle',
      entityId: cycleId,
      before: { state: cycle.state },
      after: { state: rule.to, comment },
      ip,
    });
    return { state: rule.to };
  });
}
