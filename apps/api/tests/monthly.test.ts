import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';

/**
 * Worked month used throughout (Forge, B = 60, FY 2026 Q1 targets, period 2026-05):
 *   Productivity  PL 82 target 84  result 84   -> 100
 *   Rejection     PL 5  target 4.5 result 4.75 ->  80   (60 + 40 * (-0.25 / -0.5))
 *   Unsafe        PL 4  target 3   result 4    ->  60   (60 + 40 * (0 / -1))
 *   Level weights  HOD 50/30/20 -> 86.00   SHIFT_INCHARGE 40/30/30 -> 82.00   SUPERVISOR 30/40/30 -> 80.00
 */
let env: TestEnv;
const c: Record<string, string | undefined> = {};
const sub: Record<string, string> = {};
const emp: Record<string, string> = {};

const KRAS = [
  { nameEn: 'Productivity', pqcdsm: 'P', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 82, targets: [84, 86, 88, 90], weights: { HOD: 50, SHIFT_INCHARGE: 40, SUPERVISOR: 30 } },
  { nameEn: 'Rejection', pqcdsm: 'Q', direction: 'LOWER_BETTER', unit: '%', presentLevel: 5, targets: [4.5, 4, 3.5, 3], weights: { HOD: 30, SHIFT_INCHARGE: 30, SUPERVISOR: 40 } },
  { nameEn: 'Unsafe conditions', pqcdsm: 'S', direction: 'LOWER_BETTER', unit: 'count', presentLevel: 4, targets: [3, 2, 1, 0], weights: { HOD: 20, SHIFT_INCHARGE: 30, SUPERVISOR: 30 } },
];

async function addEmployee(code: string, name: string, stints: [unitId: string, from: string, to: string | null][]) {
  const e = await env.pool.query('INSERT INTO core.employee (employee_code, full_name) VALUES ($1,$2) RETURNING id', [code, name]);
  const cat = (await env.pool.query("SELECT id FROM core.employee_category WHERE code = 'PERMANENT_WORKER'")).rows[0].id;
  for (const [unit, from, to] of stints) {
    await env.pool.query("INSERT INTO core.employee_assignment (employee_id, org_unit_id, category_id, valid) VALUES ($1,$2,$3, daterange($4::date, $5::date, '[)'))", [e.rows[0].id, unit, cat, from, to]);
  }
  emp[code] = e.rows[0].id;
}

const detail = async (id: string, cookie = c.phr1) => (await env.get(`/submissions/${id}`, cookie)).json();
const kraIds = async (id: string) => (await detail(id)).results.map((r: { kraId: string }) => r.kraId) as string[];
const act = (id: string, action: string, cookie: string | undefined, extra: object = {}) => env.post(`/submissions/${id}/transitions`, { action, ...extra }, cookie);
const enter = async (id: string, values: (number | null)[], cookie = c.phr1) => {
  const ids = await kraIds(id);
  return env.put(`/submissions/${id}/results`, { results: ids.map((kraId, i) => ({ kraId, result: values[i] })) }, cookie);
};

beforeAll(async () => {
  env = await setupEnv();
  const { ids, pool } = env;
  ids.d1b = (await pool.query("INSERT INTO core.org_unit (parent_id, unit_type, code, name) VALUES ($1,'DEPARTMENT','P1-PRESS','Press Shop') RETURNING id", [ids.p1])).rows[0].id;
  for (const [code, rank] of [['HOD', 1], ['SHIFT_INCHARGE', 2], ['SUPERVISOR', 3]] as const) {
    await pool.query('INSERT INTO core.people_level (plant_type_id, code, name_en, rank) VALUES ($1,$2,$2,$3)', [ids.forge, code, rank]);
  }

  await env.user('E1002', 'PHR', 'PLANT', ids.p1);
  await env.user('E1003', 'CHR');
  await env.user('E1004', 'CHR'); // second Corporate HR user: approves what E1003 authors
  await env.user('E1005', 'PH', 'PLANT', ids.p1);
  await env.user('E1007', 'HOD', 'DEPARTMENT', ids.d1);
  await env.user('E1008', 'HOD', 'DEPARTMENT', ids.d1b);
  await env.user('E1009', 'PHR', 'PLANT', ids.p2);
  await env.user('E1010', 'PHR', 'PLANT', ids.p1); // also HOD of the Press Shop: the segregation-of-duties trap
  await env.assign(ids.E1010, 'HOD', 'DEPARTMENT', ids.d1b);
  for (const [key, code] of [['phr1', 'E1002'], ['chr', 'E1003'], ['chrH', 'E1004'], ['ph', 'E1005'], ['hod1', 'E1007'], ['hod1b', 'E1008'], ['phr2', 'E1009'], ['dual', 'E1010']]) {
    c[key] = (await env.loginAs(code)).cookie;
  }

  await addEmployee('EMP-A', 'Asha', [[ids.d1, '2026-01-01', null]]);
  await addEmployee('EMP-B', 'Babu', [[ids.d1, '2026-01-01', null]]);
  await addEmployee('EMP-C', 'Chitra', [[ids.d1, '2026-01-01', '2026-05-21'], [ids.d1b, '2026-05-21', null]]);
  await addEmployee('EMP-X', 'Outsider', [[ids.d2, '2026-01-01', null]]);

  // An active Forge template.
  const t = (await env.post('/templates', { plantTypeId: ids.forge, name: 'Forge standard' }, c.chr)).json().id;
  await env.put(`/templates/${t}/kras`, { kras: KRAS }, c.chr);
  expect((await env.post(`/templates/${t}/activate`, {}, c.chrH)).statusCode).toBe(200);
});

afterAll(() => env.close());

describe('scorecards', () => {
  it('Plant HR creates a unit scorecard from the active template; duplicates and wrong units are refused', async () => {
    const created = await env.post('/scorecards', { orgUnitId: env.ids.d1, fiscalYear: 2026 }, c.phr1);
    expect(created.statusCode).toBe(201);
    sub.scorecardD1 = created.json().id;
    expect((await env.post('/scorecards', { orgUnitId: env.ids.d1, fiscalYear: 2026 }, c.phr1)).statusCode).toBe(409);
    expect((await env.post('/scorecards', { orgUnitId: env.ids.d2, fiscalYear: 2026 }, c.phr1)).statusCode).toBe(403);
    expect((await env.post('/scorecards', { orgUnitId: env.ids.p1, fiscalYear: 2026 }, c.phr1)).statusCode).toBe(400); // a plant is not a scoring unit
    expect((await env.post('/scorecards', { orgUnitId: env.ids.d1, fiscalYear: 2027 }, c.hod1)).statusCode).toBe(403);
    expect((await env.post('/scorecards', { orgUnitId: env.ids.d1b, fiscalYear: 2026 }, c.phr1)).statusCode).toBe(201);
  });

  it('a Machine plant scores CELL units and needs its own active template', async () => {
    const { pool, ids } = env;
    const mt = (await pool.query("INSERT INTO core.plant_type (code, name, scoring_unit_type) VALUES ('MACHINE','Machine','CELL') RETURNING id")).rows[0].id;
    const plant = (await pool.query("INSERT INTO core.org_unit (parent_id, unit_type, plant_type_id, code, name) VALUES ($1,'PLANT',$2,'P5','Plant 5') RETURNING id", [ids.company, mt])).rows[0].id;
    const dept = (await pool.query("INSERT INTO core.org_unit (parent_id, unit_type, code, name) VALUES ($1,'DEPARTMENT','P5-MS','Measuring') RETURNING id", [plant])).rows[0].id;
    const cell = (await pool.query("INSERT INTO core.org_unit (parent_id, unit_type, code, name) VALUES ($1,'CELL','P5-MAG','MAG cell') RETURNING id", [dept])).rows[0].id;
    expect((await env.post('/scorecards', { orgUnitId: dept, fiscalYear: 2026 }, c.chr)).statusCode).toBe(400);
    expect((await env.post('/scorecards', { orgUnitId: cell, fiscalYear: 2026 }, c.chr)).json().error).toBe('NO_ACTIVE_TEMPLATE');
  });

  it('shows the copied KRAs and weights to the HOD', async () => {
    const res = (await env.get(`/scorecards/${sub.scorecardD1}`, c.hod1)).json();
    expect(res.kras.map((k: { nameEn: string }) => k.nameEn)).toEqual(['Productivity', 'Rejection', 'Unsafe conditions']);
    expect(res.kras[1].weights).toEqual({ HOD: 30, SHIFT_INCHARGE: 30, SUPERVISOR: 40 });
    expect((await env.get(`/scorecards/${sub.scorecardD1}`, c.phr2)).statusCode).toBe(404);
  });
});

describe('data entry and validation', () => {
  it('creates a draft with target and present-level snapshots for the right quarter', async () => {
    const created = await env.post('/submissions', { orgUnitId: env.ids.d1, period: '2026-05' }, c.phr1);
    expect(created.statusCode).toBe(201);
    sub.d1 = created.json().id;
    const d = await detail(sub.d1);
    expect(d.submission).toMatchObject({ state: 'DRAFT', revision: 1, period: '2026-05' });
    expect(d.results.map((r: { target: number; presentLevel: number }) => [r.target, r.presentLevel])).toEqual([[84, 82], [4.5, 5], [3, 4]]); // Q1 = Apr-Jun
  });

  it('rejects duplicates, bad periods, missing scorecards and out-of-scope users', async () => {
    expect((await env.post('/submissions', { orgUnitId: env.ids.d1, period: '2026-05' }, c.phr1)).statusCode).toBe(409);
    expect((await env.post('/submissions', { orgUnitId: env.ids.d1, period: '2026-13' }, c.phr1)).statusCode).toBe(400);
    expect((await env.post('/submissions', { orgUnitId: env.ids.d1, period: '2027-05' }, c.phr1)).json().error).toBe('NO_SCORECARD');
    expect((await env.post('/submissions', { orgUnitId: env.ids.d1, period: '2026-06' }, c.hod1)).statusCode).toBe(403);
    expect((await env.post('/submissions', { orgUnitId: env.ids.d1, period: '2026-06' }, c.phr2)).statusCode).toBe(403);
  });

  it('validates units: percentages 0-100, counts whole numbers, result xor N/A reason', async () => {
    const [prod, , unsafe] = await kraIds(sub.d1);
    expect((await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: prod, result: 120 }] }, c.phr1)).statusCode).toBe(400);
    expect((await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: unsafe, result: 2.5 }] }, c.phr1)).statusCode).toBe(400);
    expect((await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: prod, result: 80, naReason: 'machine down' }] }, c.phr1)).statusCode).toBe(400);
    expect((await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: 'nope', result: 1 }] }, c.phr1)).statusCode).toBe(400);
  });

  it('only Plant HR of the plant enters data; other plants and the HOD cannot', async () => {
    const [prod] = await kraIds(sub.d1);
    expect((await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: prod, result: 84 }] }, c.hod1)).statusCode).toBe(403);
    expect((await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: prod, result: 84 }] }, c.phr2)).statusCode).toBe(404);
  });

  it('blocks submission while results are missing, then while an outlier has no comment', async () => {
    const missing = await act(sub.d1, 'submit', c.phr1);
    expect(missing.statusCode).toBe(422);
    expect(missing.json().issues.map((i: { code: string }) => i.code)).toEqual(['MISSING', 'MISSING', 'MISSING']);

    await enter(sub.d1, [84, 4.75, 20]); // 20 unsafe conditions against a present level of 4
    const outlier = await act(sub.d1, 'submit', c.phr1);
    expect(outlier.json().issues).toEqual([expect.objectContaining({ code: 'OUTLIER_NEEDS_COMMENT', kra: 'Unsafe conditions' })]);

    await enter(sub.d1, [84, 4.75, 4]); // corrected value; no longer an outlier
  });

  it('level assignments must match the unit, the month and the people levels', async () => {
    const put = (assignments: object[]) => env.put(`/submissions/${sub.d1}/level-assignments`, { assignments }, c.phr1);
    expect((await put([{ employeeId: emp['EMP-X'], levelCode: 'HOD', daysInUnit: 31 }])).statusCode).toBe(400); // works elsewhere
    expect((await put([{ employeeId: emp['EMP-A'], levelCode: 'HOD', daysInUnit: 32 }])).statusCode).toBe(400);
    expect((await put([{ employeeId: emp['EMP-A'], levelCode: 'CAPTAIN', daysInUnit: 10 }])).statusCode).toBe(400);
    expect((await put([{ employeeId: emp['EMP-A'], levelCode: 'HOD', daysInUnit: 10 }, { employeeId: emp['EMP-A'], levelCode: 'HOD', daysInUnit: 10 }])).statusCode).toBe(400);
    const ok = await put([
      { employeeId: emp['EMP-A'], levelCode: 'HOD', daysInUnit: 31 },
      { employeeId: emp['EMP-B'], levelCode: 'SHIFT_INCHARGE', daysInUnit: 31 },
      { employeeId: emp['EMP-C'], levelCode: 'SUPERVISOR', daysInUnit: 20 },
    ]);
    expect(ok.json()).toEqual({ saved: 3 });
  });

  it('previews level scores before submission, using the unofficial path', async () => {
    const p = (await env.get(`/submissions/${sub.d1}/preview`, c.phr1)).json();
    expect(p.official).toBe(false);
    expect(p.levels.map((l: { levelCode: string; score: number }) => [l.levelCode, l.score])).toEqual([['HOD', 86], ['SHIFT_INCHARGE', 82], ['SUPERVISOR', 80]]);
  });
});

describe('approval workflow: reject, resume, verify, approve, lock', () => {
  it('rejects out-of-order and unauthorised moves', async () => {
    expect((await act(sub.d1, 'verify', c.hod1)).json().error).toBe('WRONG_STATE'); // still a draft
    expect((await act(sub.d1, 'submit', c.hod1)).statusCode).toBe(403);
    expect((await act(sub.d1, 'launch', c.phr1)).statusCode).toBe(400);
    expect((await act(sub.d1, 'submit', c.phr2)).statusCode).toBe(404);
  });

  it('submit freezes the inputs in the API and in the database', async () => {
    const res = await act(sub.d1, 'submit', c.phr1, { revision: 1 });
    expect(res.json()).toEqual({ state: 'SUBMITTED', revision: 1 });
    const [prod] = await kraIds(sub.d1);
    expect((await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: prod, result: 83 }] }, c.phr1)).json().error).toBe('NOT_EDITABLE');
    await expect(env.pool.query('UPDATE core.monthly_result SET result = 1 WHERE submission_id = $1', [sub.d1])).rejects.toThrow(/LOCKED/);
  });

  it('a rejection needs a comment, returns to draft with a new revision, and can be resubmitted', async () => {
    expect((await act(sub.d1, 'reject', c.hod1)).statusCode).toBe(400);
    expect((await act(sub.d1, 'reject', c.hod1, { comment: 'Rejection rate looks wrong for shift B' })).json()).toEqual({ state: 'REJECTED', revision: 1 });
    expect((await act(sub.d1, 'resume', c.phr1)).json()).toEqual({ state: 'DRAFT', revision: 2 });
    expect((await act(sub.d1, 'submit', c.phr1, { revision: 1 })).json().error).toBe('STALE_REVISION');
    expect((await act(sub.d1, 'submit', c.phr1)).json()).toEqual({ state: 'SUBMITTED', revision: 2 });
  });

  it('verify, approve and lock go to the right roles, once each', async () => {
    expect((await act(sub.d1, 'verify', c.ph)).statusCode).toBe(403);
    expect((await act(sub.d1, 'verify', c.hod1)).json().state).toBe('VERIFIED');
    expect((await act(sub.d1, 'verify', c.hod1)).json().error).toBe('WRONG_STATE');
    expect((await act(sub.d1, 'approve', c.chr)).statusCode).toBe(403);
    expect((await act(sub.d1, 'approve', c.ph)).json().state).toBe('APPROVED');
    expect((await act(sub.d1, 'lock', c.ph)).statusCode).toBe(403);
    expect((await act(sub.d1, 'lock', c.chr)).json().state).toBe('LOCKED');
  });

  it('keeps a full timeline of who did what', async () => {
    const d = await detail(sub.d1, c.hod1);
    expect(d.events.map((e: { toState: string; actor: string }) => [e.toState, e.actor])).toEqual([
      ['SUBMITTED', 'E1002'],
      ['REJECTED', 'E1007'],
      ['DRAFT', 'E1002'],
      ['SUBMITTED', 'E1002'],
      ['VERIFIED', 'E1007'],
      ['APPROVED', 'E1005'],
      ['LOCKED', 'E1003'],
    ]);
    expect(d.events[1].comment).toBe('Rejection rate looks wrong for shift B');
  });
});

describe('official scores', () => {
  it('lock writes the official KRA, level and employee scores with a reproducible run record', async () => {
    const s = (await env.get(`/submissions/${sub.d1}/scores`, c.hod1)).json();
    expect(s.kras.map((k: { final: number }) => k.final)).toEqual([100, 80, 60]);
    expect(s.levels.map((l: { levelCode: string; score: number }) => [l.levelCode, l.score])).toEqual([['HOD', 86], ['SHIFT_INCHARGE', 82], ['SUPERVISOR', 80]]);
    expect(s.employees.map((e: { employeeCode: string; score: number; days: number }) => [e.employeeCode, e.score, e.days])).toEqual([['EMP-A', 86, 31], ['EMP-B', 82, 31], ['EMP-C', 80, 20]]);
    expect(s.run.params.baseScoreB).toBe(60);
    expect(s.run.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.run.engineVersion).toBe('1.0.0');
  });

  it('scores are visible only inside the caller scope', async () => {
    expect((await env.get(`/submissions/${sub.d1}/scores`, c.phr2)).statusCode).toBe(404);
    expect((await env.get(`/submissions/${sub.d1}/scores`, c.hod1b)).statusCode).toBe(404);
  });

  it('the database refuses to alter locked data or illegal transitions', async () => {
    await expect(env.pool.query("UPDATE core.calc_run SET input_hash = 'x' WHERE submission_id = $1", [sub.d1])).rejects.toThrow(/append-only/);
    await expect(env.pool.query('DELETE FROM core.kra_score')).rejects.toThrow(/append-only/);
    await expect(env.pool.query('UPDATE core.level_score SET score = 1')).rejects.toThrow(/append-only/);
    await expect(env.pool.query('DELETE FROM core.level_assignment WHERE submission_id = $1', [sub.d1])).rejects.toThrow(/LOCKED/);
    await expect(env.pool.query("UPDATE core.monthly_submission SET state = 'DRAFT' WHERE id = $1", [sub.d1])).rejects.toThrow(/WORKFLOW/);
    await expect(env.pool.query("UPDATE core.scorecard_kra SET present_level = 1")).rejects.toThrow(/append-only/);
  });
});

describe('segregation of duties and mid-month transfers', () => {
  it('one person who entered the data cannot also verify it, even with both roles', async () => {
    const created = await env.post('/submissions', { orgUnitId: env.ids.d1b, period: '2026-05' }, c.dual);
    sub.d1b = created.json().id;
    expect((await enter(sub.d1b, [84, 4.5, 3], c.dual)).statusCode).toBe(200); // all at target -> 100 everywhere
    const put = await env.put(`/submissions/${sub.d1b}/level-assignments`, { assignments: [{ employeeId: emp['EMP-C'], levelCode: 'SUPERVISOR', daysInUnit: 11 }] }, c.dual);
    expect(put.statusCode).toBe(200);
    expect((await act(sub.d1b, 'submit', c.dual)).json().state).toBe('SUBMITTED');

    const self = await act(sub.d1b, 'verify', c.dual);
    expect(self.statusCode).toBe(409);
    expect(self.json().error).toMatch(/^SOD:/);
    expect((await detail(sub.d1b, c.dual)).submission.state).toBe('SUBMITTED'); // the failed attempt changed nothing
  });

  it('a transferred employee has a partial month score until both units are locked, then a days-weighted one', async () => {
    const score = async () => (await env.get(`/employees/${emp['EMP-C']}/scores?period=2026-05`, c.chr)).json();
    expect(await score()).toMatchObject({ score: 80, partial: true });

    expect((await act(sub.d1b, 'verify', c.hod1b)).json().state).toBe('VERIFIED');
    expect((await act(sub.d1b, 'approve', c.ph)).json().state).toBe('APPROVED');
    expect((await act(sub.d1b, 'lock', c.chr)).json().state).toBe('LOCKED');

    const done = await score();
    expect(done.partial).toBe(false);
    expect(done.score).toBe(87.1); // (80 x 20 + 100 x 11) / 31
    expect(done.stints).toEqual([{ unitCode: 'P1-FORGE', levelCode: 'SUPERVISOR', days: 20, score: 80 }, { unitCode: 'P1-PRESS', levelCode: 'SUPERVISOR', days: 11, score: 100 }]);
    expect((await env.get(`/employees/${emp['EMP-C']}/scores?period=2026-05`, c.phr2)).statusCode).toBe(404);
    expect((await env.get(`/employees/${emp['EMP-C']}/scores?period=May`, c.chr)).statusCode).toBe(400);
  });
});

describe('controlled reopen', () => {
  let requestId: string;

  it('only the right roles can request and decide, and the requester cannot decide', async () => {
    expect((await env.post(`/submissions/${sub.d1}/reopen-requests`, { reason: 'x' }, c.phr1)).statusCode).toBe(403);
    expect((await env.post(`/submissions/${sub.d1}/reopen-requests`, {}, c.ph)).statusCode).toBe(400);
    const req = await env.post(`/submissions/${sub.d1}/reopen-requests`, { reason: 'Shift B rejection was mis-keyed' }, c.ph);
    expect(req.statusCode).toBe(201);
    requestId = req.json().id;
    expect((await env.post(`/submissions/${sub.d1}/reopen-requests`, { reason: 'again' }, c.chr)).statusCode).toBe(409); // one pending at a time

    expect((await env.get('/reopen-requests?state=PENDING', c.chrH)).json().requests).toHaveLength(1);
    expect((await env.post(`/reopen-requests/${requestId}/decision`, { approve: true }, c.ph)).statusCode).toBe(403);
    expect((await env.post(`/reopen-requests/${requestId}/decision`, { approve: true }, c.hod1)).statusCode).toBe(403);
  });

  it('approval reopens the month, supersedes the official scores and bumps the revision', async () => {
    const res = await env.post(`/reopen-requests/${requestId}/decision`, { approve: true, comment: 'Approved' }, c.chrH);
    expect(res.json().state).toBe('REOPENED');
    expect((await detail(sub.d1)).submission).toMatchObject({ state: 'REOPENED', revision: 3 });
    expect((await env.get(`/submissions/${sub.d1}/scores`, c.hod1)).json().error).toBe('NO_OFFICIAL_RUN');
    expect((await env.post(`/reopen-requests/${requestId}/decision`, { approve: false, comment: 'late' }, c.chrH)).json().error).toBe('ALREADY_DECIDED');
  });

  it('resubmitting needs a comment, and every changed result needs a fresh explanation', async () => {
    expect((await act(sub.d1, 'submit', c.phr1)).statusCode).toBe(400);
    const [, rej] = await kraIds(sub.d1);
    await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: rej, result: 4.5 }] }, c.phr1);
    const blocked = await act(sub.d1, 'submit', c.phr1, { comment: 'Corrected shift B figure' });
    expect(blocked.json().issues).toEqual([expect.objectContaining({ code: 'CHANGE_NEEDS_COMMENT', kra: 'Rejection' })]);

    await env.put(`/submissions/${sub.d1}/results`, { results: [{ kraId: rej, remarks: 'Shift B figure was 4.75, should have been 4.5' }] }, c.phr1);
    expect((await act(sub.d1, 'submit', c.phr1, { comment: 'Corrected shift B figure' })).json()).toEqual({ state: 'SUBMITTED', revision: 3 });
  });

  it('the same approvers can act again in the new revision and the corrected scores replace the old ones', async () => {
    expect((await act(sub.d1, 'verify', c.hod1)).json().state).toBe('VERIFIED');
    expect((await act(sub.d1, 'approve', c.ph)).json().state).toBe('APPROVED');
    expect((await act(sub.d1, 'lock', c.chr)).json().state).toBe('LOCKED');

    const s = (await env.get(`/submissions/${sub.d1}/scores`, c.hod1)).json();
    expect(s.kras.map((k: { final: number }) => k.final)).toEqual([100, 100, 60]);
    expect(s.levels.map((l: { score: number }) => l.score)).toEqual([92, 88, 88]); // HOD (5000+3000+1200)/100, SI (4000+3000+1800)/100, SUP (3000+4000+1800)/100

    const runs = (await env.pool.query('SELECT superseded_at IS NOT NULL AS superseded, input_hash FROM core.calc_run WHERE submission_id = $1 ORDER BY ran_at', [sub.d1])).rows;
    expect(runs.map((r) => r.superseded)).toEqual([true, false]);
    expect(runs[0].input_hash).not.toBe(runs[1].input_hash);
    expect((await env.get(`/employees/${emp['EMP-C']}/scores?period=2026-05`, c.chr)).json().score).toBe(92.26); // (88 x 20 + 100 x 11) / 31
  });

  it('refusing a reopen needs a comment and leaves the month locked', async () => {
    const req = (await env.post(`/submissions/${sub.d1b}/reopen-requests`, { reason: 'Just checking' }, c.chr)).json().id;
    expect((await env.post(`/reopen-requests/${req}/decision`, { approve: false }, c.chrH)).statusCode).toBe(400);
    expect((await env.post(`/reopen-requests/${req}/decision`, { approve: false, comment: 'No data change' }, c.chrH)).json().state).toBe('LOCKED');
    expect((await detail(sub.d1b)).submission.state).toBe('LOCKED');
  });

  it('every step above is in the tamper-evident audit log', async () => {
    const { rows } = await env.pool.query("SELECT DISTINCT action FROM core.audit_log WHERE action LIKE 'SUBMISSION_%' OR action LIKE 'REOPEN_%' OR action LIKE 'SCORECARD_%'");
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['SCORECARD_CREATED', 'SUBMISSION_CREATED', 'SUBMISSION_SUBMIT', 'SUBMISSION_VERIFY', 'SUBMISSION_APPROVE', 'SUBMISSION_LOCK', 'SUBMISSION_REJECT', 'SUBMISSION_RESUME', 'REOPEN_REQUESTED', 'REOPEN_APPROVED', 'REOPEN_REFUSED']),
    );
    const { verifyAuditChain } = await import('../src/audit.js');
    expect(await verifyAuditChain(env.pool)).toBeNull();
  });
});
