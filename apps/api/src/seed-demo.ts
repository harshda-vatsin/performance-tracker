/**
 * Demo seed: a small, readable data set for a 10-minute client demo (docs/DEMO-SCRIPT.md). It loads ONLY into a database
 * named `mmf_demo`; the dev seed (seed.ts) and the `mmf` / `mmf_local` databases are never touched.
 *
 *   3 plants, one scorecard per plant (the plant itself is the scoring unit, no shops): Plant A and Plant B are Forge
 *   plants on the same template, Plant C is a Machine shop with its own template (Cell Incharge / Setter / Staff).
 *   Shop floor: Jul-Sep 2026 locked, Oct open in draft for Plant A. A improves, B declines, C holds steady.
 *   Senior staff: three people, one finalised (Outstanding), one waiting for the manager, one at self-assessment.
 *   Bonus: calculated, approved and locked for Jul-Sep.
 *
 * Everything goes through the real API and service functions, so the demo data obeys the same rules, scoring and audit
 * trail as real use.   npm run seed:demo -w @mmf/api   (with DATABASE_URL pointing at mmf_demo)
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from './app.js';
import { audit } from './audit.js';
import { createUserAccount } from './auth/service.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { daysInMonth, quarterOf } from './fiscal.js';
import { migrate } from './migrate.js';
import { loadAssignments } from './rbac/policy.js';
import { fiscalMonths } from './scoring/rollup.js';
import { confirmMonth, createCycle, getDetail, replaceGoals, saveAssessment, saveResults, transition, type Ctx, type GoalsInput, type ResultItem } from './senior/service.js';

export const DEMO_DB = 'mmf_demo';
export const DEMO_PASSWORD = 'Demo-2026-Pass';
const FY = 2026;
const LOCKED_MONTHS = ['2026-07', '2026-08', '2026-09'];
const OPEN_MONTH = '2026-10';

type PlantKey = 'A' | 'B' | 'C';
const PLANT_CODE: Record<PlantKey, string> = { A: 'PLANT-A', B: 'PLANT-B', C: 'PLANT-C' };

interface DemoUser {
  login: string;
  name: string;
  role: 'ADMIN' | 'MGMT' | 'CHR' | 'PHR' | 'PH' | 'HOD' | 'EMP';
  plant?: PlantKey;
  note: string;
}

const USERS: DemoUser[] = [
  { login: 'md', name: 'Meera Rao', role: 'MGMT', note: 'Management' },
  { login: 'hr', name: 'Hari Prasad', role: 'CHR', note: 'Corporate HR' },
  { login: 'hrhead', name: 'Latha Krishnan', role: 'CHR', note: 'Corporate HR (second user, approves what hr prepares)' },
  { login: 'planthr', name: 'Priya Nair', role: 'PHR', plant: 'A', note: 'Plant HR, Plant A' },
  { login: 'planthead', name: 'Prakash Menon', role: 'PH', plant: 'A', note: 'Plant Head, Plant A' },
  { login: 'manager', name: 'Manoj Kulkarni', role: 'HOD', plant: 'A', note: 'Manager (HOD)' },
  { login: 'senior', name: 'Sanjay Patil', role: 'EMP', note: 'Senior staff, at self-assessment' },
  { login: 'employee', name: 'Asha Menon', role: 'EMP', plant: 'A', note: 'Supervisor, Plant A' },
  { login: 'admin', name: 'Arjun Shah', role: 'ADMIN', note: 'Admin (IT)' },
  // Not in the demo script: they hold the other two senior appraisals, and enter the Plant B and C history.
  { login: 'senior2', name: 'Sunita Joshi', role: 'EMP', note: 'Senior staff, waiting for the manager' },
  { login: 'senior3', name: 'Kiran Rao', role: 'EMP', note: 'Senior staff, finalised (Outstanding)' },
  { login: 'planthr-b', name: 'Bhavna Desai', role: 'PHR', plant: 'B', note: 'Plant HR, Plant B' },
  { login: 'planthr-c', name: 'Chetan Mehta', role: 'PHR', plant: 'C', note: 'Plant HR, Plant C' },
];

// ------------------------------------------------------------- templates --

interface KraSpec {
  nameEn: string;
  pqcdsm: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  unit: string;
  presentLevel: number;
  targets: number[];
  weights: Record<string, number>;
}

const FORGE_LEVELS: [string, string][] = [['HOD', 'HOD'], ['SHIFT_INCHARGE', 'Shift Incharge'], ['SUPERVISOR', 'Supervisor']];
const MACHINE_LEVELS: [string, string][] = [['CELL_INCHARGE', 'Cell Incharge'], ['SETTER', 'Setter'], ['STAFF', 'Staff']];

const FORGE_KRAS: KraSpec[] = [
  { nameEn: 'Production output vs plan', pqcdsm: 'P', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 88, targets: [90, 92, 94, 96], weights: { HOD: 20, SHIFT_INCHARGE: 25, SUPERVISOR: 30 } },
  { nameEn: 'Rejection', pqcdsm: 'Q', direction: 'LOWER_BETTER', unit: '%', presentLevel: 3.2, targets: [3.0, 2.8, 2.6, 2.4], weights: { HOD: 15, SHIFT_INCHARGE: 20, SUPERVISOR: 25 } },
  { nameEn: 'Energy per ton forged', pqcdsm: 'C', direction: 'LOWER_BETTER', unit: 'kWh/t', presentLevel: 410, targets: [405, 400, 395, 390], weights: { HOD: 15, SHIFT_INCHARGE: 10, SUPERVISOR: 10 } },
  { nameEn: 'On-time delivery', pqcdsm: 'D', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 91, targets: [92, 93, 94, 95], weights: { HOD: 20, SHIFT_INCHARGE: 20, SUPERVISOR: 15 } },
  { nameEn: 'Unsafe conditions open', pqcdsm: 'S', direction: 'LOWER_BETTER', unit: 'count', presentLevel: 5, targets: [4, 3, 2, 1], weights: { HOD: 15, SHIFT_INCHARGE: 15, SUPERVISOR: 15 } },
  { nameEn: 'Kaizen suggestions implemented', pqcdsm: 'M', direction: 'HIGHER_BETTER', unit: 'count', presentLevel: 2, targets: [3, 4, 5, 6], weights: { HOD: 15, SHIFT_INCHARGE: 10, SUPERVISOR: 5 } },
];

const MACHINE_KRAS: KraSpec[] = [
  { nameEn: 'Output vs plan', pqcdsm: 'P', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 85, targets: [87, 89, 91, 93], weights: { CELL_INCHARGE: 25, SETTER: 30, STAFF: 35 } },
  { nameEn: 'Rejection', pqcdsm: 'Q', direction: 'LOWER_BETTER', unit: '%', presentLevel: 2.9, targets: [2.8, 2.7, 2.6, 2.5], weights: { CELL_INCHARGE: 20, SETTER: 25, STAFF: 25 } },
  { nameEn: 'Tool cost per piece', pqcdsm: 'C', direction: 'LOWER_BETTER', unit: 'Rs', presentLevel: 14, targets: [13.5, 13, 12.5, 12], weights: { CELL_INCHARGE: 10, SETTER: 10, STAFF: 5 } },
  { nameEn: 'On-time delivery', pqcdsm: 'D', direction: 'HIGHER_BETTER', unit: '%', presentLevel: 90, targets: [91, 92, 93, 94], weights: { CELL_INCHARGE: 20, SETTER: 15, STAFF: 15 } },
  { nameEn: 'Unsafe conditions open', pqcdsm: 'S', direction: 'LOWER_BETTER', unit: 'count', presentLevel: 4, targets: [3, 2, 1, 0], weights: { CELL_INCHARGE: 15, SETTER: 15, STAFF: 15 } },
  { nameEn: 'Kaizen suggestions implemented', pqcdsm: 'M', direction: 'HIGHER_BETTER', unit: 'count', presentLevel: 1, targets: [2, 3, 4, 5], weights: { CELL_INCHARGE: 10, SETTER: 5, STAFF: 5 } },
];

// ----------------------------------------------------------- shop-floor people --

interface Person {
  code: string;
  name: string;
  level: string;
  /** Monthly bonus base, in rupees. */
  base: number;
}

const FLOOR: Record<PlantKey, Person[]> = {
  A: [
    { code: 'A001', name: 'Ramesh Iyer', level: 'HOD', base: 6000 },
    { code: 'A002', name: 'Dinesh Kumar', level: 'SHIFT_INCHARGE', base: 4500 },
    { code: 'A003', name: 'Mohan Das', level: 'SHIFT_INCHARGE', base: 4500 },
    { code: 'employee', name: 'Asha Menon', level: 'SUPERVISOR', base: 3000 },
    { code: 'A004', name: 'Vijay Nair', level: 'SUPERVISOR', base: 3000 },
    { code: 'A005', name: 'Suresh Pillai', level: 'SUPERVISOR', base: 3000 },
    { code: 'A006', name: 'Anita George', level: 'SUPERVISOR', base: 3000 },
    { code: 'A007', name: 'Rajiv Menon', level: 'SUPERVISOR', base: 3000 },
  ],
  B: [
    { code: 'B001', name: 'Naveen Shetty', level: 'HOD', base: 6000 },
    { code: 'B002', name: 'Kavya Reddy', level: 'SHIFT_INCHARGE', base: 4500 },
    { code: 'B003', name: 'Imran Khan', level: 'SHIFT_INCHARGE', base: 4500 },
    { code: 'B004', name: 'Lata Shah', level: 'SUPERVISOR', base: 3000 },
    { code: 'B005', name: 'Tarun Gupta', level: 'SUPERVISOR', base: 3000 },
    { code: 'B006', name: 'Meena Das', level: 'SUPERVISOR', base: 3000 },
  ],
  C: [
    { code: 'C001', name: 'Farhan Ali', level: 'CELL_INCHARGE', base: 6000 },
    { code: 'C002', name: 'Gita Rao', level: 'SETTER', base: 4500 },
    { code: 'C003', name: 'Harish Nayak', level: 'SETTER', base: 4500 },
    { code: 'C004', name: 'Ishaan Roy', level: 'STAFF', base: 3000 },
    { code: 'C005', name: 'Jaya Singh', level: 'STAFF', base: 3000 },
    { code: 'C006', name: 'Kamal Verma', level: 'STAFF', base: 3000 },
  ],
};

/** How far each month's results go from the present level towards the target (1.0 = exactly on target). */
const TREND: Record<PlantKey, number[]> = {
  A: [0.8, 1.0, 1.25], // improving
  B: [1.25, 1.0, 0.7], // declining
  C: [1.0, 1.05, 0.95], // steady
};

function resultFor(k: Pick<KraSpec, 'unit' | 'presentLevel' | 'targets'>, quarter: number, factor: number): number {
  const value = k.presentLevel + (k.targets[quarter - 1] - k.presentLevel) * factor;
  if (k.unit === 'count') return Math.max(0, Math.round(value));
  if (k.unit === '%') return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
  return Math.round(value * 100) / 100;
}

// ------------------------------------------------------------ senior staff --

type SeniorKpi = GoalsInput['kras'][number]['kpis'][number];
const kpi = (name: string, unit: string, direction: SeniorKpi['direction'], presentLevel: number, targets: number[], weight: number): SeniorKpi => ({ name, unit, direction, presentLevel, targets, weight });

const SENIORS: { login: string; goals: GoalsInput; factor: number; through: 'SELF_ASSESSMENT' | 'MANAGER_ASSESSMENT' | 'FINALISED' }[] = [
  {
    login: 'senior',
    factor: 1.0,
    through: 'SELF_ASSESSMENT',
    goals: {
      kras: [
        { name: 'Quality', weight: 60, kpis: [kpi('Customer complaints', 'count', 'LOWER_BETTER', 6, [5, 4, 3, 2], 50), kpi('Rejection', '%', 'LOWER_BETTER', 3.2, [3.0, 2.8, 2.6, 2.4], 50)] },
        { name: 'Delivery', weight: 40, kpis: [kpi('On-time delivery', '%', 'HIGHER_BETTER', 91, [92, 93, 94, 95], 100)] },
      ],
    },
  },
  {
    login: 'senior2',
    factor: 0.95,
    through: 'MANAGER_ASSESSMENT',
    goals: {
      kras: [
        { name: 'Production', weight: 60, kpis: [kpi('Production output vs plan', '%', 'HIGHER_BETTER', 88, [90, 92, 94, 96], 60), kpi('Energy per ton forged', 'kWh/t', 'LOWER_BETTER', 410, [405, 400, 395, 390], 40)] },
        { name: 'Safety', weight: 40, kpis: [kpi('Unsafe conditions open', 'count', 'LOWER_BETTER', 5, [4, 3, 2, 1], 100)] },
      ],
    },
  },
  {
    login: 'senior3',
    factor: 1.35,
    through: 'FINALISED',
    goals: {
      kras: [
        { name: 'Maintenance', weight: 50, kpis: [kpi('Machine downtime', '%', 'LOWER_BETTER', 8, [7.5, 7, 6.5, 6], 60), kpi('Preventive maintenance done', '%', 'HIGHER_BETTER', 90, [92, 94, 96, 98], 40)] },
        { name: 'Cost', weight: 50, kpis: [kpi('Spares cost index', 'Rs', 'LOWER_BETTER', 100, [98, 96, 94, 92], 100)] },
      ],
    },
  },
];

// ------------------------------------------------------------------- seed --

export interface DemoLogin {
  login: string;
  password: string;
  role: string;
  scope: string;
  note: string;
}

/** Returns the logins created, or null when the database already holds an organisation. Refuses any database but mmf_demo. */
export async function seedDemo(pool: pg.Pool, password: string = process.env.DEMO_PASSWORD ?? DEMO_PASSWORD): Promise<DemoLogin[] | null> {
  const db = (await pool.query('SELECT current_database() AS name')).rows[0].name as string;
  if (db !== DEMO_DB) throw new Error(`The demo seed only loads into a database named "${DEMO_DB}", not "${db}". Point DATABASE_URL at ${DEMO_DB}.`);
  await migrate(pool);
  if ((await pool.query('SELECT 1 FROM core.org_unit LIMIT 1')).rowCount) return null;

  const plants = await seedOrg(pool);
  const userIds = new Map<string, string>();
  const employeeIds = new Map<string, string>();
  const logins: DemoLogin[] = [];
  for (const u of USERS) {
    const { userId, employeeId } = await createUserAccount(pool, { employeeCode: u.login, fullName: u.name, password });
    userIds.set(u.login, userId);
    employeeIds.set(u.login, employeeId);
    const scopeType = u.role === 'ADMIN' || u.role === 'MGMT' || u.role === 'CHR' ? 'COMPANY' : u.role === 'EMP' ? 'SELF' : 'PLANT';
    await pool.query('INSERT INTO core.role_assignment (user_id, role_id, scope_type, scope_id) SELECT $1, id, $3, $4 FROM core.role WHERE code = $2', [userId, u.role, scopeType, scopeType === 'PLANT' ? plants.get(u.plant!) : null]);
    await audit(pool, { action: 'ROLE_GRANTED', entityType: 'user_account', entityId: userId, after: { role: u.role, scope: u.plant ? PLANT_CODE[u.plant] : scopeType } });
    logins.push({ login: u.login, password, role: u.role, scope: scopeType === 'SELF' ? 'own records' : u.plant ? `Plant ${u.plant}` : 'company', note: u.note });
  }
  await placeStaff(pool, plants, employeeIds);

  const app = buildApp(pool);
  try {
    const cookie = new Map<string, string>();
    for (const login of ['hr', 'hrhead', 'planthr', 'planthr-b', 'planthr-c']) cookie.set(login, await signIn(app, login, password));
    const call = async (as: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
      const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookie.get(as)! } });
      if (res.statusCode >= 300) throw new Error(`demo seed: ${method} ${url} as ${as} -> ${res.statusCode} ${res.body}`);
      return res.json();
    };

    // Templates: authored by hr, activated by the second Corporate HR user (maker <> checker).
    const plantTypes = (await pool.query('SELECT code, id FROM core.plant_type')).rows.reduce((m, r) => m.set(r.code, r.id), new Map<string, string>());
    for (const [type, name, kras] of [['FORGE', 'Forge standard', FORGE_KRAS], ['MACHINE', 'Machine shop standard', MACHINE_KRAS]] as const) {
      const t = await call('hr', 'POST', '/templates', { plantTypeId: plantTypes.get(type), name });
      await call('hr', 'PUT', `/templates/${t.id}/kras`, { kras });
      await call('hrhead', 'POST', `/templates/${t.id}/activate`, {});
    }
    for (const p of ['A', 'B', 'C'] as const) await call('hr', 'POST', '/scorecards', { orgUnitId: plants.get(p), fiscalYear: FY });

    // Shop floor: three locked months for every plant, then October open in draft for Plant A.
    const plantHr: Record<PlantKey, string> = { A: 'planthr', B: 'planthr-b', C: 'planthr-c' };
    for (const [i, period] of LOCKED_MONTHS.entries()) {
      for (const p of ['A', 'B', 'C'] as const) {
        const kras = p === 'C' ? MACHINE_KRAS : FORGE_KRAS;
        const id = (await call(plantHr[p], 'POST', '/submissions', { orgUnitId: plants.get(p), period })).id as string;
        const detail = await call(plantHr[p], 'GET', `/submissions/${id}`);
        await call(plantHr[p], 'PUT', `/submissions/${id}/results`, {
          results: detail.results.map((r: { kraId: string; nameEn: string }, k: number) => ({
            kraId: r.kraId,
            result: resultFor(kras.find((x) => x.nameEn === r.nameEn)!, quarterOf(period), TREND[p][i] + ((k * 7 + i * 3) % 5 - 2) * 0.02),
          })),
        });
        await call(plantHr[p], 'PUT', `/submissions/${id}/level-assignments`, { assignments: stints(p, period, employeeIds) });
        await call(plantHr[p], 'POST', `/submissions/${id}/transitions`, { action: 'submit' });
        await call('hr', 'POST', `/submissions/${id}/transitions`, { action: 'lock' });
      }
    }
    const october = (await call('planthr', 'POST', '/submissions', { orgUnitId: plants.get('A'), period: OPEN_MONTH })).id as string;
    await call('planthr', 'PUT', `/submissions/${october}/level-assignments`, { assignments: stints('A', OPEN_MONTH, employeeIds) });

    // Bonus: base amounts, then every locked month calculated by hr and approved (locked) by hrhead.
    const bases = (['A', 'B', 'C'] as const).flatMap((p) => FLOOR[p].map((x) => ({ employeeCode: x.code, basePaise: x.base * 100 })));
    await call('hr', 'PUT', '/bonus/bases', { bases });
    for (const period of LOCKED_MONTHS) {
      const calc = await call('hr', 'POST', '/bonus/calculate', { period });
      for (const b of calc.batches as { id: string }[]) await call('hrhead', 'POST', `/bonus/batches/${b.id}/approve`, {});
    }
  } finally {
    await app.close();
  }

  await seedSeniors(pool, userIds, employeeIds);
  return logins;
}

async function signIn(app: FastifyInstance, login: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { loginId: login, password } });
  if (res.statusCode !== 200 || !res.cookies[0]) throw new Error(`demo seed: sign-in as ${login} failed (${res.statusCode})`);
  return `${res.cookies[0].name}=${res.cookies[0].value}`;
}

async function seedOrg(pool: pg.Pool): Promise<Map<PlantKey, string>> {
  const type = async (code: string, name: string, b: number, levels: [string, string][]) => {
    const { rows } = await pool.query('INSERT INTO core.plant_type (code, name, scoring_unit_type, defaults) VALUES ($1,$2,$3,$4) RETURNING id', [code, name, 'PLANT', JSON.stringify({ scoring: { baseScoreB: b } })]);
    for (const [i, [lc, ln]] of levels.entries()) await pool.query('INSERT INTO core.people_level (plant_type_id, code, name_en, rank) VALUES ($1,$2,$3,$4)', [rows[0].id, lc, ln, i + 1]);
    return rows[0].id as string;
  };
  const forge = await type('FORGE', 'Forge', 60, FORGE_LEVELS);
  const machine = await type('MACHINE', 'Machine shop', 50, MACHINE_LEVELS);
  const unit = async (parent: string | null, kind: string, code: string, name: string, plantType: string | null = null) =>
    (await pool.query('INSERT INTO core.org_unit (parent_id, unit_type, plant_type_id, code, name) VALUES ($1,$2,$3,$4,$5) RETURNING id', [parent, kind, plantType, code, name])).rows[0].id as string;
  const company = await unit(null, 'COMPANY', 'DEMO', 'Demo Company');
  return new Map<PlantKey, string>([
    ['A', await unit(company, 'PLANT', PLANT_CODE.A, 'Plant A', forge)],
    ['B', await unit(company, 'PLANT', PLANT_CODE.B, 'Plant B', forge)],
    ['C', await unit(company, 'PLANT', PLANT_CODE.C, 'Plant C', machine)],
  ]);
}

/** Employee records and placements for the shop floor and the three senior staff. */
async function placeStaff(pool: pg.Pool, plants: Map<PlantKey, string>, employeeIds: Map<string, string>): Promise<void> {
  const place = async (employeeId: string, plant: string, designation: string, category: string) =>
    pool.query(
      `INSERT INTO core.employee_assignment (employee_id, org_unit_id, category_id, designation, valid)
       SELECT $1, $2, id, $3, daterange('2026-04-01', NULL, '[)') FROM core.employee_category WHERE code = $4`,
      [employeeId, plant, designation, category],
    );
  for (const p of ['A', 'B', 'C'] as const) {
    for (const person of FLOOR[p]) {
      let id = employeeIds.get(person.code);
      if (!id) {
        id = (await pool.query('INSERT INTO core.employee (employee_code, full_name) VALUES ($1,$2) RETURNING id', [person.code, person.name])).rows[0].id as string;
        employeeIds.set(person.code, id);
      }
      await place(id, plants.get(p)!, person.level, 'PERMANENT_WORKER');
    }
  }
  for (const login of ['senior', 'senior2', 'senior3']) await place(employeeIds.get(login)!, plants.get('A')!, 'Senior staff', 'STAFF');
}

const stints = (p: PlantKey, period: string, employeeIds: Map<string, string>) =>
  FLOOR[p].map((x) => ({ employeeId: employeeIds.get(x.code), levelCode: x.level, daysInUnit: daysInMonth(period) }));

async function seedSeniors(pool: pg.Pool, userIds: Map<string, string>, employeeIds: Map<string, string>): Promise<void> {
  const ctxOf = async (login: string): Promise<Ctx & { userId: string; employeeId: string }> => {
    const userId = userIds.get(login)!;
    const employeeId = employeeIds.get(login)!;
    return { auth: { userId, employeeId, assignments: await loadAssignments(pool, userId) }, ip: null, userId, employeeId };
  };
  const [hr, manager] = [await ctxOf('hr'), await ctxOf('manager')];
  const months = fiscalMonths(FY).slice(0, 6); // Apr-Sep

  for (const s of SENIORS) {
    const emp = await ctxOf(s.login);
    const id = await createCycle(pool, hr, { employeeId: emp.employeeId, fiscalYear: FY, managerUserId: manager.userId });
    await replaceGoals(pool, manager, id, s.goals);
    await transition(pool, manager, id, 'issue', null);
    await transition(pool, emp, id, 'acknowledge', null);
    const kpis = (await getDetail(pool, manager, id)).goals.kras.flatMap((k) => k.kpis);
    for (const [i, period] of months.entries()) {
      const factor = s.factor + ((i * 3) % 5 - 2) * 0.02;
      const results: ResultItem[] = kpis.map((k) => ({ kpiId: k.id, result: resultFor(k, quarterOf(period), factor) }));
      await saveResults(pool, manager, id, period, results);
      await confirmMonth(pool, manager, id, period);
    }
    await transition(pool, hr, id, 'open_appraisal', null);
    if (s.through === 'SELF_ASSESSMENT') continue;

    await saveAssessment(pool, emp, id, { summary: 'Met most of my targets this half. Delivery was steady; I want to start earlier on tooling issues next quarter.' });
    await transition(pool, emp, id, 'submit_self', null);
    if (s.through === 'MANAGER_ASSESSMENT') continue;

    await saveAssessment(pool, manager, id, { summary: 'Delivered well above target through the year and worked well with other teams. Ready for wider responsibility.' });
    await transition(pool, manager, id, 'submit_manager', null);
    await transition(pool, hr, id, 'finalise', 'Finalised for the year.');
  }
}

if (process.argv[1]?.endsWith('seed-demo.ts')) {
  if (config.isProduction) throw new Error('Refusing to seed in production');
  const pool = createPool();
  seedDemo(pool)
    .then((rows) => {
      if (!rows) return console.log('The demo database already has an organisation; seed skipped (drop it to reload).');
      console.log(`\nDemo data loaded. Every login uses the password:  ${rows[0].password}\n`);
      console.table(rows.map(({ password: _p, ...r }) => r));
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
