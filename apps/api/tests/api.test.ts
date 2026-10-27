import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/audit.js';
import { buildApp } from '../src/app.js';
import { createUserAccount } from '../src/auth/service.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const PASSWORD = 'correct-horse-battery';
const adminUrl = process.env.TEST_ADMIN_URL ?? config.databaseUrl.replace(/\/[^/]+$/, '/postgres');
const testUrl = config.databaseUrl.replace(/\/[^/]+$/, '/mmf_test');

let pool: pg.Pool;
let app: FastifyInstance;
const ids: Record<string, string> = {};

async function freshDatabase() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS mmf_test WITH (FORCE)');
  await admin.query('CREATE DATABASE mmf_test');
  await admin.end();
}

async function user(code: string, role?: string, scopeType = 'COMPANY', scopeId: string | null = null) {
  const { userId } = await createUserAccount(pool, { employeeCode: code, fullName: `Test ${code}`, password: PASSWORD });
  ids[code] = userId;
  if (role) await assign(userId, role, scopeType, scopeId);
  return userId;
}

async function assign(userId: string, role: string, scopeType: string, scopeId: string | null = null) {
  await pool.query(
    `INSERT INTO core.role_assignment (user_id, role_id, scope_type, scope_id)
     SELECT $1, id, $3, $4 FROM core.role WHERE code = $2`,
    [userId, role, scopeType, scopeId],
  );
}

async function loginAs(code: string, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { loginId: code, password } });
  const cookie = res.cookies[0] ? `${res.cookies[0].name}=${res.cookies[0].value}` : undefined;
  return { res, cookie };
}

const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
const post = (url: string, payload: unknown, cookie?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: cookie ? { cookie } : {} });

beforeAll(async () => {
  await freshDatabase();
  pool = createPool(testUrl);
  await migrate(pool);
  app = buildApp(pool);

  const ft = await pool.query("INSERT INTO core.plant_type (code, name) VALUES ('FORGE','Forge') RETURNING id");
  const company = await pool.query("INSERT INTO core.org_unit (unit_type, code, name) VALUES ('COMPANY','MMF','MM Forgings') RETURNING id");
  const p1 = await pool.query(
    "INSERT INTO core.org_unit (parent_id, unit_type, plant_type_id, code, name) VALUES ($1,'PLANT',$2,'P1','Plant 1') RETURNING id",
    [company.rows[0].id, ft.rows[0].id],
  );
  const p2 = await pool.query(
    "INSERT INTO core.org_unit (parent_id, unit_type, plant_type_id, code, name) VALUES ($1,'PLANT',$2,'P2','Plant 2') RETURNING id",
    [company.rows[0].id, ft.rows[0].id],
  );
  await pool.query("INSERT INTO core.org_unit (parent_id, unit_type, code, name) VALUES ($1,'DEPARTMENT','P1-FORGE','Forge Shop 1')", [p1.rows[0].id]);
  await pool.query("INSERT INTO core.org_unit (parent_id, unit_type, code, name) VALUES ($1,'DEPARTMENT','P2-FORGE','Forge Shop 2')", [p2.rows[0].id]);
  ids.p1 = p1.rows[0].id;
  ids.p2 = p2.rows[0].id;

  await user('E1001', 'ADMIN');
  await user('E1002', 'PHR', 'PLANT', ids.p1);
  await user('E1003', 'CHR');
  await user('E1004'); // no roles
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('authentication', () => {
  it('logs in with employee code + password and sets an HttpOnly session cookie', async () => {
    const { res } = await loginAs('E1001');
    expect(res.statusCode).toBe(200);
    expect(res.cookies[0]).toMatchObject({ name: config.session.cookieName, httpOnly: true, sameSite: 'Lax' });
    expect(res.json().user.loginId).toBe('E1001');
  });

  it('wrong password and unknown employee code are indistinguishable', async () => {
    const wrong = await loginAs('E1001', 'not-the-password');
    const unknown = await loginAs('E9999', 'whatever-password');
    expect(wrong.res.statusCode).toBe(401);
    expect(unknown.res.statusCode).toBe(401);
    expect(wrong.res.json()).toEqual(unknown.res.json());
  });

  it('locks the account after 5 failures, even for the correct password', async () => {
    await user('E2001');
    for (let i = 0; i < 5; i++) expect((await loginAs('E2001', 'bad-password-x')).res.statusCode).toBe(401);
    const locked = await loginAs('E2001');
    expect(locked.res.statusCode).toBe(423);
    expect(locked.cookie).toBeUndefined();
  });

  it('rejects requests without a session', async () => {
    expect((await get('/me')).statusCode).toBe(401);
    expect((await get('/org/units')).statusCode).toBe(401);
  });

  it('logout revokes the session', async () => {
    const { cookie } = await loginAs('E1003');
    expect((await get('/me', cookie)).statusCode).toBe(200);
    expect((await post('/auth/logout', {}, cookie)).statusCode).toBe(204);
    expect((await get('/me', cookie)).statusCode).toBe(401);
  });

  it('expires a session that has been idle too long', async () => {
    const { cookie } = await loginAs('E1004');
    expect((await get('/me', cookie)).statusCode).toBe(200);
    await pool.query("UPDATE core.auth_session SET last_seen = now() - interval '2 hours' WHERE user_id = $1", [ids.E1004]);
    expect((await get('/me', cookie)).statusCode).toBe(401);
  });

  it('keeps at most 3 concurrent sessions, revoking the oldest', async () => {
    await user('E2002');
    const cookies: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) cookies.push((await loginAs('E2002')).cookie);
    expect((await get('/me', cookies[0])).statusCode).toBe(401);
    expect((await get('/me', cookies[3])).statusCode).toBe(200);
  });
});

describe('authorisation (server-enforced)', () => {
  it('a user with no matching permission is forbidden, and the denial is audited', async () => {
    const { cookie } = await loginAs('E1004');
    expect((await get('/org/units', cookie)).statusCode).toBe(403);
    const { rows } = await pool.query("SELECT 1 FROM core.audit_log WHERE action = 'ACCESS_DENIED' AND actor_id = $1", [ids.E1004]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('/me lists only permissions the caller can use, so an Employee is offered their own records and nothing else', async () => {
    await user('E1090', 'EMP', 'SELF');
    const { cookie } = await loginAs('E1090');
    const me = (await get('/me', cookie)).json();
    expect(me.roles).toHaveLength(1);
    expect(me.permissions).toEqual(['bonus:own', 'myscores:read', 'senior:own']); // own scores, own bonus statement and own goal sheet
    expect((await get('/org/units', cookie)).statusCode).toBe(403);
    expect((await get('/me/scores', cookie)).statusCode).toBe(200);

    const { cookie: plant } = await loginAs('E1002');
    expect((await get('/me', plant)).json().permissions).toContain('submissions:enter');
  });

  it('plant-scoped Plant HR sees only their own plant subtree', async () => {
    const { cookie } = await loginAs('E1002');
    const res = await get('/org/units', cookie);
    expect(res.statusCode).toBe(200);
    const codes = res.json().units.map((u: { code: string }) => u.code);
    expect(codes).toEqual(['P1', 'P1-FORGE']);
  });

  it('company-wide Corporate HR sees every plant', async () => {
    const { cookie } = await loginAs('E1003');
    const codes = (await get('/org/units', cookie)).json().units.map((u: { code: string }) => u.code);
    expect(codes).toEqual(expect.arrayContaining(['MMF', 'P1', 'P2', 'P1-FORGE', 'P2-FORGE']));
  });

  it('only Super Admin can list users or grant roles', async () => {
    const phr = (await loginAs('E1002')).cookie;
    expect((await get('/admin/users', phr)).statusCode).toBe(403);
    expect((await post('/admin/role-assignments', { userId: ids.E1004, roleCode: 'HOD', scopeType: 'COMPANY' }, phr)).statusCode).toBe(403);

    const sa = (await loginAs('E1001')).cookie;
    const list = await get('/admin/users', sa);
    expect(list.statusCode).toBe(200);
    expect(Object.keys(list.json().users[0]).sort()).toEqual(
      ['authMode', 'employeeCode', 'fullName', 'id', 'loginId', 'mobile', 'status'],
    );
  });
});

describe('separation of duties', () => {
  const grant = async (userCode: string, roleCode: string, scopeType = 'COMPANY', scopeId?: string) => {
    const sa = (await loginAs('E1001')).cookie;
    return post('/admin/role-assignments', { userId: ids[userCode], roleCode, scopeType, scopeId }, sa);
  };

  it('rejects Super Admin + a business role on one account', async () => {
    const res = await grant('E1001', 'CHR');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/^SOD:/);
  });

  it('has no Co-HR Head role any more: granting CHR_H is an unknown role', async () => {
    const res = await grant('E1003', 'CHR_H');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('UNKNOWN_ROLE');
  });

  it('rejects PHR + PH at the same plant but allows them at different plants', async () => {
    expect((await grant('E1002', 'PH', 'PLANT', ids.p1)).statusCode).toBe(409);
    expect((await grant('E1002', 'PH', 'PLANT', ids.p2)).statusCode).toBe(201);
  });

  it('blocks OTP-only users from holding an MFA-required role', async () => {
    const { userId } = await createUserAccount(pool, { employeeCode: 'E3001', fullName: 'Floor user', password: PASSWORD, authMode: 'OTP_ONLY' });
    ids.E3001 = userId;
    const res = await grant('E3001', 'PHR', 'PLANT', ids.p1);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/^MFA:/);
  });

  it('rejects the same combinations when inserted directly in SQL (database-level guard)', async () => {
    await expect(assign(ids.E1001, 'MGMT', 'COMPANY')).rejects.toThrow(/SOD/);
  });
});

describe('audit log', () => {
  it('records logins, lockouts and role grants, and the hash chain is intact', async () => {
    const { rows } = await pool.query('SELECT DISTINCT action FROM core.audit_log');
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['USER_CREATED', 'LOGIN_OK', 'LOGIN_FAIL', 'ACCOUNT_LOCKED', 'LOGOUT', 'ROLE_GRANTED']));
    expect(await verifyAuditChain(pool)).toBeNull();
  });

  it('is append-only: UPDATE, DELETE and TRUNCATE are rejected', async () => {
    await expect(pool.query("UPDATE core.audit_log SET action = 'X' WHERE id = 1")).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM core.audit_log WHERE id = 1')).rejects.toThrow(/append-only/);
    await expect(pool.query('TRUNCATE core.audit_log')).rejects.toThrow(/append-only/);
  });

  it('detects tampering made by bypassing the triggers', async () => {
    const original = (await pool.query('SELECT action FROM core.audit_log WHERE id = 2')).rows[0].action;
    await pool.query('ALTER TABLE core.audit_log DISABLE TRIGGER audit_log_no_update');
    try {
      await pool.query("UPDATE core.audit_log SET action = 'FORGED' WHERE id = 2");
      expect(await verifyAuditChain(pool)).toBe(2);
    } finally {
      await pool.query('UPDATE core.audit_log SET action = $1 WHERE id = 2', [original]);
      await pool.query('ALTER TABLE core.audit_log ENABLE TRIGGER audit_log_no_update');
    }
    expect(await verifyAuditChain(pool)).toBeNull();
  });
});
