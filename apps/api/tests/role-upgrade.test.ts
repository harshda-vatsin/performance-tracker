import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUserAccount } from '../src/auth/service.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db.js';

/**
 * Migration 005 on a database that already holds users in the eleven old roles: nothing is dropped, every assignment
 * lands in one of the seven new roles, and people who lose a company-wide or assigned scope keep only their own records.
 */

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const adminUrl = process.env.TEST_ADMIN_URL ?? config.databaseUrl.replace(/\/[^/]+$/, '/postgres');
const upgradeUrl = config.databaseUrl.replace(/\/[^/]+$/, '/mmf_test_upgrade');

let pool: pg.Pool;
let plantId: string;

const sql = async (file: string) => pool.query(await readFile(path.join(migrationsDir, file), 'utf8'));

async function holder(code: string, role: string, scopeType: string, scopeId: string | null = null) {
  const { userId } = await createUserAccount(pool, { employeeCode: code, fullName: `Old ${code}`, password: 'correct-horse-battery' });
  await pool.query(
    `INSERT INTO core.role_assignment (user_id, role_id, scope_type, scope_id) SELECT $1, id, $3, $4 FROM core.role WHERE code = $2`,
    [userId, role, scopeType, scopeId],
  );
}

const assignmentOf = async (login: string) =>
  (
    await pool.query(
      `SELECT r.code AS role, ra.scope_type AS "scopeType", ra.scope_id AS "scopeId"
       FROM core.role_assignment ra JOIN core.role r ON r.id = ra.role_id JOIN core.user_account u ON u.id = ra.user_id
       WHERE u.login_id = $1`,
      [login],
    )
  ).rows;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS mmf_test_upgrade WITH (FORCE)');
  await admin.query('CREATE DATABASE mmf_test_upgrade');
  await admin.end();
  pool = createPool(upgradeUrl);

  for (const f of ['001_foundation.sql', '002_master_data.sql', '003_monthly_cycle.sql', '004_scorecard_changes.sql']) await sql(f);
  const company = (await pool.query("INSERT INTO core.org_unit (unit_type, code, name) VALUES ('COMPANY','MMF','MM') RETURNING id")).rows[0].id;
  const forge = (await pool.query("INSERT INTO core.plant_type (code, name) VALUES ('FORGE','Forge') RETURNING id")).rows[0].id;
  plantId = (await pool.query("INSERT INTO core.org_unit (parent_id, unit_type, plant_type_id, code, name) VALUES ($1,'PLANT',$2,'P1','Plant 1') RETURNING id", [company, forge])).rows[0].id;

  await holder('O1', 'SA', 'COMPANY');
  await holder('O2', 'MD', 'COMPANY');
  await holder('O3', 'CHR', 'COMPANY');
  await holder('O4', 'CHR_H', 'COMPANY');
  await holder('O5', 'AUD', 'COMPANY');
  await holder('O6', 'PHR', 'PLANT', plantId);
  await holder('O7', 'PH', 'PLANT', plantId);
  await holder('O8', 'HOD', 'PLANT', plantId);
  await holder('O9', 'SUP', 'SELF');
  await holder('O10', 'SEN', 'SELF');
  await holder('O11', 'REV', 'ASSIGNED');
  await sql('005_role_simplification.sql');
});

afterAll(async () => {
  await pool.end();
});

describe('upgrading a database with the old roles', () => {
  it('leaves exactly the seven roles', async () => {
    const codes = (await pool.query('SELECT code FROM core.role ORDER BY code')).rows.map((r) => r.code);
    expect(codes).toEqual(['ADMIN', 'CHR', 'EMP', 'HOD', 'MGMT', 'PH', 'PHR']);
  });

  it('keeps every assignment and maps it to the right new role and scope', async () => {
    expect((await pool.query('SELECT count(*)::int AS n FROM core.role_assignment')).rows[0].n).toBe(11);
    expect(await assignmentOf('O1')).toEqual([{ role: 'ADMIN', scopeType: 'COMPANY', scopeId: null }]);
    expect(await assignmentOf('O2')).toEqual([{ role: 'MGMT', scopeType: 'COMPANY', scopeId: null }]);
    expect(await assignmentOf('O3')).toEqual([{ role: 'CHR', scopeType: 'COMPANY', scopeId: null }]);
    expect(await assignmentOf('O4')).toEqual([{ role: 'CHR', scopeType: 'COMPANY', scopeId: null }]); // was CHR_H
    expect(await assignmentOf('O6')).toEqual([{ role: 'PHR', scopeType: 'PLANT', scopeId: plantId }]);
    expect(await assignmentOf('O8')).toEqual([{ role: 'HOD', scopeType: 'PLANT', scopeId: plantId }]);
    for (const login of ['O5', 'O9', 'O10', 'O11']) expect(await assignmentOf(login)).toEqual([{ role: 'EMP', scopeType: 'SELF', scopeId: null }]);
  });

  it('the former auditor no longer has company-wide reach, and the former Co-HR Head keeps their approvals as Corporate HR', async () => {
    const perms = async (login: string) =>
      (
        await pool.query(
          `SELECT DISTINCT p.code FROM core.role_assignment ra JOIN core.role_permission rp ON rp.role_id = ra.role_id
           JOIN core.permission p ON p.id = rp.permission_id JOIN core.user_account u ON u.id = ra.user_id WHERE u.login_id = $1 ORDER BY p.code`,
          [login],
        )
      ).rows.map((r) => r.code);
    expect(await perms('O5')).toEqual(['myscores:read']);
    expect(await perms('O4')).toEqual(expect.arrayContaining(['templates:approve', 'reopen:approve', 'audit:read_business']));
  });

  it('keeps the remaining separation-of-duties guards: Admin stays apart, PHR and PH cannot share a plant', async () => {
    const userId = async (login: string) => (await pool.query('SELECT id FROM core.user_account WHERE login_id = $1', [login])).rows[0].id;
    const grant = async (login: string, role: string, scope: string, scopeId: string | null) =>
      pool.query(`INSERT INTO core.role_assignment (user_id, role_id, scope_type, scope_id) SELECT $1, id, $3, $4 FROM core.role WHERE code = $2`, [await userId(login), role, scope, scopeId]);
    await expect(grant('O1', 'CHR', 'COMPANY', null)).rejects.toThrow(/SOD: Admin cannot be combined/);
    await expect(grant('O6', 'PH', 'PLANT', plantId)).rejects.toThrow(/SOD: PHR and PH cannot be held at the same plant/);
    // CHR + CHR_H used to be forbidden on one account; with one role there is nothing left to forbid.
    await expect(grant('O3', 'CHR', 'COMPANY', null)).resolves.toBeDefined();
  });
});
