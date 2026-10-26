/**
 * Dev-only seed: one organisation, three plants with sub-units, 20 users covering every role.
 * Passwords are random per run and printed once; nothing is written to disk.
 *   npm run seed -w @mmf/api
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { audit } from './audit.js';
import { createUserAccount } from './auth/service.js';
import { config } from './config.js';
import { createPool, withTransaction } from './db.js';
import { migrate } from './migrate.js';
import { seedSeniorCycles } from './senior/seed.js';

interface SeedUser {
  code: string;
  name: string;
  role: string;
  /** Org unit code the role is scoped to; omit for COMPANY / SELF scopes. */
  unit?: string;
  scopeType: 'COMPANY' | 'PLANT' | 'DEPARTMENT' | 'CELL' | 'SELF';
  authMode?: 'PASSWORD' | 'OTP_ONLY';
}

const USERS: SeedUser[] = [
  { code: 'E0001', name: 'Arun Kumar (IT admin)', role: 'ADMIN', scopeType: 'COMPANY' },
  { code: 'E0002', name: 'Meera Subramanian (MD)', role: 'MGMT', scopeType: 'COMPANY' },
  // Two Corporate HR users, so one can author a template or reopen request and the other can approve it.
  { code: 'E0003', name: 'Ravi Shankar (Corporate HR)', role: 'CHR', scopeType: 'COMPANY' },
  { code: 'E0004', name: 'Lakshmi Narayanan (Corporate HR)', role: 'CHR', scopeType: 'COMPANY' },
  { code: 'E0005', name: 'Suresh Babu (Employee, head office)', role: 'EMP', scopeType: 'SELF' },
  // Plant 1: Trichy (Forge)
  { code: 'E0101', name: 'Kavitha R (Plant HR, Trichy)', role: 'PHR', unit: 'TRY', scopeType: 'PLANT' },
  { code: 'E0102', name: 'Murugan S (Plant Head, Trichy)', role: 'PH', unit: 'TRY', scopeType: 'PLANT' },
  { code: 'E0103', name: 'Senthil K (HOD, Hammer Shop)', role: 'HOD', unit: 'TRY-HAM', scopeType: 'DEPARTMENT' },
  { code: 'E0104', name: 'Palani V (HOD, Press Shop)', role: 'HOD', unit: 'TRY-PRS', scopeType: 'DEPARTMENT' },
  { code: 'E0105', name: 'Dinesh M (Shift Incharge)', role: 'EMP', scopeType: 'SELF' },
  { code: 'E0106', name: 'Selvam P (Supervisor, floor)', role: 'EMP', scopeType: 'SELF', authMode: 'OTP_ONLY' },
  { code: 'E0107', name: 'Priya L (Senior engineer)', role: 'EMP', scopeType: 'SELF' },
  // Plant 2: Singampunari (Machine)
  { code: 'E0201', name: 'Anitha G (Plant HR, Singampunari)', role: 'PHR', unit: 'SGP', scopeType: 'PLANT' },
  { code: 'E0202', name: 'Karthik J (Plant Head, Singampunari)', role: 'PH', unit: 'SGP', scopeType: 'PLANT' },
  { code: 'E0203', name: 'Vignesh T (Cell Incharge, MAG)', role: 'HOD', unit: 'SGP-MAG', scopeType: 'CELL' },
  { code: 'E0204', name: 'Gopal N (Cell Incharge, TML)', role: 'HOD', unit: 'SGP-TML', scopeType: 'CELL' },
  { code: 'E0205', name: 'Rajesh A (Setter and Supervisor)', role: 'EMP', scopeType: 'SELF' },
  { code: 'E0206', name: 'Divya B (Employee)', role: 'EMP', scopeType: 'SELF' },
  // Plant 3: Viralimalai (Forge), for scope tests
  { code: 'E0301', name: 'Ramesh C (Plant HR, Viralimalai)', role: 'PHR', unit: 'VLM', scopeType: 'PLANT' },
  { code: 'E0302', name: 'Sangeetha D (Senior engineer)', role: 'EMP', scopeType: 'SELF' },
  { code: 'E0303', name: 'Mohan S (HOD, Forge Shop 1)', role: 'HOD', unit: 'VLM-FS1', scopeType: 'DEPARTMENT' },
  // Senior-staff track (Module A): a third senior employee. The sample cycles are built in senior/seed.ts.
  { code: 'E0108', name: 'Anand R (Senior manager, Quality)', role: 'EMP', scopeType: 'SELF' },
];

/** FY 2026-27 appraisals for the two senior engineers; the reviewer is an assignment, not a role. */
const APPRAISALS: { employee: string; reviewer: string }[] = [
  { employee: 'E0107', reviewer: 'E0102' }, // Plant Head, Trichy
  { employee: 'E0302', reviewer: 'E0002' }, // Management
];

async function unit(
  db: pg.Pool | pg.PoolClient,
  parent: string | null,
  type: string,
  code: string,
  name: string,
  plantTypeId: string | null = null,
): Promise<string> {
  const { rows } = await db.query(
    'INSERT INTO core.org_unit (parent_id, unit_type, plant_type_id, code, name) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [parent, type, plantTypeId, code, name],
  );
  return rows[0].id;
}

async function seedOrg(pool: pg.Pool): Promise<Map<string, string>> {
  return withTransaction(pool, async (tx) => {
    // Base score B and scored-unit level per plant type (doc 05 §1.2; placeholders until client questions 2 and 3 are answered).
    const forge = (
      await tx.query(`INSERT INTO core.plant_type (code, name, scoring_unit_type, defaults) VALUES ('FORGE','Forge shop','DEPARTMENT','{"scoring":{"baseScoreB":60}}') RETURNING id`)
    ).rows[0].id;
    const machine = (
      await tx.query(`INSERT INTO core.plant_type (code, name, scoring_unit_type, defaults) VALUES ('MACHINE','Machine shop','CELL','{"scoring":{"baseScoreB":50}}') RETURNING id`)
    ).rows[0].id;

    const ids = new Map<string, string>();
    const mmf = await unit(tx, null, 'COMPANY', 'MMF', 'MM Forgings Ltd');
    ids.set('MMF', mmf);

    const trichy = await unit(tx, mmf, 'PLANT', 'TRY', 'Trichy (Forge)', forge);
    ids.set('TRY', trichy);
    ids.set('TRY-HAM', await unit(tx, trichy, 'DEPARTMENT', 'TRY-HAM', 'Hammer Shop'));
    ids.set('TRY-PRS', await unit(tx, trichy, 'DEPARTMENT', 'TRY-PRS', 'Press Shop'));

    const singampunari = await unit(tx, mmf, 'PLANT', 'SGP', 'Singampunari (Machine)', machine);
    ids.set('SGP', singampunari);
    const measuring = await unit(tx, singampunari, 'DEPARTMENT', 'SGP-MS', 'Measuring Shop');
    ids.set('SGP-MS', measuring);
    ids.set('SGP-MAG', await unit(tx, measuring, 'CELL', 'SGP-MAG', 'MAG cell'));
    ids.set('SGP-TML', await unit(tx, measuring, 'CELL', 'SGP-TML', 'TML cell'));
    ids.set('SGP-ISZ', await unit(tx, measuring, 'CELL', 'SGP-ISZ', 'ISUZU cell'));

    const viralimalai = await unit(tx, mmf, 'PLANT', 'VLM', 'Viralimalai (Forge)', forge);
    ids.set('VLM', viralimalai);
    ids.set('VLM-FS1', await unit(tx, viralimalai, 'DEPARTMENT', 'VLM-FS1', 'Forge Shop 1'));
    return ids;
  });
}

const LEVELS: Record<string, [string, string][]> = {
  FORGE: [['HOD', 'HOD'], ['SHIFT_INCHARGE', 'Shift Incharge'], ['SUPERVISOR', 'Supervisor']],
  MACHINE: [['CELL_INCHARGE', 'Cell Incharge'], ['SETTER_SUPERVISOR', 'Setter & Supervisor'], ['STAFF', 'Staff']],
};

// Sample KPI definitions for development only; the real library comes from the client's PMS sheets.
const KPIS: [code: string, name: string, pqcdsm: string, direction: string, unit: string][] = [
  ['PROD_OUTPUT', 'Production output vs plan', 'P', 'HIGHER_BETTER', '%'],
  ['REJECTION', 'Rejection', 'Q', 'LOWER_BETTER', '%'],
  ['ENERGY_PER_TON', 'Energy per ton forged', 'C', 'LOWER_BETTER', 'kWh/t'],
  ['OTD', 'On-time delivery', 'D', 'HIGHER_BETTER', '%'],
  ['UNSAFE_CONDITIONS', 'Unsafe conditions reported open', 'S', 'LOWER_BETTER', 'count'],
  ['KAIZEN', 'Kaizen suggestions implemented', 'M', 'HIGHER_BETTER', 'count'],
];

/** Idempotent: safe to run on an already-seeded database (adds only what is missing). */
async function seedReferenceData(pool: pg.Pool): Promise<void> {
  for (const [plantType, levels] of Object.entries(LEVELS)) {
    for (const [i, [code, name]] of levels.entries()) {
      await pool.query(
        `INSERT INTO core.people_level (plant_type_id, code, name_en, rank)
         SELECT id, $2, $3, $4 FROM core.plant_type WHERE code = $1
         ON CONFLICT (plant_type_id, code) DO NOTHING`,
        [plantType, code, name, i + 1],
      );
    }
  }
  for (const [code, name, pqcdsm, direction, unit] of KPIS) {
    await pool.query(
      'INSERT INTO core.kpi_library (code, name_en, pqcdsm, direction, unit) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING',
      [code, name, pqcdsm, direction, unit],
    );
  }
}

export interface SeededLogin {
  login: string;
  password: string;
  name: string;
  role: string;
  scope: string;
}

/** Returns the generated logins, or null when the database already holds an organisation. */
export async function seed(pool: pg.Pool): Promise<SeededLogin[] | null> {
  await migrate(pool);
  const existing = await pool.query('SELECT 1 FROM core.org_unit LIMIT 1');
  if (existing.rowCount) {
    await seedReferenceData(pool);
    return null;
  }

  const units = await seedOrg(pool);
  await seedReferenceData(pool);
  const created: SeededLogin[] = [];
  for (const u of USERS) {
    // SEED_PASSWORD gives every dev user one known password (used by the browser e2e suite); otherwise random per user.
    const password = process.env.SEED_PASSWORD ?? randomBytes(12).toString('base64url');
    const { userId } = await createUserAccount(pool, {
      employeeCode: u.code,
      fullName: u.name,
      password,
      authMode: u.authMode,
      mobile: `+9190000${u.code.slice(1)}`,
    });
    const scopeId = u.unit ? units.get(u.unit)! : null;
    await pool.query(
      `INSERT INTO core.role_assignment (user_id, role_id, scope_type, scope_id)
       SELECT $1, id, $3, $4 FROM core.role WHERE code = $2`,
      [userId, u.role, u.scopeType, scopeId],
    );
    await audit(pool, { action: 'ROLE_GRANTED', entityType: 'user_account', entityId: userId, after: { role: u.role, scope: u.unit ?? u.scopeType } });
    created.push({ login: u.code, password, name: u.name, role: u.role, scope: u.unit ?? u.scopeType });
  }

  const hr = (await pool.query("SELECT id FROM core.user_account WHERE login_id = 'E0003'")).rows[0].id;
  for (const a of APPRAISALS) {
    const { rows } = await pool.query(
      `INSERT INTO core.appraisal (employee_id, fiscal_year, reviewer_user_id, assigned_by, created_by)
       SELECT e.id, 2026, r.id, $3, $3
       FROM core.employee e, core.user_account r
       WHERE e.employee_code = $1 AND r.login_id = $2
       RETURNING id`,
      [a.employee, a.reviewer, hr],
    );
    await audit(pool, { actorId: hr, action: 'APPRAISAL_CREATED', entityType: 'appraisal', entityId: rows[0].id, after: { employeeCode: a.employee, fiscalYear: 2026, reviewer: a.reviewer } });
  }
  await seedSeniorCycles(pool);
  return created;
}

if (process.argv[1]?.endsWith('seed.ts')) {
  if (config.isProduction) throw new Error('Refusing to seed in production');
  const pool = createPool();
  seed(pool)
    .then((rows) => {
      if (!rows) return console.log('Database already has an organisation; seed skipped (drop the database to re-seed).');
      console.log(`Seeded ${rows.length} users. MFA_BYPASS is on for dev (mfaBypass=${config.mfaBypassUntilMfaSlice}).\n`);
      console.table(rows);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
