import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/audit.js';
import { setupEnv, type TestEnv } from './helpers.js';

/**
 * Senior-staff (Module A) track, end to end. Scores follow the worked months in senior-scoring.test.ts:
 *   2026-04 -> 78   2026-05 -> 106   2026-06 -> 86   (Q1 = 90.00)   2026-07 -> 100   2026-08 -> 100   (Q2 = 100.00)
 *   Year = 95.00 -> "Exceeds expectations"
 */
let env: TestEnv;
const c: Record<string, string | undefined> = {};
const cyc: Record<string, string> = {};
const emp: Record<string, string> = {};

const GOALS = {
  kras: [
    {
      name: 'Delivery',
      weight: 60,
      kpis: [
        { name: 'Productivity', unit: '%', direction: 'HIGHER_BETTER', presentLevel: 82, targets: [84, 86, 88, 90], weight: 50 },
        { name: 'Rejection', unit: '%', direction: 'LOWER_BETTER', presentLevel: 5, targets: [4.5, 4, 3.5, 3], weight: 50 },
      ],
    },
    {
      name: 'Safety',
      weight: 40,
      kpis: [{ name: 'Unsafe conditions', unit: 'nos', direction: 'LOWER_BETTER', presentLevel: 4, targets: [3, 2, 1, 0], weight: 100 }],
    },
  ],
};

const detail = async (id: string, cookie: string | undefined) => (await env.get(`/senior/cycles/${id}`, cookie)).json();
const act = (id: string, action: string, cookie: string | undefined, comment?: string) => env.post(`/senior/cycles/${id}/transitions`, { action, comment }, cookie);
const kpiIds = async (id: string, cookie: string | undefined) => {
  const d = await detail(id, cookie);
  const byName: Record<string, string> = {};
  for (const k of d.goals.kras) for (const p of k.kpis) byName[p.nameEn] = p.id;
  return byName;
};
const enter = async (id: string, period: string, vals: [number | null, number | null, number | null], cookie = c.mgr) => {
  const ids = await kpiIds(id, c.chr); // look the ids up as HR so a forbidden caller still reaches the endpoint under test
  return env.put(
    `/senior/cycles/${id}/results/${period}`,
    {
      results: [
        { kpiId: ids.Productivity, result: vals[0] },
        { kpiId: ids.Rejection, result: vals[1] },
        { kpiId: ids['Unsafe conditions'], result: vals[2] },
      ],
    },
    cookie,
  );
};
const confirm = (id: string, period: string, cookie = c.mgr) => env.post(`/senior/cycles/${id}/months/${period}/confirm`, {}, cookie);
const assess = (id: string, cookie: string | undefined, summary: string, kraComments: Record<string, string> = {}) =>
  env.put(`/senior/cycles/${id}/assessment`, { summary, kraComments }, cookie);
const newCycle = async (employeeCode: string, managerCode: string, reviewerCode: string, fiscalYear = 2026, cookie = c.chr) =>
  env.post('/senior/cycles', { employeeId: emp[employeeCode], fiscalYear, managerUserId: env.ids[managerCode], reviewerUserId: env.ids[reviewerCode] }, cookie);

/** Drives a cycle to ACKNOWLEDGED with the standard sheet. */
async function acknowledged(id: string, mgr = c.mgr, employee = c.sen) {
  expect((await env.put(`/senior/cycles/${id}/goals`, GOALS, mgr)).statusCode).toBe(200);
  expect((await act(id, 'issue', mgr)).statusCode).toBe(200);
  expect((await act(id, 'acknowledge', employee)).statusCode).toBe(200);
}

/** Drives an ACKNOWLEDGED cycle to HR_FINALISATION. */
async function toHrFinalisation(id: string, who: { mgr: string | undefined; employee: string | undefined; reviewer: string | undefined }) {
  expect((await act(id, 'open_appraisal', c.chr)).statusCode).toBe(200);
  expect((await assess(id, who.employee, 'My year in brief')).statusCode).toBe(200);
  expect((await act(id, 'submit_self', who.employee)).statusCode).toBe(200);
  expect((await assess(id, who.mgr, 'Manager view')).statusCode).toBe(200);
  expect((await act(id, 'submit_manager', who.mgr)).statusCode).toBe(200);
  expect((await act(id, 'sign_off', who.reviewer)).statusCode).toBe(200);
}

beforeAll(async () => {
  env = await setupEnv();
  // These tests cover the reviewer sign-off; the reviewer step is off by default.
  await env.pool.query("UPDATE core.workflow_setting SET enabled = true WHERE key = 'senior.reviewer_step'");
  const { ids, pool } = env;
  // The 7 roles: the senior employee is an Employee, the manager an HOD, and the reviewer is an assignment on the appraisal
  // (any HOD / Manager, Plant Head or Management user).
  await env.user('E3001', 'CHR');
  await env.user('E3002', 'MGMT'); // read-only view of the board
  await env.user('E3010', 'EMP', 'SELF'); // Asha, the senior employee under test
  await env.user('E3011', 'HOD', 'DEPARTMENT', ids.d1); // her manager
  await env.user('E3012', 'PH', 'PLANT', ids.p1); // her reviewer
  await env.user('E3013', 'HOD', 'DEPARTMENT', ids.d1); // another manager
  await env.user('E3014', 'EMP', 'SELF'); // another senior employee
  await env.user('E3015', 'EMP', 'SELF'); // an Employee with no cycle at all
  await env.user('E3016', 'PH', 'PLANT', ids.p2); // second reviewer
  await env.user('E3017', 'EMP', 'SELF'); // third senior employee (SoD scenario)
  await env.user('E3018', 'PH', 'PLANT', ids.p1); // reviewer who also holds Corporate HR
  await env.assign(ids.E3018, 'CHR', 'COMPANY');
  await env.user('E3019', 'EMP', 'SELF'); // employee who also holds a manager role
  await env.assign(ids.E3019, 'HOD', 'DEPARTMENT', ids.d1);
  for (const [key, code] of [
    ['chr', 'E3001'],
    ['chrH', 'E3002'],
    ['sen', 'E3010'],
    ['mgr', 'E3011'],
    ['rev', 'E3012'],
    ['mgr2', 'E3013'],
    ['sen2', 'E3014'],
    ['sup', 'E3015'],
    ['rev2', 'E3016'],
    ['sen3', 'E3017'],
    ['revChr', 'E3018'],
  ]) {
    c[key] = (await env.loginAs(code)).cookie;
  }
  for (const code of ['E3010', 'E3014', 'E3015', 'E3017', 'E3019']) {
    emp[code] = (await pool.query('SELECT employee_id FROM core.user_account WHERE id = $1', [ids[code]])).rows[0].employee_id;
  }
});

afterAll(async () => env.close());

describe('cycle creation', () => {
  it('lets Corporate HR create a cycle for a senior employee, and no one else', async () => {
    expect((await newCycle('E3010', 'E3011', 'E3012', 2026, c.mgr)).statusCode).toBe(403);
    expect((await newCycle('E3010', 'E3011', 'E3012', 2026, c.sen)).statusCode).toBe(403);
    const res = await newCycle('E3010', 'E3011', 'E3012');
    expect(res.statusCode).toBe(201);
    cyc.main = res.json().id;
    expect((await detail(cyc.main, c.chr)).cycle.state).toBe('GOALS_DRAFT');
  });

  it('rejects bad people, the same person in two roles, and duplicates', async () => {
    expect((await newCycle('E3013', 'E3011', 'E3012')).statusCode).toBe(400); // the "employee" is an HOD, not an Employee
    expect((await newCycle('E3014', 'E3015', 'E3012')).statusCode).toBe(400); // the manager must be an HOD
    expect((await newCycle('E3014', 'E3011', 'E3015')).statusCode).toBe(400); // the reviewer must be HOD / Plant Head / Management
    expect((await newCycle('E3014', 'E3011', 'E3011')).statusCode).toBe(400); // manager = reviewer
    expect((await newCycle('E3010', 'E3011', 'E3012')).statusCode).toBe(409); // already has a FY 2026 cycle
  });

  it('refuses to let an employee manage their own appraisal (separation of duties)', async () => {
    const res = await newCycle('E3019', 'E3019', 'E3012');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/^SOD:/);
  });

  it('keeps cycles invisible to people with no part in them', async () => {
    expect((await env.get(`/senior/cycles/${cyc.main}`, c.mgr2)).statusCode).toBe(404);
    expect((await env.get(`/senior/cycles/${cyc.main}`, c.sen2)).statusCode).toBe(404);
    expect((await env.get(`/senior/cycles/${cyc.main}`, c.sup)).statusCode).toBe(404);
    expect((await env.get(`/senior/cycles/${cyc.main}`, c.rev2)).statusCode).toBe(404);
    expect((await env.get('/senior/cycles/not-an-id', c.chr)).statusCode).toBe(404);
    expect((await env.get(`/senior/cycles/${cyc.main}`)).statusCode).toBe(401);
  });
});

describe('goal sheet', () => {
  it('can be authored by the manager or Corporate HR, not by the employee or an unrelated manager', async () => {
    expect((await env.put(`/senior/cycles/${cyc.main}/goals`, GOALS, c.sen)).statusCode).toBe(403);
    expect((await env.put(`/senior/cycles/${cyc.main}/goals`, GOALS, c.mgr2)).statusCode).toBe(404);
    const incomplete = { kras: [{ ...GOALS.kras[0], weight: 50 }, GOALS.kras[1]] };
    expect((await env.put(`/senior/cycles/${cyc.main}/goals`, incomplete, c.mgr)).statusCode).toBe(200); // drafts may be incomplete
    const d = await detail(cyc.main, c.mgr);
    expect(d.goals.issues).toEqual(['KRA weights total 90 (must be exactly 100).']);
    expect(d.viewer.canEditGoals).toBe(true);
  });

  it('validates the sheet shape: direction, four targets on the improving side, weights', async () => {
    const put = (kras: unknown) => env.put(`/senior/cycles/${cyc.main}/goals`, { kras }, c.chr);
    const kpi = GOALS.kras[0].kpis[0];
    const sheet = (k: object) => [{ name: 'X', weight: 100, kpis: [{ ...kpi, weight: 100, ...k }] }];
    expect((await put(sheet({ targets: [80, 86, 88, 90] }))).statusCode).toBe(400); // Q1 target below present level for HIGHER_BETTER
    expect((await put(sheet({ targets: [84, 86, 88] }))).statusCode).toBe(400);
    expect((await put(sheet({ direction: 'SIDEWAYS' }))).statusCode).toBe(400);
    expect((await put(sheet({ weight: 33.333 }))).statusCode).toBe(400);
    expect((await put([])).statusCode).toBe(400);
  });

  it('refuses to issue a sheet whose weights do not total 100, at KRA and KPI level', async () => {
    const incomplete = { kras: [{ ...GOALS.kras[0], weight: 50 }, GOALS.kras[1]] };
    await env.put(`/senior/cycles/${cyc.main}/goals`, incomplete, c.mgr);
    const r1 = await act(cyc.main, 'issue', c.mgr);
    expect(r1.statusCode).toBe(409);
    expect(r1.json().error).toMatch(/^WEIGHTS: KRA weights total 90/);

    const kpiBad = { kras: [{ ...GOALS.kras[0], kpis: [{ ...GOALS.kras[0].kpis[0], weight: 40 }, GOALS.kras[0].kpis[1]] }, GOALS.kras[1]] };
    expect((await env.put(`/senior/cycles/${cyc.main}/goals`, kpiBad, c.chr)).statusCode).toBe(200);
    const r2 = await act(cyc.main, 'issue', c.chr);
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error).toMatch(/KPI weights in KRA "Delivery" total 90/);
  });

  it('is issued with weights of exactly 100 and then frozen, even against direct SQL', async () => {
    expect((await env.put(`/senior/cycles/${cyc.main}/goals`, GOALS, c.mgr)).statusCode).toBe(200);
    expect((await detail(cyc.main, c.mgr)).goals.issues).toEqual([]);
    expect((await act(cyc.main, 'issue', c.mgr)).json().state).toBe('PENDING_ACK');
    expect((await detail(cyc.main, c.mgr)).cycle.goalVersion).toBe(1);

    expect((await env.put(`/senior/cycles/${cyc.main}/goals`, GOALS, c.mgr)).statusCode).toBe(409);
    await expect(env.pool.query('UPDATE core.senior_kra SET weight = 55 WHERE cycle_id = $1', [cyc.main])).rejects.toThrow(/LOCKED/);
    await expect(env.pool.query('DELETE FROM core.senior_kra WHERE cycle_id = $1', [cyc.main])).rejects.toThrow(/LOCKED/);
  });
});

describe('acknowledgement', () => {
  it('belongs to the employee alone', async () => {
    expect((await act(cyc.main, 'acknowledge', c.mgr)).statusCode).toBe(403);
    expect((await act(cyc.main, 'acknowledge', c.chr)).statusCode).toBe(403);
    expect((await act(cyc.main, 'acknowledge', c.sen2)).statusCode).toBe(404);
  });

  it('lets the employee dispute with a comment, which sends the sheet back for revision', async () => {
    expect((await act(cyc.main, 'dispute', c.sen)).json().error).toBe('SENIOR_COMMENT_REQUIRED');
    expect((await act(cyc.main, 'dispute', c.sen, 'Q2 rejection target is not achievable with the new die set')).json().state).toBe('GOALS_DRAFT');
    expect((await env.put(`/senior/cycles/${cyc.main}/goals`, GOALS, c.mgr)).statusCode).toBe(200);
    expect((await act(cyc.main, 'issue', c.mgr)).statusCode).toBe(200);
    expect((await detail(cyc.main, c.mgr)).cycle.goalVersion).toBe(2);
  });

  it('records the timestamp and the version acknowledged', async () => {
    expect((await act(cyc.main, 'acknowledge', c.sen)).json().state).toBe('ACKNOWLEDGED');
    const d = await detail(cyc.main, c.sen);
    expect(d.cycle).toMatchObject({ state: 'ACKNOWLEDGED', acknowledgedVersion: 2 });
    expect(d.cycle.acknowledgedAt).toBeTruthy();
    expect((await act(cyc.main, 'acknowledge', c.sen)).statusCode).toBe(409); // cannot acknowledge twice
  });
});

describe('monthly results, scoring and roll-up', () => {
  it('lets only the manager enter results', async () => {
    expect((await enter(cyc.main, '2026-04', [84, 4.75, 4], c.sen)).statusCode).toBe(403);
    expect((await enter(cyc.main, '2026-04', [84, 4.75, 4], c.chr)).statusCode).toBe(403);
    expect((await enter(cyc.main, '2026-04', [84, 4.75, 4], c.rev)).statusCode).toBe(403);
    expect((await enter(cyc.main, '2026-04', [84, 4.75, 4], c.mgr2)).statusCode).toBe(404);
  });

  it('validates the period, the unit rules, and N/A reasons', async () => {
    expect((await enter(cyc.main, '2025-12', [84, 4.75, 4])).statusCode).toBe(400); // outside FY 2026
    expect((await enter(cyc.main, '2026-4', [84, 4.75, 4])).statusCode).toBe(400);
    const r = await enter(cyc.main, '2026-04', [120, 4.75, 4]); // a percentage cannot exceed 100
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/percentage/);
    const ids = await kpiIds(cyc.main, c.mgr);
    const both = await env.put(`/senior/cycles/${cyc.main}/results/2026-04`, { results: [{ kpiId: ids.Rejection, result: 4, naReason: 'x' }] }, c.mgr);
    expect(both.statusCode).toBe(400);
  });

  it('will not confirm a month with a KPI that has neither a result nor an N/A reason', async () => {
    expect((await confirm(cyc.main, '2026-04')).json().error).toBe('SENIOR_NO_RESULTS');
    expect((await enter(cyc.main, '2026-04', [84, null, 4])).statusCode).toBe(200);
    const r = await confirm(cyc.main, '2026-04');
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: 'SENIOR_INCOMPLETE' });
    expect(r.json().message).toMatch(/Rejection/);
  });

  it('scores a confirmed month with the existing formula (KPI -> KRA -> total)', async () => {
    expect((await enter(cyc.main, '2026-04', [84, 4.75, 4])).statusCode).toBe(200);
    // Before confirmation the manager sees a live preview, flagged as DRAFT.
    const preview = (await detail(cyc.main, c.mgr)).months.find((m: { period: string }) => m.period === '2026-04');
    expect(preview).toMatchObject({ state: 'DRAFT', total: 78 });

    expect((await confirm(cyc.main, '2026-04')).json()).toEqual({ total: 78 });
    const m = (await detail(cyc.main, c.sen)).months.find((x: { period: string }) => x.period === '2026-04');
    expect(m.state).toBe('CONFIRMED');
    expect(m.kpis.map((k: { score: number }) => k.score)).toEqual([100, 80, 60]);
    expect(m.kras.map((k: { score: number }) => k.score)).toEqual([90, 60]);
    expect(m.total).toBe(78);

    // The official calculation records exactly what produced it.
    const row = (await env.pool.query("SELECT params, engine_version, input_hash FROM core.senior_month WHERE cycle_id = $1 AND period = '2026-04'", [cyc.main])).rows[0];
    expect(row.params).toMatchObject({ baseScoreB: 60, cap: 120 });
    expect(row.input_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('makes a confirmed month immutable, through the API and in the database', async () => {
    expect((await enter(cyc.main, '2026-04', [90, 4.75, 4])).json().error).toBe('SENIOR_MONTH_CONFIRMED');
    expect((await confirm(cyc.main, '2026-04')).json().error).toBe('SENIOR_MONTH_CONFIRMED');
    await expect(env.pool.query("UPDATE core.senior_result SET result = 99 WHERE cycle_id = $1 AND period = '2026-04'", [cyc.main])).rejects.toThrow(/LOCKED/);
    await expect(env.pool.query("UPDATE core.senior_month SET total_score = 100 WHERE cycle_id = $1 AND period = '2026-04'", [cyc.main])).rejects.toThrow(/LOCKED/);
  });

  it('applies the cap, N/A renormalisation and the quarterly target', async () => {
    expect((await enter(cyc.main, '2026-05', [86, 4.5, 3])).statusCode).toBe(200); // productivity capped at 120
    expect((await confirm(cyc.main, '2026-05')).json()).toEqual({ total: 106 });
    expect((await enter(cyc.main, '2026-06', [84, 4.75, 3.5])).statusCode).toBe(200);
    expect((await confirm(cyc.main, '2026-06')).json()).toEqual({ total: 86 });

    // July is in Q2, so the Q2 targets (86 / 4 / 2) apply: hitting them scores 100.
    expect((await enter(cyc.main, '2026-07', [86, 4, 2])).statusCode).toBe(200);
    expect((await confirm(cyc.main, '2026-07')).json()).toEqual({ total: 100 });
    const july = (await detail(cyc.main, c.mgr)).months.find((m: { period: string }) => m.period === '2026-07');
    expect(july.kpis.map((k: { target: number }) => k.target)).toEqual([86, 4, 2]);

    // A month with an N/A KPI: the remaining KPIs carry the KRA (renormalised), nothing is scored zero.
    const ids = await kpiIds(cyc.main, c.mgr);
    await env.put(
      `/senior/cycles/${cyc.main}/results/2026-08`,
      { results: [{ kpiId: ids.Productivity, result: 86 }, { kpiId: ids.Rejection, naReason: 'no rejections measured: line shut' }, { kpiId: ids['Unsafe conditions'], result: 2 }] },
      c.mgr,
    );
    expect((await confirm(cyc.main, '2026-08')).json()).toEqual({ total: 100 });
  });

  it('rolls confirmed months up into quarters and the year, per KRA as well', async () => {
    const d = await detail(cyc.main, c.sen);
    const q = d.rollup.total.quarters;
    expect(q[0]).toMatchObject({ quarter: 1, score: 90, monthsCounted: 3 }); // (78 + 106 + 86) / 3
    expect(q[1]).toMatchObject({ quarter: 2, score: 100, monthsCounted: 2 }); // July and August
    expect(q[2].score).toBeNull();
    expect(d.rollup.total.year).toEqual({ score: 95, quartersCounted: 2 });
    expect(d.score).toBe(95);
    expect(d.band).toMatchObject({ code: 'EXCEEDS' });
    expect(d.provisional).toBe(true);
    const [delivery, safety] = d.goals.kras.map((k: { id: string }) => k.id);
    expect(d.rollup.kras[delivery].quarters[0].score).toBe(96.67); // KRA scores 90, 110, 90
    expect(d.rollup.kras[safety].quarters[0].score).toBe(80); // KRA scores 60, 100, 80
  });

  it('excludes a month that is still a draft from the roll-up instead of scoring it zero', async () => {
    const ids = await kpiIds(cyc.main, c.mgr);
    await env.put(`/senior/cycles/${cyc.main}/results/2026-09`, { results: [{ kpiId: ids.Productivity, result: 10 }] }, c.mgr);
    const d = await detail(cyc.main, c.mgr);
    expect(d.rollup.total.year.score).toBe(95);
    expect(d.rollup.total.quarters[1].monthsCounted).toBe(2);
  });
});

describe('year-end appraisal: self -> manager -> reviewer -> Corporate HR', () => {
  it('is opened by Corporate HR only, once the sheet is acknowledged', async () => {
    expect((await act(cyc.main, 'open_appraisal', c.mgr)).statusCode).toBe(403);
    expect((await act(cyc.main, 'open_appraisal', c.sen)).statusCode).toBe(403);
    expect((await act(cyc.main, 'open_appraisal', c.chr)).json().state).toBe('SELF_ASSESSMENT');
    expect((await act(cyc.main, 'open_appraisal', c.chr)).statusCode).toBe(409);
  });

  it('lets the employee write and submit a self-assessment, and locks it after submission', async () => {
    const d = await detail(cyc.main, c.sen);
    expect(d.viewer.assessmentStage).toBe('SELF');
    expect((await assess(cyc.main, c.mgr, 'x')).statusCode).toBe(409); // not the manager's turn
    expect((await assess(cyc.main, c.sen2, 'x')).statusCode).toBe(404);
    expect((await act(cyc.main, 'submit_self', c.sen)).json().error).toBe('SENIOR_ASSESSMENT_REQUIRED');

    const delivery = d.goals.kras[0].id;
    expect((await assess(cyc.main, c.sen, 'Delivered on target in Q2.', { [delivery]: 'Cleared the backlog from Q1.' })).statusCode).toBe(200);
    expect((await assess(cyc.main, c.sen, 'Delivered on target in Q2.', { nope: 'x' })).statusCode).toBe(400);
    expect((await act(cyc.main, 'submit_self', c.mgr)).statusCode).toBe(403);
    expect((await act(cyc.main, 'submit_self', c.sen)).json().state).toBe('MANAGER_ASSESSMENT');
    expect((await assess(cyc.main, c.sen, 'Changed my mind')).statusCode).toBe(409);
  });

  it('keeps the manager assessment private from the employee until finalisation', async () => {
    expect((await enter(cyc.main, '2026-09', [86, 4, 2])).statusCode).toBe(200); // late data entry is still allowed here
    expect((await assess(cyc.main, c.mgr, 'Strong delivery; safety follow-up needed.')).statusCode).toBe(200);
    expect((await detail(cyc.main, c.sen)).assessments.map((a: { stage: string }) => a.stage)).toEqual(['SELF']);
    expect((await detail(cyc.main, c.mgr)).assessments.map((a: { stage: string }) => a.stage).sort()).toEqual(['MANAGER', 'SELF']);
    expect((await detail(cyc.main, c.rev)).assessments).toHaveLength(2);
  });

  it('sends back with a mandatory comment, reopens the assessment, and counts the revision', async () => {
    expect((await act(cyc.main, 'send_back', c.mgr)).json().error).toBe('SENIOR_COMMENT_REQUIRED');
    expect((await act(cyc.main, 'send_back', c.mgr, 'Please quantify the backlog')).json().state).toBe('SELF_ASSESSMENT');
    const d = await detail(cyc.main, c.sen);
    expect(d.cycle.revision).toBe(2);
    expect(d.assessments[0].submittedAt).toBeNull();
    // The employee sees the comment addressed to them.
    expect(d.events.at(-1)).toMatchObject({ toState: 'SELF_ASSESSMENT', comment: 'Please quantify the backlog' });

    expect((await assess(cyc.main, c.sen, 'Cleared a backlog of 140 orders.')).statusCode).toBe(200);
    expect((await act(cyc.main, 'submit_self', c.sen)).json().state).toBe('MANAGER_ASSESSMENT');
    expect((await act(cyc.main, 'submit_manager', c.sen)).statusCode).toBe(403);
    expect((await act(cyc.main, 'submit_manager', c.mgr)).json().state).toBe('REVIEWER_REVIEW');
  });

  it('freezes monthly results once the manager has submitted, in the API and in the database', async () => {
    expect((await enter(cyc.main, '2026-10', [86, 4, 2])).json().error).toBe('SENIOR_NOT_EDITABLE');
    await expect(env.pool.query("UPDATE core.senior_result SET result = 1 WHERE cycle_id = $1 AND period = '2026-09'", [cyc.main])).rejects.toThrow(/LOCKED/);
  });

  it('gives sign-off to the assigned reviewer only, and lets them send back to the manager', async () => {
    expect((await act(cyc.main, 'sign_off', c.rev2)).statusCode).toBe(404); // not the assigned reviewer
    expect((await act(cyc.main, 'sign_off', c.mgr)).statusCode).toBe(403);
    expect((await act(cyc.main, 'sign_off', c.chr)).statusCode).toBe(403);
    expect((await act(cyc.main, 'send_back', c.rev, 'Safety comment needs an action plan')).json().state).toBe('MANAGER_ASSESSMENT');

    // The reviewer's comment is for the review chain; the employee does not see it before finalisation.
    const asEmployee = await detail(cyc.main, c.sen);
    expect(asEmployee.events.at(-1)).toMatchObject({ toState: 'MANAGER_ASSESSMENT', comment: null });
    expect((await detail(cyc.main, c.mgr)).events.at(-1).comment).toBe('Safety comment needs an action plan');

    expect((await assess(cyc.main, c.mgr, 'Strong delivery. Safety action plan: two-person audit every shift.')).statusCode).toBe(200);
    expect((await act(cyc.main, 'submit_manager', c.mgr)).json().state).toBe('REVIEWER_REVIEW');
    expect((await act(cyc.main, 'sign_off', c.rev, 'Agreed')).json().state).toBe('HR_FINALISATION');
  });

  it('lets Corporate HR send back to the reviewer, then finalise with the score mapped to a rating band', async () => {
    for (const cookie of [c.sen, c.mgr, c.rev, c.chrH]) expect((await act(cyc.main, 'finalise', cookie)).statusCode).toBe(403);
    expect((await act(cyc.main, 'send_back', c.chr)).json().error).toBe('SENIOR_COMMENT_REQUIRED');
    expect((await act(cyc.main, 'send_back', c.chr, 'Reviewer to confirm the Q2 safety note')).json().state).toBe('REVIEWER_REVIEW');
    expect((await act(cyc.main, 'sign_off', c.rev)).json().state).toBe('HR_FINALISATION');

    expect((await act(cyc.main, 'finalise', c.chr, 'Finalised')).json().state).toBe('FINALISED');
    const d = await detail(cyc.main, c.chr);
    expect(d.cycle.final).toMatchObject({ score: 95, band: { code: 'EXCEEDS', label: 'Exceeds expectations' } });
    expect(d.cycle.final.finalisedAt).toBeTruthy();
    expect(d.provisional).toBe(false);
  });

  it('records every step, in order, with who did it and why', async () => {
    const d = await detail(cyc.main, c.chr);
    expect(d.events.map((e: { toState: string }) => e.toState)).toEqual([
      'PENDING_ACK', 'GOALS_DRAFT', 'PENDING_ACK', 'ACKNOWLEDGED', 'SELF_ASSESSMENT', 'MANAGER_ASSESSMENT', 'SELF_ASSESSMENT',
      'MANAGER_ASSESSMENT', 'REVIEWER_REVIEW', 'MANAGER_ASSESSMENT', 'REVIEWER_REVIEW', 'HR_FINALISATION', 'REVIEWER_REVIEW',
      'HR_FINALISATION', 'FINALISED',
    ]);
    expect(d.events[1]).toMatchObject({ actor: 'Test E3010', comment: 'Q2 rejection target is not achievable with the new die set' });
    expect(d.events.at(-1)).toMatchObject({ actor: 'Test E3001', comment: 'Finalised' });
  });
});

describe('locked after finalisation', () => {
  it('refuses every further action through the API', async () => {
    for (const action of ['issue', 'acknowledge', 'open_appraisal', 'submit_self', 'submit_manager', 'sign_off', 'finalise']) {
      expect((await act(cyc.main, action, c.chr)).statusCode).toBe(409);
    }
    expect((await act(cyc.main, 'send_back', c.chr, 'again')).statusCode).toBe(409);
    expect((await env.put(`/senior/cycles/${cyc.main}/goals`, GOALS, c.chr)).statusCode).toBe(409);
    expect((await enter(cyc.main, '2026-11', [86, 4, 2])).json().error).toBe('SENIOR_NOT_EDITABLE');
    expect((await assess(cyc.main, c.mgr, 'late edit')).statusCode).toBe(409);
  });

  it('refuses every further change in the database, whoever runs the SQL', async () => {
    const q = (sql: string) => env.pool.query(sql, [cyc.main]);
    await expect(q("UPDATE core.senior_cycle SET final_score = 120 WHERE id = $1")).rejects.toThrow(/LOCKED/);
    await expect(q("UPDATE core.senior_cycle SET state = 'HR_FINALISATION', finalised_at = NULL WHERE id = $1")).rejects.toThrow(/LOCKED/);
    await expect(q("UPDATE core.senior_assessment SET summary = 'edited' WHERE cycle_id = $1")).rejects.toThrow(/LOCKED/);
    await expect(q('UPDATE core.senior_kra SET weight = 55 WHERE cycle_id = $1')).rejects.toThrow(/LOCKED/);
    await expect(q("UPDATE core.senior_result SET result = 1 WHERE cycle_id = $1 AND period = '2026-09'")).rejects.toThrow(/LOCKED/);
    await expect(q("INSERT INTO core.senior_month (cycle_id, period) SELECT $1::uuid, '2026-12'")).rejects.toThrow(/LOCKED/);
  });

  it('shows the employee the full result once finalised, and a rating that later band edits cannot change', async () => {
    const d = await detail(cyc.main, c.sen);
    expect(d.assessments.map((a: { stage: string }) => a.stage).sort()).toEqual(['MANAGER', 'SELF']);
    expect(d.events.find((e: { comment: string | null }) => e.comment === 'Safety comment needs an action plan')).toBeTruthy();
    expect(d.cycle.final.band.code).toBe('EXCEEDS');

    await env.pool.query("UPDATE core.rating_band SET min_score = 99 WHERE code = 'EXCEEDS'");
    const after = await detail(cyc.main, c.sen);
    expect(after.cycle.final).toMatchObject({ score: 95, band: { code: 'EXCEEDS' } });
    await env.pool.query("UPDATE core.rating_band SET min_score = 95 WHERE code = 'EXCEEDS'");
  });
});

describe('separation of duties and finalisation guards', () => {
  it('does not let the reviewer finalise their own sign-off, even though they also hold Corporate HR', async () => {
    const res = await newCycle('E3017', 'E3011', 'E3018');
    expect(res.statusCode).toBe(201);
    cyc.sod = res.json().id;
    await acknowledged(cyc.sod, c.mgr, c.sen3);
    expect((await enter(cyc.sod, '2026-04', [84, 4.75, 4])).statusCode).toBe(200);
    expect((await confirm(cyc.sod, '2026-04')).statusCode).toBe(200);
    await toHrFinalisation(cyc.sod, { mgr: c.mgr, employee: c.sen3, reviewer: c.revChr });

    const blocked = await act(cyc.sod, 'finalise', c.revChr);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatch(/^SOD:/);
    expect((await detail(cyc.sod, c.chr)).cycle.state).toBe('HR_FINALISATION');
    expect((await act(cyc.sod, 'finalise', c.chr)).json().state).toBe('FINALISED');
    expect((await detail(cyc.sod, c.chr)).cycle.final).toMatchObject({ score: 78, band: { code: 'NEEDS_IMPR' } });
  });

  it('will not finalise a cycle that has no confirmed month', async () => {
    const res = await newCycle('E3014', 'E3013', 'E3016');
    expect(res.statusCode).toBe(201);
    cyc.empty = res.json().id;
    await acknowledged(cyc.empty, c.mgr2, c.sen2);
    await toHrFinalisation(cyc.empty, { mgr: c.mgr2, employee: c.sen2, reviewer: c.rev2 });
    const r = await act(cyc.empty, 'finalise', c.chr);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('SENIOR_NO_SCORES');
  });
});

describe('screens: lists for employee, manager, reviewer and HR', () => {
  const list = async (query: string, cookie?: string) => env.get(`/senior/cycles?${query}`, cookie);
  const ids = async (query: string, cookie: string | undefined) => ((await list(query, cookie)).json().cycles as { id: string }[]).map((x) => x.id).sort();

  it('shows each person only their own part: my goals, team view, review queue', async () => {
    expect(await ids('view=mine', c.sen)).toEqual([cyc.main]);
    expect(await ids('view=mine', c.sen2)).toEqual([cyc.empty]);
    expect(await ids('view=team', c.mgr)).toEqual([cyc.main, cyc.sod].sort());
    expect(await ids('view=team', c.mgr2)).toEqual([cyc.empty]);
    expect(await ids('view=review', c.rev)).toEqual([cyc.main]);
    expect(await ids('view=review', c.rev2)).toEqual([cyc.empty]);
  });

  it('gives Corporate HR (and Management, read-only) the company-wide status board, with filters', async () => {
    const all = (await list('view=all', c.chr)).json().cycles as { id: string; state: string; pendingOn: string; provisional: boolean; score: number | null; band: { code: string } | null }[];
    expect(all.map((x) => x.id).sort()).toEqual([cyc.main, cyc.sod, cyc.empty].sort());
    expect(await ids('view=all', c.chrH)).toEqual(all.map((x) => x.id).sort());
    expect(await ids('view=all&state=FINALISED', c.chr)).toEqual([cyc.main, cyc.sod].sort());
    expect(await ids('view=all&fy=2025', c.chr)).toEqual([]);
    const empty = all.find((x) => x.id === cyc.empty)!;
    expect(empty).toMatchObject({ state: 'HR_FINALISATION', pendingOn: 'Corporate HR', provisional: true, score: null, band: null });
    expect(all.find((x) => x.id === cyc.main)).toMatchObject({ state: 'FINALISED', provisional: false, score: 95, band: { code: 'EXCEEDS' } });
  });

  it('shows a provisional score and band for a cycle that is still in progress', async () => {
    const res = await newCycle('E3010', 'E3011', 'E3012', 2027);
    expect(res.statusCode).toBe(201);
    const row = ((await list('view=mine&fy=2027', c.sen)).json().cycles as { score: number | null; provisional: boolean; state: string }[])[0];
    expect(row).toMatchObject({ state: 'GOALS_DRAFT', score: null, provisional: true });
  });

  it('keeps each view to the people who hold that role', async () => {
    expect((await list('view=all', c.mgr)).statusCode).toBe(403);
    expect((await list('view=all', c.sen)).statusCode).toBe(403);
    expect((await list('view=team', c.sen)).statusCode).toBe(403);
    expect((await list('view=review', c.sen)).statusCode).toBe(403); // an Employee reviews nobody
    expect((await list('view=mine', c.mgr)).statusCode).toBe(403); // an HOD has no goal sheet of their own here
    expect((await list('view=review', c.mgr)).statusCode).toBe(200); // but any HOD may be assigned as a reviewer
    expect((await list('view=mine', c.chr)).statusCode).toBe(403);
    expect((await list('view=bogus', c.chr)).statusCode).toBe(400);
    expect((await list('view=mine')).statusCode).toBe(401);
  });

  it('serves the people and configuration the screens need', async () => {
    const people = (await env.get('/senior/people', c.chr)).json();
    expect(people.employees.map((p: { employeeCode: string }) => p.employeeCode)).toEqual(expect.arrayContaining(['E3010', 'E3014']));
    expect(people.managers.map((p: { employeeCode: string }) => p.employeeCode)).toContain('E3011');
    expect(people.reviewers.map((p: { employeeCode: string }) => p.employeeCode)).toContain('E3012');
    expect((await env.get('/senior/people', c.mgr)).statusCode).toBe(403);

    const cfg = (await env.get('/senior/config', c.sen)).json();
    expect(cfg.params).toMatchObject({ baseScoreB: 60, cap: 120 });
    expect(cfg.bands.map((b: { code: string }) => b.code)).toEqual(['OUTSTANDING', 'EXCEEDS', 'MEETS', 'NEEDS_IMPR', 'UNSATISFACT']);
  });
});

describe('anchored on the appraisal (employee, fiscal year and reviewer live there)', () => {
  const appraisalId = async (cycleId: string) =>
    (await env.pool.query('SELECT appraisal_id AS id FROM core.senior_cycle WHERE id = $1', [cycleId])).rows[0].id as string;

  it('reuses an existing appraisal and its reviewer instead of creating a second record', async () => {
    const ap = await env.post('/appraisals', { employeeCode: 'E3014', fiscalYear: 2024, reviewerLoginId: 'E3012' }, c.chr);
    expect(ap.statusCode).toBe(201);
    const res = await env.post('/senior/cycles', { employeeId: emp.E3014, fiscalYear: 2024, managerUserId: env.ids.E3011 }, c.chr); // no reviewer given
    expect(res.statusCode).toBe(201);
    cyc.anchored = res.json().id;
    expect(await appraisalId(cyc.anchored)).toBe(ap.json().id);
    const n = await env.pool.query("SELECT count(*)::int AS n FROM core.appraisal WHERE employee_id = $1 AND fiscal_year = 2024", [emp.E3014]);
    expect(n.rows[0].n).toBe(1);
    expect((await detail(cyc.anchored, c.chr)).cycle.reviewer.name).toBe('Test E3012');
  });

  it('needs a reviewer on the appraisal before a goal sheet can start', async () => {
    expect((await env.post('/appraisals', { employeeCode: 'E3017', fiscalYear: 2023 }, c.chr)).statusCode).toBe(201); // no reviewer yet
    const res = await env.post('/senior/cycles', { employeeId: emp.E3017, fiscalYear: 2023, managerUserId: env.ids.E3011 }, c.chr);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/^WORKFLOW:/);
  });

  it('follows a reviewer reassignment made on the Appraisals screen, and still refuses the manager as sign-off', async () => {
    const id = await appraisalId(cyc.anchored);
    expect((await env.put(`/appraisals/${id}/reviewer`, { reviewerLoginId: 'E3016' }, c.chr)).statusCode).toBe(200);
    expect((await env.get('/senior/cycles?view=review&fy=2024', c.rev2)).json().cycles).toHaveLength(1);
    expect((await env.get('/senior/cycles?view=review&fy=2024', c.rev)).json().cycles).toHaveLength(0);

    await acknowledged(cyc.anchored, c.mgr, c.sen2);
    expect((await act(cyc.anchored, 'open_appraisal', c.chr)).statusCode).toBe(200);
    expect((await assess(cyc.anchored, c.sen2, 'Year summary')).statusCode).toBe(200);
    expect((await act(cyc.anchored, 'submit_self', c.sen2)).statusCode).toBe(200);
    expect((await assess(cyc.anchored, c.mgr, 'Manager summary')).statusCode).toBe(200);
    expect((await act(cyc.anchored, 'submit_manager', c.mgr)).statusCode).toBe(200);

    // Reassign the reviewer to the cycle's own manager (an HOD is a valid reviewer): the sign-off itself must be refused.
    expect((await env.put(`/appraisals/${id}/reviewer`, { reviewerLoginId: 'E3011' }, c.chr)).statusCode).toBe(200);
    const blocked = await act(cyc.anchored, 'sign_off', c.mgr);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatch(/^SOD:/);
    expect((await detail(cyc.anchored, c.chr)).cycle.state).toBe('REVIEWER_REVIEW');
  });

  it('refuses to reassign the reviewer once the appraisal is finalised', async () => {
    const res = await env.put(`/appraisals/${await appraisalId(cyc.main)}/reviewer`, { reviewerLoginId: 'E3016' }, c.chr);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/^LOCKED:/);
  });
});

describe('year score from unrounded quarter scores', () => {
  it('rounds once at the end: quarters of 89.33 and 100 give 94.67, not 94.66', async () => {
    const res = await newCycle('E3010', 'E3011', 'E3012', 2025);
    expect(res.statusCode).toBe(201);
    cyc.rounding = res.json().id;
    await acknowledged(cyc.rounding);
    const ids = await kpiIds(cyc.rounding, c.chr);
    expect((await enter(cyc.rounding, '2025-04', [84, 4.75, 4])).statusCode).toBe(200); // 78
    expect((await enter(cyc.rounding, '2025-05', [86, 4.5, 3])).statusCode).toBe(200); // 106
    await env.put(
      `/senior/cycles/${cyc.rounding}/results/2025-06`,
      { results: [{ kpiId: ids.Productivity, result: 84 }, { kpiId: ids.Rejection, naReason: 'not measured' }, { kpiId: ids['Unsafe conditions'], result: 4 }] },
      c.mgr,
    ); // 84
    expect((await enter(cyc.rounding, '2025-07', [86, 4, 2])).statusCode).toBe(200); // 100 (Q2 targets)
    for (const p of ['2025-04', '2025-05', '2025-06', '2025-07']) expect((await confirm(cyc.rounding, p)).statusCode).toBe(200);

    const d = await detail(cyc.rounding, c.mgr);
    expect(d.rollup.total.quarters[0]).toMatchObject({ score: 89.33, monthsCounted: 3 });
    expect(d.rollup.total.quarters[1]).toMatchObject({ score: 100, monthsCounted: 1 });
    expect(d.rollup.total.year.score).toBe(94.67);
    expect(d.band).toMatchObject({ code: 'MEETS' });
  });
});

describe('audit', () => {
  it('logs the whole track in the hash-chained audit log, and the chain still verifies', async () => {
    const actions = new Set((await env.pool.query("SELECT DISTINCT action FROM core.audit_log WHERE action LIKE 'SENIOR_%'")).rows.map((r) => r.action));
    for (const a of [
      'SENIOR_CYCLE_CREATED', 'SENIOR_GOALS_SAVED', 'SENIOR_ISSUE', 'SENIOR_ACKNOWLEDGE', 'SENIOR_DISPUTE', 'SENIOR_RESULTS_SAVED',
      'SENIOR_MONTH_CONFIRMED', 'SENIOR_OPEN_APPRAISAL', 'SENIOR_ASSESSMENT_SAVED', 'SENIOR_SUBMIT_SELF', 'SENIOR_SUBMIT_MANAGER',
      'SENIOR_SEND_BACK', 'SENIOR_SIGN_OFF', 'SENIOR_FINALISE',
    ]) {
      expect(actions, a).toContain(a);
    }
    const fin = (await env.pool.query("SELECT actor_id, before, after FROM core.audit_log WHERE action = 'SENIOR_FINALISE' AND entity_id = $1", [cyc.main])).rows[0];
    expect(fin.actor_id).toBe(env.ids.E3001);
    expect(fin.before).toEqual({ state: 'HR_FINALISATION' });
    expect(fin.after).toMatchObject({ state: 'FINALISED' });
    expect(await verifyAuditChain(env.pool)).toBeNull();
  });
});
