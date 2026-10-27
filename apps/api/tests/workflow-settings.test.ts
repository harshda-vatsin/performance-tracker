import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/audit.js';
import { setupEnv, type TestEnv } from './helpers.js';

/**
 * Configurable approval steps (migration 007). With the defaults the shop-floor month is Plant HR submits -> Corporate HR
 * locks, and the senior appraisal is self -> manager -> HR. The HOD verify, Plant Head approve and reviewer steps are
 * settings Corporate HR can switch on; the full chain is exercised by monthly.test.ts, slice4.test.ts and senior.test.ts.
 */
let env: TestEnv;
const c: Record<string, string | undefined> = {};
let n = 0;

const setSteps = (patch: object) => env.put('/settings/workflow', patch, c.chr);
const reset = () => setSteps({ monthly: { hodVerify: false, plantHeadApprove: false }, senior: { reviewerStep: false } });
const act = (id: string, action: string, cookie: string | undefined, extra: object = {}) => env.post(`/submissions/${id}/transitions`, { action, ...extra }, cookie);
const state = async (id: string) => (await env.get(`/submissions/${id}`, c.chr)).json().submission as { state: string; nextStep: string | null; period: string };

/** A fresh unit-month with its single KRA filled in and submitted. Each call uses a new period so months never collide. */
async function submitted(): Promise<string> {
  const m = 4 + n++; // Apr 2026 onwards, wrapping into 2027 (FY 2026-27 has twelve months)
  const period = m <= 12 ? `2026-${String(m).padStart(2, '0')}` : `2027-${String(m - 12).padStart(2, '0')}`;
  const id = (await env.post('/submissions', { orgUnitId: env.ids.d1, period }, c.phr1)).json().id as string;
  const kra = (await env.get(`/submissions/${id}`, c.phr1)).json().results[0].kraId;
  expect((await env.put(`/submissions/${id}/results`, { results: [{ kraId: kra, result: 86 }] }, c.phr1)).statusCode).toBe(200);
  expect((await act(id, 'submit', c.phr1)).statusCode).toBe(200);
  return id;
}

beforeAll(async () => {
  env = await setupEnv();
  const { ids, pool } = env;
  await pool.query("INSERT INTO core.people_level (plant_type_id, code, name_en, rank) VALUES ($1,'STAFF','Staff',1)", [ids.forge]);
  await env.user('S1', 'PHR', 'PLANT', ids.p1);
  await env.user('S2', 'CHR');
  await env.user('S3', 'CHR');
  await env.user('S4', 'PH', 'PLANT', ids.p1);
  await env.user('S5', 'HOD', 'DEPARTMENT', ids.d1);
  await env.user('S6', 'MGMT');
  await env.user('S7', 'ADMIN');
  for (const [key, code] of [['phr1', 'S1'], ['chr', 'S2'], ['chr2', 'S3'], ['ph', 'S4'], ['hod', 'S5'], ['md', 'S6'], ['admin', 'S7']]) c[key] = (await env.loginAs(code)).cookie;

  const t = (await env.post('/templates', { plantTypeId: ids.forge, name: 'Forge standard' }, c.chr)).json().id;
  await env.put(
    `/templates/${t}/kras`,
    { kras: [{ nameEn: 'Productivity', pqcdsm: 'P', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 82, targets: [84, 86, 88, 90], weights: { STAFF: 100 } }] },
    c.chr,
  );
  expect((await env.post(`/templates/${t}/activate`, {}, c.chr2)).statusCode).toBe(200); // the two-person rule still applies
  expect((await env.post('/scorecards', { orgUnitId: ids.d1, fiscalYear: 2026 }, c.phr1)).statusCode).toBe(201);
});

afterAll(() => env.close());

describe('the settings themselves', () => {
  it('every optional step is off by default, and anyone signed in can read the settings', async () => {
    for (const cookie of [c.chr, c.phr1, c.hod, c.md, c.admin]) {
      expect((await env.get('/settings/workflow', cookie)).json()).toEqual({ monthly: { hodVerify: false, plantHeadApprove: false }, senior: { reviewerStep: false } });
    }
    expect((await env.get('/settings/workflow')).statusCode).toBe(401);
  });

  it('only Corporate HR changes them; the change is validated and audited', async () => {
    for (const cookie of [c.phr1, c.ph, c.hod, c.md, c.admin]) expect((await env.put('/settings/workflow', { monthly: { hodVerify: true } }, cookie)).statusCode).toBe(403);
    expect((await setSteps({ monthly: { hodVerify: 'yes' } })).statusCode).toBe(400);
    expect((await setSteps({})).statusCode).toBe(400);

    const res = await setSteps({ monthly: { hodVerify: true } });
    expect(res.json()).toEqual({ monthly: { hodVerify: true, plantHeadApprove: false }, senior: { reviewerStep: false } });
    const log = await env.pool.query("SELECT before, after FROM core.audit_log WHERE action = 'WORKFLOW_SETTINGS_CHANGED' ORDER BY id DESC LIMIT 1");
    expect(log.rows[0].before.monthly.hodVerify).toBe(false);
    expect(log.rows[0].after.monthly.hodVerify).toBe(true);
    await reset();
  });
});

describe('shop-floor month with the defaults: Plant HR submits, Corporate HR locks', () => {
  it('Corporate HR locks a submitted month directly, with an official score', async () => {
    const id = await submitted();
    expect((await state(id)).nextStep).toBe('lock');
    expect((await act(id, 'lock', c.chr)).json()).toMatchObject({ state: 'LOCKED' });
    expect((await env.get(`/submissions/${id}/scores`, c.chr)).json().official).toBe(true);
  });

  it('the switched-off steps are refused with a clear answer', async () => {
    const id = await submitted();
    expect((await act(id, 'verify', c.hod)).json().error).toBe('STEP_DISABLED');
    expect((await act(id, 'approve', c.ph)).json().error).toBe('STEP_DISABLED');
    expect((await state(id)).state).toBe('SUBMITTED');
  });

  it('only the holder of the lock permission can lock or reject; Plant HR cannot lock what they entered', async () => {
    const id = await submitted();
    for (const cookie of [c.phr1, c.hod, c.ph, c.md]) expect((await act(id, 'lock', cookie)).statusCode).toBe(403);
    expect((await act(id, 'reject', c.hod, { comment: 'no' })).statusCode).toBe(403);
    expect((await act(id, 'reject', c.chr, { comment: 'Numbers look off, please recheck' })).json().state).toBe('REJECTED');
    expect((await act(id, 'resume', c.phr1)).json().state).toBe('DRAFT');
  });

  it('bulk lock works from SUBMITTED; bulk approve is refused while the Plant Head step is off', async () => {
    const id = await submitted();
    const { period } = await state(id);
    const url = `/plants/${env.ids.p1}/months/${period}/transitions`;
    expect((await env.post(url, { action: 'approve' }, c.ph)).json().error).toBe('STEP_DISABLED');
    const res = await env.post(url, { action: 'lock' }, c.chr);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ action: 'lock', state: 'LOCKED', count: 1 });
  });
});

describe('switching the optional steps on', () => {
  it('HOD verify only: SUBMITTED -> VERIFIED -> LOCKED, and lock is refused before the HOD has verified', async () => {
    await setSteps({ monthly: { hodVerify: true } });
    const id = await submitted();
    expect((await state(id)).nextStep).toBe('verify');
    expect((await act(id, 'lock', c.chr)).json().error).toBe('WRONG_STATE');
    expect((await act(id, 'verify', c.chr)).statusCode).toBe(403); // verify belongs to the HOD
    expect((await act(id, 'verify', c.hod)).json().state).toBe('VERIFIED');
    expect((await state(id)).nextStep).toBe('lock');
    expect((await act(id, 'lock', c.chr)).json().state).toBe('LOCKED');
    await reset();
  });

  it('Plant Head approve only: SUBMITTED -> APPROVED -> LOCKED', async () => {
    await setSteps({ monthly: { plantHeadApprove: true } });
    const id = await submitted();
    expect((await act(id, 'verify', c.hod)).json().error).toBe('STEP_DISABLED');
    expect((await act(id, 'lock', c.chr)).json().error).toBe('WRONG_STATE');
    expect((await act(id, 'approve', c.ph)).json().state).toBe('APPROVED');
    expect((await act(id, 'lock', c.chr)).json().state).toBe('LOCKED');
    await reset();
  });

  it('both on gives the original chain: verify, approve, lock', async () => {
    await setSteps({ monthly: { hodVerify: true, plantHeadApprove: true } });
    const id = await submitted();
    expect((await act(id, 'verify', c.hod)).json().state).toBe('VERIFIED');
    expect((await act(id, 'approve', c.ph)).json().state).toBe('APPROVED');
    expect((await act(id, 'lock', c.chr)).json().state).toBe('LOCKED');
    await reset();
  });

  it('flipping a setting never strands a month that is already part-way through', async () => {
    await setSteps({ monthly: { hodVerify: true } });
    const id = await submitted();
    expect((await act(id, 'verify', c.hod)).json().state).toBe('VERIFIED');
    await reset(); // the HOD step goes off while the month sits at VERIFIED
    expect((await state(id)).nextStep).toBe('lock');
    expect((await act(id, 'lock', c.chr)).json().state).toBe('LOCKED');

    await setSteps({ monthly: { plantHeadApprove: true } });
    const second = await submitted();
    await reset(); // the approval step goes off while the month sits at SUBMITTED
    expect((await act(second, 'lock', c.chr)).json().state).toBe('LOCKED');
  });
});

describe('what stays a two-person rule', () => {
  it('reopen still needs a different person to decide, whatever the settings', async () => {
    const id = await submitted();
    expect((await act(id, 'lock', c.chr)).statusCode).toBe(200);
    const req = await env.post(`/submissions/${id}/reopen-requests`, { reason: 'Wrong figure' }, c.chr);
    expect(req.statusCode).toBe(201);
    expect((await env.post(`/reopen-requests/${req.json().id}/decision`, { approve: true }, c.chr)).statusCode).toBe(409);
    expect((await env.post(`/reopen-requests/${req.json().id}/decision`, { approve: true }, c.chr2)).json().state).toBe('REOPENED');
  });

  it('a template cannot be activated by the person who wrote it', async () => {
    const t = (await env.post('/templates', { plantTypeId: env.ids.forge, name: 'Another' }, c.chr)).json().id;
    await env.put(
      `/templates/${t}/kras`,
      { kras: [{ nameEn: 'Productivity', pqcdsm: 'P', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 82, targets: [84, 86, 88, 90], weights: { STAFF: 100 } }] },
      c.chr,
    );
    expect((await env.post(`/templates/${t}/activate`, {}, c.chr)).statusCode).toBe(409);
  });
});

describe('senior appraisal: self -> manager -> HR, reviewer optional', () => {
  const GOALS = {
    kras: [{ name: 'Delivery', weight: 100, kpis: [{ name: 'Productivity', unit: '%', direction: 'HIGHER_BETTER', presentLevel: 82, targets: [84, 86, 88, 90], weight: 100 }] }],
  };
  const sact = (id: string, action: string, cookie: string | undefined, comment?: string) => env.post(`/senior/cycles/${id}/transitions`, { action, comment }, cookie);
  const cs: Record<string, string | undefined> = {};
  const emp: Record<string, string> = {};
  const employeeOf = async (userKey: string) => (await env.pool.query('SELECT employee_id FROM core.user_account WHERE id = $1', [env.ids[userKey]])).rows[0].employee_id as string;
  const newCycle = (code: string, withReviewer: boolean) =>
    env.post('/senior/cycles', { employeeId: emp[code], fiscalYear: 2026, managerUserId: env.ids.T2, ...(withReviewer ? { reviewerUserId: env.ids.T3 } : {}) }, c.chr);

  beforeAll(async () => {
    const { ids } = env;
    await env.user('T1', 'EMP', 'SELF');
    await env.user('T2', 'HOD', 'DEPARTMENT', ids.d1);
    await env.user('T3', 'PH', 'PLANT', ids.p2);
    await env.user('T4', 'EMP', 'SELF');
    await env.user('T5', 'EMP', 'SELF');
    await env.user('T6', 'EMP', 'SELF');
    for (const [key, code] of [['emp', 'T1'], ['mgr', 'T2'], ['rev', 'T3'], ['emp2', 'T4'], ['emp6', 'T6']]) cs[key] = (await env.loginAs(code)).cookie;
    for (const code of ['T1', 'T4', 'T5', 'T6']) emp[code] = await employeeOf(code);
  });

  /** Drives a new cycle to the manager's assessment being written (not yet submitted). */
  async function toManagerStage(id: string, employee = cs.emp) {
    expect((await env.put(`/senior/cycles/${id}/goals`, GOALS, cs.mgr)).statusCode).toBe(200);
    expect((await sact(id, 'issue', cs.mgr)).statusCode).toBe(200);
    expect((await sact(id, 'acknowledge', employee)).statusCode).toBe(200);
    const kpi = (await env.get(`/senior/cycles/${id}`, c.chr)).json().goals.kras[0].kpis[0].id;
    expect((await env.put(`/senior/cycles/${id}/results/2026-04`, { results: [{ kpiId: kpi, result: 85 }] }, cs.mgr)).statusCode).toBe(200);
    expect((await env.post(`/senior/cycles/${id}/months/2026-04/confirm`, {}, cs.mgr)).statusCode).toBe(200);
    expect((await sact(id, 'open_appraisal', c.chr)).statusCode).toBe(200);
    expect((await env.put(`/senior/cycles/${id}/assessment`, { summary: 'Self view' }, employee)).statusCode).toBe(200);
    expect((await sact(id, 'submit_self', employee)).statusCode).toBe(200);
    expect((await env.put(`/senior/cycles/${id}/assessment`, { summary: 'Manager view' }, cs.mgr)).statusCode).toBe(200);
  }

  it('a cycle needs no reviewer by default, and the manager hands straight to HR who finalise it', async () => {
    const created = await newCycle('T1', false);
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    await toManagerStage(id);
    expect((await sact(id, 'submit_manager', cs.mgr)).json().state).toBe('HR_FINALISATION');
    expect((await sact(id, 'sign_off', cs.rev)).statusCode).toBe(404); // no reviewer is assigned, so no one outside the cycle can even see it
    expect((await sact(id, 'finalise', cs.mgr)).statusCode).toBe(403); // the manager cannot finalise
    expect((await sact(id, 'finalise', c.chr)).json().state).toBe('FINALISED');
    const d = (await env.get(`/senior/cycles/${id}`, c.chr)).json();
    expect(d.cycle.reviewer).toBeNull();
    expect(d.cycle.final.band.code).toBeTruthy();
  });

  it('HR can send the appraisal back to the manager, who resubmits', async () => {
    const id = (await newCycle('T4', false)).json().id;
    await toManagerStage(id, cs.emp2);
    await sact(id, 'submit_manager', cs.mgr);
    expect((await sact(id, 'send_back', c.chr)).statusCode).toBe(400); // a comment is required
    expect((await sact(id, 'send_back', c.chr, 'Please add detail')).json().state).toBe('MANAGER_ASSESSMENT');
    expect((await sact(id, 'submit_manager', cs.mgr)).json().state).toBe('HR_FINALISATION');
  });

  it('with the reviewer step on, a cycle cannot start without a reviewer', async () => {
    await setSteps({ senior: { reviewerStep: true } });
    expect((await newCycle('T5', false)).statusCode).toBe(409);
    expect((await newCycle('T5', true)).statusCode).toBe(201);
    await reset();
  });

  it('turning the reviewer step on for a cycle that has no reviewer blocks the hand-over until one is assigned', async () => {
    const id = (await newCycle('T6', false)).json().id;
    expect((await env.put(`/senior/cycles/${id}/goals`, GOALS, cs.mgr)).statusCode).toBe(200);
    await sact(id, 'issue', cs.mgr);
    await sact(id, 'acknowledge', cs.emp6);
    await sact(id, 'open_appraisal', c.chr);
    await env.put(`/senior/cycles/${id}/assessment`, { summary: 'Self' }, cs.emp6);
    await sact(id, 'submit_self', cs.emp6);
    await env.put(`/senior/cycles/${id}/assessment`, { summary: 'Manager' }, cs.mgr);

    await setSteps({ senior: { reviewerStep: true } });
    expect((await sact(id, 'submit_manager', cs.mgr)).json().error).toBe('SENIOR_REVIEWER_REQUIRED');
    const appraisal = (await env.pool.query('SELECT id FROM core.appraisal WHERE employee_id = $1 AND fiscal_year = 2026', [emp.T6])).rows[0].id;
    expect((await env.put(`/appraisals/${appraisal}/reviewer`, { reviewerLoginId: 'T3' }, c.chr)).statusCode).toBe(200);
    expect((await sact(id, 'submit_manager', cs.mgr)).json().state).toBe('REVIEWER_REVIEW');
    expect((await sact(id, 'sign_off', cs.rev)).json().state).toBe('HR_FINALISATION');
    await reset();
  });
});

describe('audit', () => {
  it('the hash chain is intact after all of the above', async () => {
    expect(await verifyAuditChain(env.pool)).toBeNull();
  });
});
