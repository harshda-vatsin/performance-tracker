import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/audit.js';
import { bandFor, bonusAmount, dayWeightedScore, parsePaise, rupees, type Band } from '../src/bonus/calc.js';
import { setupEnv, type TestEnv } from './helpers.js';

const BANDS: Band[] = [
  { minScore: 0, percentBp: 0, label: 'none' },
  { minScore: 50, percentBp: 4000, label: '40%' },
  { minScore: 70, percentBp: 7000, label: '70%' },
  { minScore: 85, percentBp: 10000, label: '100%' },
  { minScore: 100, percentBp: 11000, label: '110%' },
];

describe('bonus arithmetic (integer paise, golden values)', () => {
  it('reads the band with the highest minimum the score reaches; boundaries belong to the higher band', () => {
    expect(bandFor(49.99, BANDS)?.percentBp).toBe(0);
    expect(bandFor(50, BANDS)?.percentBp).toBe(4000);
    expect(bandFor(94, BANDS)?.percentBp).toBe(10000);
    expect(bandFor(100, BANDS)?.percentBp).toBe(11000);
    expect(bandFor(118, BANDS)?.percentBp).toBe(11000);
    expect(bandFor(null, BANDS)).toBeNull();
  });

  it('base x percentage x days, one half-up rounding, exact in paise', () => {
    // Doc 05 §2.3 example 4: score 100+ pays 110% of Rs 3,000 = Rs 3,300.
    expect(bonusAmount(300000n, 11000, 30, 30)).toBe(330000n);
    // Example 1 in paise: 100% of Rs 3,000 for 26 of 28 days = Rs 2,785.71 (278,571.43 paise rounds down).
    expect(bonusAmount(300000n, 10000, 26, 28)).toBe(278571n);
    // Half-up: 1 paise x 50% = 0.5 -> 1; 3 paise x 50% = 1.5 -> 2; 1 paise x 49.99% -> 0.
    expect(bonusAmount(1n, 5000, 30, 30)).toBe(1n);
    expect(bonusAmount(3n, 5000, 30, 30)).toBe(2n);
    expect(bonusAmount(1n, 4999, 30, 30)).toBe(0n);
    // Large values stay exact (a double would lose the last digits).
    expect(bonusAmount(900719925474099300n, 10000, 30, 30)).toBe(900719925474099300n);
    // Days beyond the month never pay more than the month.
    expect(bonusAmount(100000n, 10000, 40, 30)).toBe(100000n);
    expect(() => bonusAmount(-1n, 10000, 30, 30)).toThrow(RangeError);
    expect(() => bonusAmount(1n, 10.5, 30, 30)).toThrow(RangeError);
  });

  it('weights an employee who moved units by days, ignoring unscored stints', () => {
    expect(dayWeightedScore([{ score: 80, days: 10 }, { score: 100, days: 20 }])).toEqual({ score: 93.33, days: 30 });
    expect(dayWeightedScore([{ score: 80, days: 10 }, { score: null, days: 20 }])).toEqual({ score: 80, days: 30 });
    expect(dayWeightedScore([{ score: null, days: 30 }])).toEqual({ score: null, days: 30 });
  });

  it('formats paise as rupees without floating point, and accepts only whole non-negative paise', () => {
    expect(rupees(330000n)).toBe('3300.00');
    expect(rupees(278571n)).toBe('2785.71');
    expect(rupees(5n)).toBe('0.05');
    expect(rupees(-12050n)).toBe('-120.50');
    expect(parsePaise(300000)).toBe(300000n);
    for (const value of [-1, 1.5, '300', null, Number.MAX_SAFE_INTEGER + 2, NaN]) expect(parsePaise(value)).toBeNull();
  });
});

let env: TestEnv;
const c: Record<string, string | undefined> = {};
const emp: Record<string, string> = {};

const MONTH = '2026-06'; // 30 days, Q1 target 84

async function addEmployee(code: string, name: string, category: string, from: string) {
  const e = await env.pool.query('INSERT INTO core.employee (employee_code, full_name) VALUES ($1,$2) RETURNING id', [code, name]);
  const cat = (await env.pool.query('SELECT id FROM core.employee_category WHERE code = $1', [category])).rows[0].id;
  await env.pool.query("INSERT INTO core.employee_assignment (employee_id, org_unit_id, category_id, valid) VALUES ($1,$2,$3, daterange($4::date, NULL, '[)'))", [e.rows[0].id, env.ids.d1, cat, from]);
  emp[code] = e.rows[0].id;
}

/** Enters, submits and locks one month of the department scorecard; the result equals the target, so the score is 100. */
async function lockMonth(period: string, result: number): Promise<void> {
  const sub = (await env.post('/submissions', { orgUnitId: env.ids.d1, period }, c.phr)).json().id as string;
  const kra = (await env.get(`/submissions/${sub}`, c.phr)).json().results[0].kraId;
  await env.put(`/submissions/${sub}/results`, { results: [{ kraId: kra, result }] }, c.phr);
  const days = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0)).getUTCDate();
  const stint = (code: string, d = days) => ({ employeeId: emp[code], levelCode: 'STAFF', daysInUnit: d });
  await env.put(`/submissions/${sub}/level-assignments`, { assignments: [stint('A'), stint('B'), stint('C'), ...(period >= '2026-06' ? [stint('D', 15)] : [])] }, c.phr);
  expect((await env.post(`/submissions/${sub}/transitions`, { action: 'submit' }, c.phr)).statusCode).toBe(200);
  expect((await env.post(`/submissions/${sub}/transitions`, { action: 'lock' }, c.chr)).statusCode).toBe(200);
}

const calc = (body: object, cookie = c.chr) => env.post('/bonus/calculate', body, cookie);
type BatchRow = { id: string; state: string; kind: string; totalPaise: number; plantCode: string };
const batchesOf = async (period: string, cookie = c.chr) => (await env.get(`/bonus/batches?period=${period}`, cookie)).json().batches as BatchRow[];

beforeAll(async () => {
  env = await setupEnv();
  const { ids, pool } = env;
  await pool.query("INSERT INTO core.people_level (plant_type_id, code, name_en, rank) VALUES ($1,'STAFF','Staff',1)", [ids.forge]);
  await env.user('B1', 'PHR', 'PLANT', ids.p1);
  await env.user('B2', 'CHR');
  await env.user('B3', 'CHR');
  await env.user('B4', 'MGMT');
  await env.user('B5', 'ADMIN');
  await env.user('B6', 'PH', 'PLANT', ids.p1);
  await env.user('B7', 'HOD', 'DEPARTMENT', ids.d1);
  await env.user('A', 'EMP', 'SELF'); // Asha: a permanent worker with a base, and a login
  for (const [key, code] of [['phr', 'B1'], ['chr', 'B2'], ['chr2', 'B3'], ['md', 'B4'], ['admin', 'B5'], ['ph', 'B6'], ['hod', 'B7'], ['asha', 'A']]) c[key] = (await env.loginAs(code)).cookie;
  emp.A = (await pool.query('SELECT employee_id FROM core.user_account WHERE id = $1', [ids.A])).rows[0].employee_id;
  await pool.query("INSERT INTO core.employee_assignment (employee_id, org_unit_id, category_id, valid) SELECT $1,$2,id, daterange('2026-01-01', NULL, '[)') FROM core.employee_category WHERE code = 'PERMANENT_WORKER'", [emp.A, ids.d1]);
  await addEmployee('B', 'Babu (no base)', 'PERMANENT_WORKER', '2026-01-01');
  await addEmployee('C', 'Chitra (contract)', 'CONTRACT_WORKER', '2026-01-01');
  await addEmployee('D', 'Dev (joined mid-month)', 'PERMANENT_WORKER', '2026-06-16');

  const t = (await env.post('/templates', { plantTypeId: ids.forge, name: 'Forge standard' }, c.chr)).json().id;
  await env.put(`/templates/${t}/kras`, { kras: [{ nameEn: 'Productivity', pqcdsm: 'P', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 82, targets: [84, 86, 88, 90], weights: { STAFF: 100 } }] }, c.chr);
  expect((await env.post(`/templates/${t}/activate`, {}, c.chr2)).statusCode).toBe(200);
  expect((await env.post('/scorecards', { orgUnitId: ids.d1, fiscalYear: 2026 }, c.phr)).statusCode).toBe(201);

  // Rs 3,000 for Asha, Dev and Chitra; Chitra is a contract worker (not eligible); Babu has no base.
  const bases = ['A', 'D', 'C'].map((employeeCode) => ({ employeeCode, basePaise: 300000 }));
  expect((await env.put('/bonus/bases', { bases }, c.chr)).statusCode).toBe(200);
  await lockMonth(MONTH, 84);
});

afterAll(() => env.close());

describe('who can see and do what', () => {
  it('Admin holds no bonus permission at all: pay data is invisible to Admin', async () => {
    for (const url of ['/bonus/batches', '/bonus/rules', '/bonus/bases', `/bonus/export?period=${MONTH}`, '/me/bonus']) {
      expect((await env.get(url, c.admin)).statusCode).toBe(403);
    }
    expect((await calc({ period: MONTH }, c.admin)).statusCode).toBe(403);
    const admin = await env.pool.query("SELECT count(*)::int AS n FROM core.role_permission rp JOIN core.role r ON r.id = rp.role_id JOIN core.permission p ON p.id = rp.permission_id WHERE r.code = 'ADMIN' AND p.code LIKE 'bonus:%'");
    expect(admin.rows[0].n).toBe(0);
  });

  it('Plant HR, Plant Head, the HOD and Employees cannot calculate, export or list batches', async () => {
    for (const cookie of [c.phr, c.ph, c.hod, c.asha]) {
      expect((await calc({ period: MONTH }, cookie)).statusCode).toBe(403);
      expect((await env.get(`/bonus/export?period=${MONTH}`, cookie)).statusCode).toBe(403);
      expect((await env.get('/bonus/batches', cookie)).statusCode).toBe(403);
    }
  });

  it('only Corporate HR can set the bases and rules', async () => {
    for (const cookie of [c.md, c.phr, c.asha]) {
      expect((await env.put('/bonus/bases', { bases: [{ employeeCode: 'A', basePaise: 1 }] }, cookie)).statusCode).toBe(403);
      expect((await env.put('/bonus/rules', { bands: [{ minScore: 0, percentBp: 0, label: 'x' }] }, cookie)).statusCode).toBe(403);
    }
  });

  it('bases and rules are validated: whole paise only, a band from score 0, no duplicate starts', async () => {
    expect((await env.put('/bonus/bases', { bases: [{ employeeCode: 'A', basePaise: 3000.5 }] }, c.chr)).statusCode).toBe(400);
    expect((await env.put('/bonus/bases', { bases: [{ employeeCode: 'A', basePaise: -1 }] }, c.chr)).statusCode).toBe(400);
    expect((await env.put('/bonus/bases', { bases: [{ employeeCode: 'NOPE', basePaise: 1 }] }, c.chr)).statusCode).toBe(400);
    expect((await env.put('/bonus/rules', { bands: [{ minScore: 10, percentBp: 0, label: 'x' }] }, c.chr)).statusCode).toBe(400);
    expect((await env.put('/bonus/rules', { bands: [{ minScore: 0, percentBp: 0, label: 'a' }, { minScore: 0, percentBp: 1, label: 'b' }] }, c.chr)).statusCode).toBe(400);
    expect((await env.put('/bonus/rules', { bands: [{ minScore: 0, percentBp: 12.5, label: 'a' }] }, c.chr)).statusCode).toBe(400);
  });
});

describe('calculate, approve, lock', () => {
  it('calculates a plant-month from the locked scores: band -> percentage of base, pro-rated by days', async () => {
    const res = await calc({ period: MONTH });
    expect(res.statusCode).toBe(200);
    const p1 = res.json().batches.find((b: { plantCode: string }) => b.plantCode === 'P1');
    expect(p1.lines).toBe(4);
    // Asha 110% of Rs 3,000 = 3,300.00; Dev 15 of 30 days = 1,650.00; Babu (no base) and Chitra (contract) get 0.
    expect(p1.totalPaise).toBe(330000 + 165000);

    const detail = (await env.get(`/bonus/batches/${p1.id}`, c.chr)).json();
    const line = (code: string) => detail.lines.find((l: { employeeCode: string }) => l.employeeCode === code);
    expect(line('A')).toMatchObject({ score: 100, days: 30, basePaise: 300000, percentBp: 11000, amountPaise: 330000, band: '100 and above: 110%' });
    expect(line('D')).toMatchObject({ days: 15, amountPaise: 165000 });
    expect(line('B')).toMatchObject({ amountPaise: 0, note: 'NO_BASE' });
    expect(line('C')).toMatchObject({ amountPaise: 0, note: 'NOT_ELIGIBLE' });
    expect(detail.batch.state).toBe('CALCULATED');
  });

  it('skips a plant whose month is not fully locked', async () => {
    const res = await calc({ period: '2026-07' });
    expect(res.json().batches).toEqual([]);
    expect(res.json().skipped).toEqual(expect.arrayContaining([{ plantCode: 'P1', reason: 'MONTH_NOT_LOCKED' }]));
    expect((await calc({ period: 'June' })).statusCode).toBe(400);
  });

  it('Management sees batch totals but not the per-employee lines', async () => {
    const [batch] = await batchesOf(MONTH, c.md);
    expect(batch).toMatchObject({ plantCode: 'P1', state: 'CALCULATED' });
    expect((await env.get(`/bonus/batches/${batch.id}`, c.md)).statusCode).toBe(403);
    expect((await env.post(`/bonus/batches/${batch.id}/approve`, {}, c.md)).statusCode).toBe(403);
  });

  it('the person who calculated cannot approve it; a different Corporate HR user can, and that locks it', async () => {
    const [batch] = await batchesOf(MONTH);
    const own = await env.post(`/bonus/batches/${batch.id}/approve`, {}, c.chr);
    expect(own.statusCode).toBe(409);
    expect(own.json().error).toMatch(/^SOD:/);
    expect((await env.post(`/bonus/batches/${batch.id}/reject`, {}, c.chr2)).statusCode).toBe(400); // rejecting needs a comment

    expect((await env.post(`/bonus/batches/${batch.id}/approve`, {}, c.chr2)).json()).toEqual({ state: 'LOCKED' });
    expect((await env.post(`/bonus/batches/${batch.id}/approve`, {}, c.chr2)).statusCode).toBe(409);
    expect((await calc({ period: MONTH })).json().skipped).toEqual(expect.arrayContaining([{ plantCode: 'P1', reason: 'ALREADY_LOCKED' }]));
  });

  it('maker <> checker is enforced by the database too, and a locked batch can never be edited', async () => {
    const [batch] = await batchesOf(MONTH);
    const { pool } = env;
    await expect(pool.query("UPDATE pay.bonus_batch SET state = 'CALCULATED' WHERE id = $1", [batch.id])).rejects.toThrow(/LOCKED/);
    await expect(pool.query('UPDATE pay.bonus_line SET amount_paise = 1 WHERE batch_id = $1', [batch.id])).rejects.toThrow(/LOCKED/);
    await expect(pool.query('DELETE FROM pay.bonus_line WHERE batch_id = $1', [batch.id])).rejects.toThrow(/LOCKED/);
    await expect(pool.query('INSERT INTO pay.bonus_line (batch_id, employee_id, amount_paise) VALUES ($1,$2,100)', [batch.id, emp.A])).rejects.toThrow(/LOCKED/);
    await expect(pool.query('DELETE FROM pay.bonus_batch WHERE id = $1', [batch.id])).rejects.toThrow(/LOCKED/);

    // A fresh batch: even straight SQL cannot make the calculator its own approver, or lock a batch with no decider.
    await lockMonth('2026-05', 84);
    const may = (await calc({ period: '2026-05' })).json().batches[0].id as string;
    await expect(pool.query("UPDATE pay.bonus_batch SET state = 'LOCKED', decided_by = calculated_by WHERE id = $1", [may])).rejects.toThrow();
    await expect(pool.query("UPDATE pay.bonus_batch SET state = 'LOCKED' WHERE id = $1", [may])).rejects.toThrow();
  });

  it('a rejected batch can be recalculated, and recalculating a calculated batch supersedes it', async () => {
    const [may] = (await batchesOf('2026-05')).filter((b) => b.state === 'CALCULATED');
    expect((await env.post(`/bonus/batches/${may.id}/reject`, { comment: 'Base amounts not final' }, c.chr2)).json()).toEqual({ state: 'REJECTED' });
    const again = (await calc({ period: '2026-05' })).json().batches[0].id as string;
    expect(again).not.toBe(may.id);
    const second = (await calc({ period: '2026-05' }, c.chr2)).json().batches[0].id as string; // recalculated before anyone decided
    const live = (await batchesOf('2026-05')).filter((b) => b.state === 'CALCULATED');
    expect(live.map((b) => b.id)).toEqual([second]);
    expect((await env.post(`/bonus/batches/${second}/approve`, {}, c.chr)).json()).toEqual({ state: 'LOCKED' }); // chr2 calculated it, chr approves
  });
});

describe('adjustments are a separate batch', () => {
  let regular: string;

  it('a locked batch is corrected only by an adjustment batch that needs its own approval', async () => {
    regular = (await batchesOf(MONTH)).find((b) => b.kind === 'REGULAR')!.id;
    const adjust = (body: object, cookie = c.chr) => env.post(`/bonus/batches/${regular}/adjustments`, body, cookie);
    expect((await adjust({ lines: [{ employeeCode: 'A', deltaPaise: 5000 }] })).statusCode).toBe(400); // reason required
    expect((await adjust({ reason: 'x', lines: [{ employeeCode: 'A', deltaPaise: 0 }] })).statusCode).toBe(400);
    expect((await adjust({ reason: 'x', lines: [{ employeeCode: 'A', deltaPaise: 12.5 }] })).statusCode).toBe(400);
    expect((await adjust({ reason: 'x', lines: [{ employeeCode: 'Z', deltaPaise: 100 }] })).statusCode).toBe(400); // not in the batch
    expect((await adjust({ reason: 'x', lines: [{ employeeCode: 'A', deltaPaise: 100 }] }, c.phr)).statusCode).toBe(403);

    const res = await adjust({ reason: 'Shift allowance omitted', lines: [{ employeeCode: 'A', deltaPaise: 5000 }, { employeeCode: 'D', deltaPaise: -2500, note: 'Overpaid' }] });
    expect(res.statusCode).toBe(201);
    const adjustment = res.json().id as string;
    const detail = (await env.get(`/bonus/batches/${adjustment}`, c.chr)).json();
    expect(detail.batch).toMatchObject({ kind: 'ADJUSTMENT', state: 'CALCULATED', parentBatchId: regular, totalPaise: 2500 });

    expect((await env.post(`/bonus/batches/${adjustment}/approve`, {}, c.chr)).statusCode).toBe(409); // same maker
    expect((await env.post(`/bonus/batches/${adjustment}/approve`, {}, c.chr2)).json()).toEqual({ state: 'LOCKED' });
    // The original batch is untouched.
    expect((await env.get(`/bonus/batches/${regular}`, c.chr)).json().batch).toMatchObject({ state: 'LOCKED', totalPaise: 495000 });
  });

  it('a regular line can never be negative, and a batch that is only calculated cannot be adjusted', async () => {
    await expect(env.pool.query('INSERT INTO pay.bonus_line (batch_id, employee_id, amount_paise) VALUES ($1,$2,-1)', [regular, emp.B])).rejects.toThrow();
    await lockMonth('2026-08', 84);
    const aug = (await calc({ period: '2026-08' })).json().batches[0].id as string;
    expect((await env.post(`/bonus/batches/${aug}/adjustments`, { reason: 'x', lines: [{ employeeCode: 'A', deltaPaise: 1 }] }, c.chr)).statusCode).toBe(409);
  });
});

describe('statement and payroll export', () => {
  it('an Employee sees only their own locked bonus, with the adjustment as its own line', async () => {
    const s = (await env.get('/me/bonus', c.asha)).json();
    expect(s.totalPaise).toBe(330000 + 5000 + 330000); // June bonus + June adjustment + May bonus
    const june = s.months.find((m: { period: string }) => m.period === MONTH);
    expect(june.totalPaise).toBe(335000);
    expect(june.lines.map((l: { kind: string }) => l.kind).sort()).toEqual(['ADJUSTMENT', 'REGULAR']);
    expect(june.lines.find((l: { kind: string }) => l.kind === 'REGULAR')).toMatchObject({ score: 100, basePaise: 300000, percentBp: 11000, amountPaise: 330000 });
    expect(s.months.some((m: { period: string }) => m.period === '2026-08')).toBe(false); // August is calculated, not locked: not shown
    expect((await env.get('/me/bonus', c.chr)).statusCode).toBe(403); // not an Employee
    expect((await env.get('/me/bonus')).statusCode).toBe(401);
  });

  it('exports the locked month as CSV and as an Excel workbook, in integer paise', async () => {
    const csv = await env.get(`/bonus/export?period=${MONTH}&format=csv`, c.chr);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-disposition']).toContain(`bonus-${MONTH}.csv`);
    const lines = csv.body.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Employee code,Employee name,Period,Plant,Batch type,Score,Days,Base (paise),Percent of base,Amount (paise),Amount (rupees),Note');
    expect(lines).toContain('A,Test A,2026-06,P1,Bonus,100,30,300000,110.00,330000,3300.00,');
    expect(lines.some((l) => l.includes('Adjustment') && l.includes(',5000,50.00,'))).toBe(true);
    expect(lines.some((l) => l.includes(',-2500,-25.00,Overpaid'))).toBe(true);

    const xlsx = await env.get(`/bonus/export?period=${MONTH}&format=xlsx`, c.chr);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.rawPayload.includes(Buffer.from('xl/worksheets/sheet1.xml'))).toBe(true);
    expect(xlsx.rawPayload.includes(Buffer.from('<v>330000</v>'))).toBe(true);

    expect((await env.get('/bonus/export?period=2026-08', c.chr)).statusCode).toBe(404); // calculated but not locked
    expect((await env.get(`/bonus/export?period=${MONTH}&format=pdf`, c.chr)).statusCode).toBe(400);
  });
});

describe('integrity', () => {
  it('the pay schema has no floating-point column', async () => {
    const { rows } = await env.pool.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'pay' AND data_type IN ('real','double precision')");
    expect(rows).toEqual([]);
    const money = await env.pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'pay' AND column_name LIKE '%paise'");
    expect(money.rows.length).toBeGreaterThanOrEqual(3);
    expect(money.rows.every((r) => r.data_type === 'bigint')).toBe(true);
  });

  it('the audit log records every step with counts but no amounts, and its chain is intact', async () => {
    const { rows } = await env.pool.query("SELECT action, after FROM core.audit_log WHERE action LIKE 'BONUS_%'");
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['BONUS_CALCULATED', 'BONUS_BATCH_APPROVED', 'BONUS_BATCH_REJECTED', 'BONUS_ADJUSTMENT_CREATED', 'BONUS_EXPORTED', 'BONUS_BASES_SAVED']) expect(actions.has(a)).toBe(true);
    const text = JSON.stringify(rows);
    for (const amount of ['330000', '300000', '165000', '3300.00']) expect(text).not.toContain(amount);
    expect(await verifyAuditChain(env.pool)).toBeNull();
  });
});
