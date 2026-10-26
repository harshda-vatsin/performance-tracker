import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateTemplate, type DraftKra } from '../src/templates/validate.js';
import { setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let sa: string | undefined;
let chr: string | undefined;
let chr2: string | undefined;
let chrH: string | undefined;
let phr1: string | undefined;
let hod1: string | undefined;

beforeAll(async () => {
  env = await setupEnv();
  const { user, ids } = env;
  await user('E1001', 'SA');
  await user('E1002', 'PHR', 'PLANT', ids.p1);
  await user('E1003', 'CHR');
  await user('E1004', 'CHR_H');
  await user('E1006', 'CHR'); // second template author
  await user('E1007', 'HOD', 'DEPARTMENT', ids.d1);

  // People levels for the Forge plant type (created directly; the API path is tested below on a second type).
  for (const [code, rank] of [['HOD', 1], ['SHIFT_INCHARGE', 2], ['SUPERVISOR', 3]] as const) {
    await env.pool.query('INSERT INTO core.people_level (plant_type_id, code, name_en, rank) VALUES ($1,$2,$2,$3)', [ids.forge, code, rank]);
  }
  sa = (await env.loginAs('E1001')).cookie;
  phr1 = (await env.loginAs('E1002')).cookie;
  chr = (await env.loginAs('E1003')).cookie;
  chrH = (await env.loginAs('E1004')).cookie;
  chr2 = (await env.loginAs('E1006')).cookie;
  hod1 = (await env.loginAs('E1007')).cookie;
});

afterAll(() => env.close());

describe('reference data (config)', () => {
  it('only Super Admin can create plant types and people levels', async () => {
    expect((await env.post('/config/plant-types', { code: 'MACHINE', name: 'Machine shop' }, chr)).statusCode).toBe(403);
    const created = await env.post('/config/plant-types', { code: 'machine', name: 'Machine shop' }, sa);
    expect(created.statusCode).toBe(201);

    const typeId = created.json().id;
    const lvl = await env.post(`/config/plant-types/${typeId}/levels`, { code: 'cell_incharge', nameEn: 'Cell Incharge', rank: 1 }, sa);
    expect(lvl.statusCode).toBe(201);
    expect((await env.post(`/config/plant-types/${typeId}/levels`, { code: 'CELL_INCHARGE', nameEn: 'Dup', rank: 2 }, sa)).statusCode).toBe(409);
    expect((await env.post(`/config/plant-types/${typeId}/levels`, { code: 'X', nameEn: 'X', rank: 1.5 }, sa)).statusCode).toBe(400);

    const list = await env.get(`/config/plant-types/${typeId}/levels`, phr1);
    expect(list.json().levels.map((l: { code: string }) => l.code)).toEqual(['CELL_INCHARGE']);
  });

  it('lists employee categories to any signed-in user but rejects anonymous calls', async () => {
    expect((await env.get('/config/employee-categories', hod1)).json().categories.map((c: { code: string }) => c.code)).toContain('PERMANENT_WORKER');
    expect((await env.get('/config/employee-categories')).statusCode).toBe(401);
  });
});

describe('org units', () => {
  it('Corporate HR can add a plant; hierarchy rules are enforced', async () => {
    const plant = await env.post('/org/units', { unitType: 'PLANT', code: 'P3', name: 'Plant 3', parentId: env.ids.company, plantTypeId: env.ids.forge }, chr);
    expect(plant.statusCode).toBe(201);
    expect(plant.json().path).toBe('MMF.P3');
    expect((await env.post('/org/units', { unitType: 'CELL', code: 'C1', name: 'Cell', parentId: env.ids.company }, chr)).statusCode).toBe(400);
    expect((await env.post('/org/units', { unitType: 'PLANT', code: 'P4', name: 'No type', parentId: env.ids.company }, chr)).statusCode).toBe(400);
    expect((await env.post('/org/units', { unitType: 'COMPANY', code: 'MMF2', name: 'Second company' }, chr)).statusCode).toBe(409);
    expect((await env.post('/org/units', { unitType: 'PLANT', code: 'P3', name: 'Dup', parentId: env.ids.company, plantTypeId: env.ids.forge }, chr)).statusCode).toBe(409);
  });

  it('Plant HR can add units only inside their own plant', async () => {
    const own = await env.post('/org/units', { unitType: 'DEPARTMENT', code: 'P1-PRESS', name: 'Press', parentId: env.ids.p1 }, phr1);
    expect(own.statusCode).toBe(201);
    expect((await env.post('/org/units', { unitType: 'DEPARTMENT', code: 'P2-PRESS', name: 'Press', parentId: env.ids.p2 }, phr1)).statusCode).toBe(403);
    expect((await env.post('/org/units', { unitType: 'PLANT', code: 'P9', name: 'Rogue plant', parentId: env.ids.company, plantTypeId: env.ids.forge }, phr1)).statusCode).toBe(403);
  });

  it('cannot deactivate a unit that still has active children; out-of-scope units look missing', async () => {
    expect((await env.patch(`/org/units/${env.ids.p1}`, { active: false }, chr)).statusCode).toBe(409);
    expect((await env.patch(`/org/units/${env.ids.p2}`, { name: 'Hijack' }, phr1)).statusCode).toBe(404);
    expect((await env.patch(`/org/units/${env.ids.d1}`, { name: 'Forge Shop 1' }, phr1)).statusCode).toBe(200);
  });
});

describe('employees', () => {
  let emp1: string;

  it('Plant HR registers employees in their plant only; duplicates are rejected', async () => {
    const ok = await env.post('/employees', { employeeCode: 'EMP-1', fullName: 'Asha', orgUnitId: env.ids.d1, categoryCode: 'PERMANENT_WORKER', validFrom: '2026-01-01' }, phr1);
    expect(ok.statusCode).toBe(201);
    emp1 = ok.json().id;
    expect((await env.post('/employees', { employeeCode: 'EMP-X', fullName: 'Nope', orgUnitId: env.ids.d2, categoryCode: 'STAFF' }, phr1)).statusCode).toBe(403);
    expect((await env.post('/employees', { employeeCode: 'EMP-1', fullName: 'Dup', orgUnitId: env.ids.d1, categoryCode: 'STAFF' }, phr1)).statusCode).toBe(409);
    expect((await env.post('/employees', { employeeCode: 'EMP-Y', fullName: 'Bad', orgUnitId: env.ids.d1, categoryCode: 'ALIEN' }, phr1)).statusCode).toBe(400);
    expect((await env.post('/employees', { employeeCode: 'EMP-Z', fullName: 'Bad date', orgUnitId: env.ids.d1, categoryCode: 'STAFF', validFrom: '2026-02-30' }, phr1)).statusCode).toBe(400);
  });

  it('lists only employees inside the caller scope', async () => {
    await env.post('/employees', { employeeCode: 'EMP-2', fullName: 'Babu', orgUnitId: env.ids.d2, categoryCode: 'STAFF' }, chr);
    await env.post('/employees', { employeeCode: 'EMP-3', fullName: 'Chitra', orgUnitId: env.ids.d1, categoryCode: 'STAFF' }, phr1);

    const codes = async (cookie?: string) => (await env.get('/employees', cookie)).json().employees.map((e: { employeeCode: string }) => e.employeeCode);
    expect(await codes(phr1)).toEqual(['EMP-1', 'EMP-3']);
    expect(await codes(hod1)).toEqual(['EMP-1', 'EMP-3']);
    expect(await codes(chr)).toEqual(expect.arrayContaining(['EMP-1', 'EMP-2', 'EMP-3']));
  });

  it('a HOD can read but not change employees; other plants look missing to Plant HR', async () => {
    expect((await env.patch(`/employees/${emp1}`, { fullName: 'Changed' }, hod1)).statusCode).toBe(403);
    const emp2 = (await env.get('/employees', chr)).json().employees.find((e: { employeeCode: string }) => e.employeeCode === 'EMP-2').id;
    expect((await env.patch(`/employees/${emp2}`, { fullName: 'Changed' }, phr1)).statusCode).toBe(404);
    expect((await env.get(`/employees/${emp2}/assignments`, phr1)).statusCode).toBe(404);
  });

  it('updates are audited with before and after values', async () => {
    const res = await env.patch(`/employees/${emp1}`, { fullName: 'Asha K', mobile: '+919000000001' }, phr1);
    expect(res.statusCode).toBe(200);
    const { rows } = await env.pool.query("SELECT before, after FROM core.audit_log WHERE action = 'EMPLOYEE_UPDATED' AND entity_id = $1", [emp1]);
    expect(rows[0].before.fullName).toBe('Asha');
    expect(rows[0].after.fullName).toBe('Asha K');
    expect((await env.patch(`/employees/${emp1}`, { status: 'GONE' }, phr1)).statusCode).toBe(400);
  });

  it('transfers keep an effective-dated history and never overlap', async () => {
    const dept2 = (await env.pool.query("SELECT id FROM core.org_unit WHERE code = 'P1-PRESS'")).rows[0].id;
    const move = await env.post(`/employees/${emp1}/assignments`, { orgUnitId: dept2, categoryCode: 'PERMANENT_WORKER', validFrom: '2026-06-01' }, phr1);
    expect(move.statusCode).toBe(201);

    const history = (await env.get(`/employees/${emp1}/assignments`, phr1)).json().assignments;
    expect(history.map((a: { unitCode: string; validFrom: string; validTo: string | null }) => [a.unitCode, a.validFrom, a.validTo])).toEqual([
      ['P1-FORGE', '2026-01-01', '2026-06-01'],
      ['P1-PRESS', '2026-06-01', null],
    ]);

    // Back-dating before the open assignment began is refused; moving into another plant is out of scope.
    expect((await env.post(`/employees/${emp1}/assignments`, { orgUnitId: env.ids.d1, categoryCode: 'STAFF', validFrom: '2026-03-01' }, phr1)).statusCode).toBe(400);
    expect((await env.post(`/employees/${emp1}/assignments`, { orgUnitId: env.ids.d2, categoryCode: 'STAFF', validFrom: '2026-07-01' }, phr1)).statusCode).toBe(403);
  });

  it('the database itself rejects overlapping assignment ranges', async () => {
    const cat = (await env.pool.query("SELECT id FROM core.employee_category WHERE code = 'STAFF'")).rows[0].id;
    await expect(
      env.pool.query(
        "INSERT INTO core.employee_assignment (employee_id, org_unit_id, category_id, valid) VALUES ($1,$2,$3, daterange('2026-02-01','2026-03-01','[)'))",
        [emp1, env.ids.d1, cat],
      ),
    ).rejects.toThrow(/conflicting key|exclusion/i);
  });
});

describe('KPI library', () => {
  it('Corporate HR maintains the library; Plant HR can only read it', async () => {
    const item = { code: 'oee', nameEn: 'OEE', pqcdsm: 'p', direction: 'HIGHER_BETTER', unit: '%' };
    const created = await env.post('/kpi-library', item, chr);
    expect(created.statusCode).toBe(201);
    expect((await env.post('/kpi-library', item, chr)).statusCode).toBe(409);
    expect((await env.post('/kpi-library', { ...item, code: 'X', pqcdsm: 'Z' }, chr)).statusCode).toBe(400);
    expect((await env.post('/kpi-library', { ...item, code: 'Y' }, phr1)).statusCode).toBe(403);

    const list = (await env.get('/kpi-library', phr1)).json().items;
    expect(list.map((i: { code: string }) => i.code)).toEqual(['OEE']);
    expect((await env.patch(`/kpi-library/${created.json().id}`, { active: false }, chr)).statusCode).toBe(200);
  });
});

describe('KRA templates', () => {
  const kra = (nameEn: string, pqcdsm: string, direction: string, presentLevel: number, targets: number[], weights: Record<string, number>) => ({
    nameEn,
    pqcdsm,
    direction,
    unit: '%',
    presentLevel,
    targets,
    weights,
  });
  const validKras = () => [
    kra('Productivity', 'P', 'HIGHER_BETTER', 82, [84, 86, 88, 90], { HOD: 50, SHIFT_INCHARGE: 40, SUPERVISOR: 30 }),
    kra('Rejection', 'Q', 'LOWER_BETTER', 5, [4.5, 4, 3.5, 3], { HOD: 30, SHIFT_INCHARGE: 30, SUPERVISOR: 40 }),
    kra('Unsafe conditions', 'S', 'LOWER_BETTER', 4, [3, 2, 1, 0], { HOD: 20, SHIFT_INCHARGE: 30, SUPERVISOR: 30 }),
  ];
  let v1: string;
  let v2: string;
  let v3: string;

  it('an author drafts a template and saves KRAs; weights are checked per level', async () => {
    const created = await env.post('/templates', { plantTypeId: env.ids.forge, name: 'Forge standard' }, chr);
    expect(created.statusCode).toBe(201);
    expect(created.json().version).toBe(1);
    v1 = created.json().id;

    const saved = await env.put(`/templates/${v1}/kras`, { kras: validKras() }, chr);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().validation.errors).toEqual([]);
    expect(saved.json().validation.warnings.map((w: { message: string }) => w.message)).toEqual(
      expect.arrayContaining(['No weighted KRA covers category C', 'No weighted KRA covers category D', 'No weighted KRA covers category M']),
    );
  });

  it('rejects malformed KRAs and unknown level codes', async () => {
    const bad = validKras();
    bad[0].weights = { HOD: 50, CAPTAIN: 10 } as Record<string, number>;
    expect((await env.put(`/templates/${v1}/kras`, { kras: bad }, chr)).statusCode).toBe(400);
    expect((await env.put(`/templates/${v1}/kras`, { kras: [{ ...validKras()[0], targets: [1, 2, 3] }] }, chr)).statusCode).toBe(400);
    expect((await env.put(`/templates/${v1}/kras`, { kras: [{ ...validKras()[0], weights: { HOD: 101 } }] }, chr)).statusCode).toBe(400);
    expect((await env.get(`/templates/${v1}`, chr)).json().kras).toHaveLength(3); // failed saves changed nothing
  });

  it('only the author edits a draft, and only an approver (not the author) activates it', async () => {
    expect((await env.put(`/templates/${v1}/kras`, { kras: validKras() }, chr2)).statusCode).toBe(403);
    expect((await env.post(`/templates/${v1}/activate`, {}, chr)).statusCode).toBe(403);
    expect((await env.post(`/templates/${v1}/activate`, {}, phr1)).statusCode).toBe(403);

    const activated = await env.post(`/templates/${v1}/activate`, {}, chrH);
    expect(activated.statusCode).toBe(200);
    const detail = (await env.get(`/templates/${v1}`, chr)).json();
    expect(detail.template.status).toBe('ACTIVE');
    expect(detail.template.checkerId).toBe(env.ids.E1004);
  });

  it('an active template is immutable, in the API and in the database', async () => {
    expect((await env.put(`/templates/${v1}/kras`, { kras: validKras() }, chr)).statusCode).toBe(409);
    await expect(
      env.pool.query(
        "INSERT INTO core.template_kra (template_id, name_en, pqcdsm, direction, unit, present_level, q1_target, q2_target, q3_target, q4_target) VALUES ($1,'Sneaky','P','HIGHER_BETTER','%',1,2,2,2,2)",
        [v1],
      ),
    ).rejects.toThrow(/LOCKED/);
    await expect(env.pool.query('UPDATE core.template_kra_weight SET weight = 1 WHERE template_kra_id IN (SELECT id FROM core.template_kra WHERE template_id = $1)', [v1])).rejects.toThrow(/LOCKED/);
  });

  it('a new version is a draft copy; only one draft may exist at a time', async () => {
    const nv = await env.post(`/templates/${v1}/new-version`, {}, chr);
    expect(nv.statusCode).toBe(201);
    expect(nv.json().version).toBe(2);
    v2 = nv.json().id;
    const copy = (await env.get(`/templates/${v2}`, chr)).json();
    expect(copy.template.status).toBe('DRAFT');
    expect(copy.kras).toHaveLength(3);
    expect(copy.kras[0].weights).toEqual({ HOD: 50, SHIFT_INCHARGE: 40, SUPERVISOR: 30 });
    expect((await env.post(`/templates/${v1}/new-version`, {}, chr)).statusCode).toBe(409);
    expect((await env.post(`/templates/${v2}/new-version`, {}, chr)).statusCode).toBe(409);
  });

  it('refuses to activate when a level does not total exactly 100 (API and database)', async () => {
    const short = validKras();
    short[0].weights.HOD = 40; // HOD now totals 90
    expect((await env.put(`/templates/${v2}/kras`, { kras: short }, chr)).json().validation.errors[0]).toMatchObject({ code: 'LEVEL_WEIGHT_TOTAL', level: 'HOD' });

    const res = await env.post(`/templates/${v2}/activate`, {}, chrH);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('TEMPLATE_INVALID');
    expect(res.json().issues).toEqual([expect.objectContaining({ code: 'LEVEL_WEIGHT_TOTAL', level: 'HOD' })]);

    // Backstop: bypass the API and flip the status directly. The trigger still refuses.
    await expect(env.pool.query("UPDATE core.kra_template SET status = 'ACTIVE', checker_id = $2 WHERE id = $1", [v2, env.ids.E1004])).rejects.toThrow(/WEIGHTS: level HOD weights total 90/);
  });

  it('activating a corrected version retires the previous live version', async () => {
    await env.put(`/templates/${v2}/kras`, { kras: validKras() }, chr);
    expect((await env.post(`/templates/${v2}/activate`, {}, chrH)).statusCode).toBe(200);
    const status = async (id: string) => (await env.get(`/templates/${id}`, chr)).json().template.status;
    expect(await status(v1)).toBe('RETIRED');
    expect(await status(v2)).toBe('ACTIVE');
    const live = (await env.get(`/templates?plantTypeId=${env.ids.forge}&status=ACTIVE`, phr1)).json().templates;
    expect(live.map((t: { version: number }) => t.version)).toEqual([2]);
  });

  it('refuses a target on the wrong side of the present level (API and database)', async () => {
    v3 = (await env.post(`/templates/${v2}/new-version`, {}, chr)).json().id;
    const wrong = validKras();
    wrong[0].targets = [80, 86, 88, 90]; // HIGHER_BETTER with a target below present level 82
    await env.put(`/templates/${v3}/kras`, { kras: wrong }, chr);

    const res = await env.post(`/templates/${v3}/activate`, {}, chrH);
    expect(res.statusCode).toBe(422);
    expect(res.json().issues[0].code).toBe('TARGET_SIDE');
    await expect(env.pool.query("UPDATE core.kra_template SET status = 'ACTIVE', checker_id = $2 WHERE id = $1", [v3, env.ids.E1004])).rejects.toThrow(/TARGET/);
  });

  it('the database refuses a checker who is also the maker', async () => {
    await expect(env.pool.query('UPDATE core.kra_template SET checker_id = maker_id WHERE id = $1', [v3])).rejects.toThrow(/check constraint|violates/i);
  });

  it('Plant HR can read templates but not change them; activations are audited', async () => {
    expect((await env.get('/templates', phr1)).statusCode).toBe(200);
    expect((await env.post('/templates', { plantTypeId: env.ids.forge, name: 'Rogue' }, phr1)).statusCode).toBe(403);
    const { rows } = await env.pool.query("SELECT count(*)::int AS n FROM core.audit_log WHERE action = 'TEMPLATE_ACTIVATED'");
    expect(rows[0].n).toBe(2);
  });
});

describe('validateTemplate (pure)', () => {
  const base = (over: Partial<DraftKra>): DraftKra => ({
    nameEn: 'K',
    pqcdsm: 'P',
    direction: 'HIGHER_BETTER',
    presentLevel: 10,
    targets: [11, 12, 13, 14],
    weights: { A: 100 },
    ...over,
  });

  it('accepts fractional weights that total exactly 100 without float drift', () => {
    const v = validateTemplate(['A'], [base({ weights: { A: 33.33 } }), base({ weights: { A: 33.33 } }), base({ weights: { A: 33.34 } })]);
    expect(v.errors).toEqual([]);
  });

  it('flags a total of 99.99 and an empty template', () => {
    expect(validateTemplate(['A'], [base({ weights: { A: 99.99 } })]).errors[0].code).toBe('LEVEL_WEIGHT_TOTAL');
    expect(validateTemplate(['A'], []).errors[0].code).toBe('NO_KRAS');
    expect(validateTemplate([], [base({})]).errors[0].code).toBe('NO_LEVELS');
  });

  it('treats targets equal to the present level as a warning, and the wrong side as an error', () => {
    expect(validateTemplate(['A'], [base({ targets: [10, 10, 10, 10] })]).warnings.map((w) => w.code)).toContain('TARGET_EQ_PL');
    expect(validateTemplate(['A'], [base({ direction: 'LOWER_BETTER', targets: [9, 8, 7, 11] })]).errors.map((e) => e.code)).toContain('TARGET_SIDE');
  });
});
