import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/audit.js';
import { fiscalMonths, rollupFiscalYear } from '../src/scoring/rollup.js';
import { FORGE_PARAMS } from '@mmf/scoring';
import { setupEnv, type TestEnv } from './helpers.js';

/**
 * Two Forge units (d1 = P1-FORGE, d1b = P1-PRESS) in plant P1; P2 has one unit with no activity.
 *   2026-04: both units at target on every KRA                 -> every level 100
 *   2026-05: d1 results (84, 4.75, 4) -> HOD 86, SI 82, SUP 80;  d1b at target -> 100
 *   2026-06: d1 verified, d1b still a draft
 */
let env: TestEnv;
const c: Record<string, string | undefined> = {};
const sc: Record<string, string> = {};
const sub: Record<string, string> = {};

const KRAS = [
  { nameEn: 'Productivity', pqcdsm: 'P', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 82, targets: [84, 86, 88, 90], weights: { HOD: 50, SHIFT_INCHARGE: 40, SUPERVISOR: 30 } },
  { nameEn: 'Rejection', pqcdsm: 'Q', direction: 'LOWER_BETTER', unit: '%', presentLevel: 5, targets: [4.5, 4, 3.5, 3], weights: { HOD: 30, SHIFT_INCHARGE: 30, SUPERVISOR: 40 } },
  { nameEn: 'Unsafe conditions', pqcdsm: 'S', direction: 'LOWER_BETTER', unit: 'count', presentLevel: 4, targets: [3, 2, 1, 0], weights: { HOD: 20, SHIFT_INCHARGE: 30, SUPERVISOR: 30 } },
];
const AT_TARGET = [84, 4.5, 3];
const MAY_D1 = [84, 4.75, 4];

const act = (id: string, action: string, cookie: string | undefined, extra: object = {}) => env.post(`/submissions/${id}/transitions`, { action, ...extra }, cookie);
const bulk = (period: string, action: string, cookie: string | undefined, extra: object = {}) => env.post(`/plants/${env.ids.p1}/months/${period}/transitions`, { action, ...extra }, cookie);
const detail = async (id: string) => (await env.get(`/submissions/${id}`, c.ph)).json();

/** Create, fill, submit and (optionally) verify one unit-month through the real API. */
async function prepare(unit: 'd1' | 'd1b', period: string, values: number[], upTo: 'DRAFT' | 'SUBMITTED' | 'VERIFIED') {
  const id = (await env.post('/submissions', { orgUnitId: env.ids[unit], period }, c.phr1)).json().id as string;
  sub[`${unit}:${period}`] = id;
  if (upTo === 'DRAFT') return id;
  const kras = (await detail(id)).results.map((r: { kraId: string }) => r.kraId);
  await env.put(`/submissions/${id}/results`, { results: kras.map((kraId: string, i: number) => ({ kraId, result: values[i] })) }, c.phr1);
  expect((await act(id, 'submit', c.phr1)).statusCode).toBe(200);
  if (upTo === 'VERIFIED') expect((await act(id, 'verify', unit === 'd1' ? c.hod1 : c.hod1b)).statusCode).toBe(200);
  return id;
}

beforeAll(async () => {
  env = await setupEnv();
  // The dashboards tests walk the whole review chain; the optional HOD and Plant Head steps are off by default.
  await env.pool.query("UPDATE core.workflow_setting SET enabled = true WHERE key LIKE 'monthly.%'");
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
  await env.user('E1011', 'MGMT');
  for (const [key, code] of [['phr1', 'E1002'], ['chr', 'E1003'], ['chrH', 'E1004'], ['ph', 'E1005'], ['hod1', 'E1007'], ['hod1b', 'E1008'], ['phr2', 'E1009'], ['md', 'E1011']]) {
    c[key] = (await env.loginAs(code)).cookie;
  }

  const t = (await env.post('/templates', { plantTypeId: ids.forge, name: 'Forge standard' }, c.chr)).json().id;
  await env.put(`/templates/${t}/kras`, { kras: KRAS }, c.chr);
  await env.post(`/templates/${t}/activate`, {}, c.chrH);
  sc.d1 = (await env.post('/scorecards', { orgUnitId: ids.d1, fiscalYear: 2026 }, c.phr1)).json().id;
  sc.d1b = (await env.post('/scorecards', { orgUnitId: ids.d1b, fiscalYear: 2026 }, c.phr1)).json().id;
});

afterAll(() => env.close());

describe('plant-month bulk approve and lock', () => {
  it('approves every unit of the plant at once, one workflow event per unit', async () => {
    await prepare('d1', '2026-04', AT_TARGET, 'VERIFIED');
    await prepare('d1b', '2026-04', AT_TARGET, 'VERIFIED');

    const early = await bulk('2026-04', 'lock', c.chr);
    expect(early.statusCode).toBe(409);
    expect(early.json().units).toEqual([{ unitCode: 'P1-FORGE', state: 'VERIFIED' }, { unitCode: 'P1-PRESS', state: 'VERIFIED' }]);

    expect((await bulk('2026-04', 'approve', c.phr1)).statusCode).toBe(403);
    expect((await bulk('2026-04', 'approve', c.phr2)).statusCode).toBe(404);
    const ok = await bulk('2026-04', 'approve', c.ph);
    expect(ok.json()).toMatchObject({ state: 'APPROVED', count: 2, excluded: [] });

    for (const key of ['d1:2026-04', 'd1b:2026-04']) {
      const events = (await detail(sub[key])).events.filter((e: { toState: string }) => e.toState === 'APPROVED');
      expect(events).toHaveLength(1);
      expect(events[0].actor).toBe('E1005');
    }
  });

  it('locking is for Corporate HR only, and produces official scores for every unit', async () => {
    expect((await bulk('2026-04', 'lock', c.ph)).statusCode).toBe(403);
    expect((await bulk('2026-04', 'lock', c.chr)).json()).toMatchObject({ state: 'LOCKED', count: 2 });
    for (const key of ['d1:2026-04', 'd1b:2026-04']) {
      const s = (await env.get(`/submissions/${sub[key]}/scores`, c.chr)).json();
      expect(s.levels.map((l: { score: number }) => l.score)).toEqual([100, 100, 100]);
    }
    expect((await bulk('2026-04', 'lock', c.chr)).statusCode).toBe(409); // nothing is APPROVED any more
  });

  it('locks a second month with different scores', async () => {
    await prepare('d1', '2026-05', MAY_D1, 'VERIFIED');
    await prepare('d1b', '2026-05', AT_TARGET, 'VERIFIED');
    expect((await bulk('2026-05', 'approve', c.ph)).statusCode).toBe(200);
    expect((await bulk('2026-05', 'lock', c.chr)).statusCode).toBe(200);
    const s = (await env.get(`/submissions/${sub['d1:2026-05']}/scores`, c.hod1)).json();
    expect(s.levels.map((l: { score: number }) => l.score)).toEqual([86, 82, 80]);
  });

  it('refuses all-or-nothing when a unit is not ready, unless it is excluded with a reason', async () => {
    await prepare('d1', '2026-06', AT_TARGET, 'VERIFIED');
    await prepare('d1b', '2026-06', AT_TARGET, 'DRAFT');

    const blocked = await bulk('2026-06', 'approve', c.ph);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().units).toEqual([{ unitCode: 'P1-PRESS', state: 'DRAFT' }]);
    expect((await detail(sub['d1:2026-06'])).submission.state).toBe('VERIFIED'); // nothing moved

    const noReason = await bulk('2026-06', 'approve', c.ph, { exclusions: [{ orgUnitId: env.ids.d1b }] });
    expect(noReason.statusCode).toBe(400);
    const ok = await bulk('2026-06', 'approve', c.ph, { exclusions: [{ orgUnitId: env.ids.d1b, reason: 'Press shop shut for maintenance' }] });
    expect(ok.json()).toMatchObject({ count: 1, excluded: [{ unitCode: 'P1-PRESS', reason: 'Press shop shut for maintenance' }] });
    expect((await detail(sub['d1:2026-06'])).submission.state).toBe('APPROVED');
    expect((await detail(sub['d1b:2026-06'])).submission.state).toBe('DRAFT');
    const { rows } = await env.pool.query("SELECT after FROM core.audit_log WHERE action = 'PLANT_MONTH_APPROVE' ORDER BY id DESC LIMIT 1");
    expect(rows[0].after.exclusions).toEqual([{ unit: 'P1-PRESS', reason: 'Press shop shut for maintenance' }]);
  });

  it('shows a plant status board with states and, once locked, level scores', async () => {
    const may = (await env.get(`/plants/${env.ids.p1}/months/2026-05`, c.ph)).json();
    expect(may.summary).toEqual({ LOCKED: 2 });
    expect(may.units[0]).toMatchObject({ unitCode: 'P1-FORGE', state: 'LOCKED' });
    expect(may.units[0].levels).toEqual([{ levelCode: 'HOD', score: 86 }, { levelCode: 'SHIFT_INCHARGE', score: 82 }, { levelCode: 'SUPERVISOR', score: 80 }]);

    const june = (await env.get(`/plants/${env.ids.p1}/months/2026-06`, c.ph)).json();
    expect(june.summary).toEqual({ APPROVED: 1, DRAFT: 1 });
    expect(june.units[0].levels).toEqual([]); // approved but not locked: no official scores yet

    expect((await env.get(`/plants/${env.ids.p1}/months/2026-08`, c.ph)).json().summary).toEqual({ NOT_STARTED: 2 });
    expect((await env.get(`/plants/${env.ids.p1}/months/2026-05`, c.hod1)).statusCode).toBe(404); // a HOD sees units, not the plant
    expect((await env.get(`/plants/${env.ids.p1}/months/2026-05`, c.phr2)).statusCode).toBe(404);
  });
});

describe('scorecard adjustments (maker-checker)', () => {
  const change = { kraId: '', presentLevel: 85, targets: [86, 88, 90, 92] };
  let requestId: string;

  beforeAll(async () => {
    change.kraId = (await env.get(`/scorecards/${sc.d1}`, c.phr1)).json().kras[0].id;
  });

  it('rejects proposals that touch started months, other fiscal years, bad targets or nothing', async () => {
    const post = (body: object, cookie = c.phr1) => env.post(`/scorecards/${sc.d1}/change-requests`, { reason: 'Raise the bar', ...body }, cookie);
    const started = await post({ effectiveFromPeriod: '2026-05', changes: [change] });
    expect(started.statusCode).toBe(409);
    expect(started.json()).toMatchObject({ error: 'SUBMISSIONS_EXIST', periods: ['2026-05', '2026-06'] });
    expect((await post({ effectiveFromPeriod: '2027-04', changes: [change] })).statusCode).toBe(400);
    expect((await post({ effectiveFromPeriod: '2026-07', changes: [{ kraId: change.kraId, presentLevel: 85, targets: [80, 88, 90, 92] }] })).statusCode).toBe(400);
    expect((await post({ effectiveFromPeriod: '2026-07', changes: [{ kraId: 'nope', presentLevel: 85 }] })).statusCode).toBe(400);
    expect((await post({ effectiveFromPeriod: '2026-07', changes: [] })).statusCode).toBe(400);
    expect((await post({ effectiveFromPeriod: '2026-07', changes: [change] }, c.hod1)).statusCode).toBe(403);
    expect((await post({ effectiveFromPeriod: '2026-07', changes: [change] }, c.phr2)).statusCode).toBe(404);
  });

  it('Plant HR proposes; only one proposal may be open at a time', async () => {
    const res = await env.post(`/scorecards/${sc.d1}/change-requests`, { effectiveFromPeriod: '2026-07', reason: 'Raise the bar', changes: [change] }, c.phr1);
    expect(res.statusCode).toBe(201);
    requestId = res.json().id;
    expect((await env.post(`/scorecards/${sc.d1}/change-requests`, { effectiveFromPeriod: '2026-08', reason: 'x', changes: [change] }, c.phr1)).statusCode).toBe(409);
    expect((await env.get(`/scorecards/${sc.d1}/change-requests`, c.hod1)).json().requests[0]).toMatchObject({ state: 'PENDING', effectivePeriod: '2026-07' });
  });

  it('a different person with approval rights decides; the author and others cannot', async () => {
    expect((await env.post(`/scorecard-change-requests/${requestId}/decision`, { approve: true }, c.phr1)).statusCode).toBe(403);
    expect((await env.post(`/scorecard-change-requests/${requestId}/decision`, { approve: true }, c.hod1)).statusCode).toBe(403);
    expect((await env.post(`/scorecard-change-requests/${requestId}/decision`, { approve: true }, c.phr2)).statusCode).toBe(403);

    const ok = await env.post(`/scorecard-change-requests/${requestId}/decision`, { approve: true, comment: 'Agreed' }, c.ph);
    expect(ok.json()).toMatchObject({ state: 'APPROVED', version: 2 });
    expect((await env.post(`/scorecard-change-requests/${requestId}/decision`, { approve: true }, c.ph)).json().error).toBe('ALREADY_DECIDED');

    // After approval the scorecard has new KRA ids; the proposal must still say which KRA it changed and from what.
    const listed = (await env.get(`/scorecards/${sc.d1}/change-requests`, c.hod1)).json().requests[0].changes[0];
    expect(typeof listed.nameEn).toBe('string');
    expect(listed.before).toMatchObject({ presentLevel: expect.any(Number), targets: expect.any(Array) });
  });

  it('the new version applies from its month only; earlier months keep their snapshot', async () => {
    const card = (await env.get(`/scorecards/${sc.d1}`, c.hod1)).json();
    expect(card.scorecard.version).toBe(2);
    expect(card.kras[0]).toMatchObject({ presentLevel: 85, targets: [86, 88, 90, 92], weights: { HOD: 50, SHIFT_INCHARGE: 40, SUPERVISOR: 30 } });
    expect(card.kras[1].presentLevel).toBe(5); // untouched KRAs carry over unchanged

    const july = await env.post('/submissions', { orgUnitId: env.ids.d1, period: '2026-07' }, c.phr1);
    const julyRow = (await detail(july.json().id)).results[0];
    expect([julyRow.presentLevel, julyRow.target]).toEqual([85, 88]); // July is Q2 -> 88
    const june = (await detail(sub['d1:2026-06'])).results[0];
    expect([june.presentLevel, june.target]).toEqual([82, 84]); // June keeps version 1
  });

  it('Corporate HR can propose but never approve their own proposal; refusals need a comment', async () => {
    const kra = (await env.get(`/scorecards/${sc.d1b}`, c.chr)).json().kras[0].id;
    const prop = await env.post(`/scorecards/${sc.d1b}/change-requests`, { effectiveFromPeriod: '2026-09', reason: 'Seasonal', changes: [{ kraId: kra, targets: [86, 88, 90, 92] }] }, c.chr);
    expect(prop.statusCode).toBe(201);
    const self = await env.post(`/scorecard-change-requests/${prop.json().id}/decision`, { approve: true }, c.chr);
    expect(self.statusCode).toBe(409);
    expect(self.json().error).toMatch(/^SOD:/);

    expect((await env.post(`/scorecard-change-requests/${prop.json().id}/decision`, { approve: false }, c.ph)).statusCode).toBe(400);
    expect((await env.post(`/scorecard-change-requests/${prop.json().id}/decision`, { approve: false, comment: 'Not this year' }, c.ph)).json().state).toBe('REJECTED');
    expect((await env.get(`/scorecards/${sc.d1b}`, c.chr)).json().scorecard.version).toBe(1); // a refusal changes nothing
  });

  it('the database refuses a self-approval and any edit to a stored scorecard version', async () => {
    await expect(env.pool.query('UPDATE core.scorecard_change_request SET checker_id = maker_id')).rejects.toThrow(/check constraint|violates/i);
    await expect(env.pool.query("UPDATE core.scorecard_version SET effective_from = '2020-01-01'")).rejects.toThrow(/append-only/);
    await expect(env.pool.query('UPDATE core.scorecard_kra SET present_level = 1')).rejects.toThrow(/append-only/);
  });
});

describe('dashboards and roll-ups (official results only)', () => {
  it('a unit trend shows locked months with quarter and year roll-ups; unlocked months stay out', async () => {
    const res = (await env.get(`/dashboards/units/${env.ids.d1}?fiscalYear=2026`, c.hod1)).json();
    const hod = res.levels.find((l: { levelCode: string }) => l.levelCode === 'HOD');
    expect(hod.months).toEqual([{ period: '2026-04', score: 100 }, { period: '2026-05', score: 86 }]); // June is only APPROVED
    expect(hod.quarters[0]).toEqual({ quarter: 1, score: 93, monthsCounted: 2 });
    expect(hod.quarters.slice(1).map((q: { score: number | null }) => q.score)).toEqual([null, null, null]);
    expect(hod.year).toEqual({ score: 93, quartersCounted: 1 });
    expect(res.levels.map((l: { levelCode: string; quarters: { score: number }[] }) => [l.levelCode, l.quarters[0].score])).toEqual([['HOD', 93], ['SHIFT_INCHARGE', 91], ['SUPERVISOR', 90]]);
  });

  it('enforces scope and input checks', async () => {
    expect((await env.get(`/dashboards/units/${env.ids.d1}?fiscalYear=2026`, c.hod1b)).statusCode).toBe(404);
    expect((await env.get(`/dashboards/units/${env.ids.d1}?fiscalYear=2026`, c.phr2)).statusCode).toBe(404);
    expect((await env.get(`/dashboards/units/${env.ids.d1}?fiscalYear=abc`, c.hod1)).statusCode).toBe(400);
    expect((await env.get(`/dashboards/units/${env.ids.p1}?fiscalYear=2026`, c.ph)).statusCode).toBe(404); // a plant is not a scored unit
    expect((await env.get('/dashboards/management?period=May', c.md)).statusCode).toBe(400);
    expect((await env.get('/dashboards/management?period=2026-05', c.hod1)).statusCode).toBe(200); // allowed, but scoped to HOD's own reach
  });

  it('management compares plants within a plant type from average locked unit scores', async () => {
    const res = (await env.get('/dashboards/management?period=2026-05', c.md)).json();
    expect(res.plantTypes).toHaveLength(1);
    const [p1, p2] = res.plantTypes[0].plants;
    expect(p1).toMatchObject({ code: 'P1', unitsTotal: 2, unitsLocked: 2 });
    expect(p1.levels).toEqual([{ levelCode: 'HOD', score: 93 }, { levelCode: 'SHIFT_INCHARGE', score: 91 }, { levelCode: 'SUPERVISOR', score: 90 }]); // (86+100)/2, (82+100)/2, (80+100)/2
    expect(p2).toMatchObject({ code: 'P2', unitsTotal: 1, unitsLocked: 0, levels: [] });

    const scoped = (await env.get('/dashboards/management?period=2026-05', c.phr1)).json();
    expect(scoped.plantTypes[0].plants.map((p: { code: string }) => p.code)).toEqual(['P1']);
    expect((await env.get('/dashboards/management?period=2026-06', c.md)).json().plantTypes[0].plants[0].unitsLocked).toBe(0);
  });

  it('a reopened month drops out of every dashboard until it is locked again', async () => {
    const req = await env.post(`/submissions/${sub['d1:2026-05']}/reopen-requests`, { reason: 'Rejection figure under review' }, c.ph);
    expect((await env.post(`/reopen-requests/${req.json().id}/decision`, { approve: true }, c.chrH)).statusCode).toBe(200);

    const hod = (await env.get(`/dashboards/units/${env.ids.d1}?fiscalYear=2026`, c.hod1)).json().levels[0];
    expect(hod.months).toEqual([{ period: '2026-04', score: 100 }]);
    expect(hod.quarters[0]).toEqual({ quarter: 1, score: 100, monthsCounted: 1 });

    const mgmt = (await env.get('/dashboards/management?period=2026-05', c.md)).json().plantTypes[0].plants[0];
    expect(mgmt).toMatchObject({ unitsLocked: 1 });
    expect(mgmt.levels[0]).toEqual({ levelCode: 'HOD', score: 100 }); // only the Press shop's locked month remains
    expect((await env.get(`/plants/${env.ids.p1}/months/2026-05`, c.ph)).json().summary).toEqual({ LOCKED: 1, REOPENED: 1 });
  });

  it('every step is audited and the hash chain is intact', async () => {
    const { rows } = await env.pool.query("SELECT DISTINCT action FROM core.audit_log WHERE action LIKE 'PLANT_MONTH_%' OR action LIKE 'SCORECARD_CHANGE_%'");
    expect(rows.map((r) => r.action).sort()).toEqual(['PLANT_MONTH_APPROVE', 'PLANT_MONTH_LOCK', 'SCORECARD_CHANGE_APPROVED', 'SCORECARD_CHANGE_PROPOSED', 'SCORECARD_CHANGE_REFUSED']);
    expect(await verifyAuditChain(env.pool)).toBeNull();
  });
});

describe('rollupFiscalYear (pure)', () => {
  it('lists April to March and excludes months that are not locked rather than counting them as zero', () => {
    expect(fiscalMonths(2026)[0]).toBe('2026-04');
    expect(fiscalMonths(2026)[11]).toBe('2027-03');
    const r = rollupFiscalYear(2026, new Map([['2026-04', 100], ['2026-05', 80]]), FORGE_PARAMS);
    expect(r.quarters[0]).toEqual({ quarter: 1, score: 90, monthsCounted: 2 });
    expect(r.year).toEqual({ score: 90, quartersCounted: 1 });
  });

  it('averages the four quarters for a full year, with Q4 falling in the next calendar year', () => {
    const monthly = new Map(fiscalMonths(2026).map((p, i) => [p, i < 3 ? 94 : i < 6 ? 90 : i < 9 ? 85 : 95] as [string, number]));
    const r = rollupFiscalYear(2026, monthly, FORGE_PARAMS);
    expect(r.quarters.map((q) => q.score)).toEqual([94, 90, 85, 95]);
    expect(r.year).toEqual({ score: 91, quartersCounted: 4 }); // doc 05 worked example 14
    expect(rollupFiscalYear(2026, new Map(), FORGE_PARAMS).year).toEqual({ score: null, quartersCounted: 0 });
  });
});
