import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';

/** The seven roles (doc 04 §2): grants, the self-approval blocks that outlive the Co-HR Head role, appraisal reviewers, the Employee view. */

let env: TestEnv;
const c: Record<string, string | undefined> = {};

beforeAll(async () => {
  env = await setupEnv();
  const { ids, user } = env;
  await user('E1001', 'ADMIN');
  await user('E1002', 'PHR', 'PLANT', ids.p1);
  await user('E1003', 'CHR');
  await user('E1004', 'CHR');
  await user('E1005', 'PH', 'PLANT', ids.p1);
  await user('E1007', 'HOD', 'DEPARTMENT', ids.d1);
  await user('E1011', 'MGMT');
  await user('E1020', 'EMP', 'SELF');
  await user('E1021', 'EMP', 'SELF');
  for (const code of ['E1001', 'E1002', 'E1003', 'E1004', 'E1005', 'E1007', 'E1011', 'E1020', 'E1021']) c[code] = (await env.loginAs(code)).cookie;
});

afterAll(async () => {
  await env.close();
});

const permissionsOf = async (role: string): Promise<string[]> =>
  (
    await env.pool.query(
      `SELECT p.code FROM core.role_permission rp JOIN core.role r ON r.id = rp.role_id JOIN core.permission p ON p.id = rp.permission_id
       WHERE r.code = $1 ORDER BY p.code`,
      [role],
    )
  ).rows.map((r) => r.code);

describe('the seven roles', () => {
  it('there are exactly seven, and the retired ones are gone', async () => {
    const codes = (await env.pool.query('SELECT code FROM core.role ORDER BY code')).rows.map((r) => r.code);
    expect(codes).toEqual(['ADMIN', 'CHR', 'EMP', 'HOD', 'MGMT', 'PH', 'PHR']);
  });

  it('Corporate HR holds what Co-HR Head used to approve with, and Employee holds only its own scores', async () => {
    expect(await permissionsOf('CHR')).toEqual(
      expect.arrayContaining(['templates:write', 'templates:approve', 'reopen:request', 'reopen:approve', 'submissions:lock', 'audit:read_business', 'appraisals:assign']),
    );
    expect(await permissionsOf('EMP')).toEqual(['myscores:read']);
    expect(await permissionsOf('ADMIN')).toEqual(expect.arrayContaining(['users:manage', 'audit:read_system']));
  });

  it('Admin still cannot be combined with a business role', async () => {
    const res = await env.post('/admin/role-assignments', { userId: env.ids.E1001, roleCode: 'CHR', scopeType: 'COMPANY' }, c.E1001);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/^SOD: Admin cannot be combined/);
  });
});

describe('self-approval is blocked by the database, whatever the role', () => {
  it('a reopen request cannot be decided by the person who made it', async () => {
    const client = await env.pool.connect();
    try {
      // Foreign keys are skipped in replica mode; CHECK constraints are not, which is what this test targets.
      await client.query('SET session_replication_role = replica');
      const user = randomUUID();
      await expect(
        client.query(
          `INSERT INTO core.reopen_request (submission_id, requested_by, reason, state, decided_by) VALUES ($1, $2, 'x', 'APPROVED', $2)`,
          [randomUUID(), user],
        ),
      ).rejects.toThrow(/reopen_request_check|check constraint/);
    } finally {
      await client.query('SET session_replication_role = DEFAULT');
      client.release();
    }
  });

  it('a Corporate HR user cannot approve their own template or scorecard change, but a second one can (API)', async () => {
    // Templates are exercised end to end in master-data.test.ts; scorecard changes in slice4.test.ts. Here: the grants line up.
    expect(await permissionsOf('CHR')).toEqual(expect.arrayContaining(['templates:write', 'templates:approve', 'scorecards:propose', 'scorecards:approve']));
  });
});

describe('appraisal reviewers are an assignment, not a role', () => {
  let appraisalId: string;
  const emp = (code: string) => env.pool.query('SELECT id FROM core.employee WHERE employee_code = $1', [code]).then((r) => r.rows[0].id as string);

  async function insertAppraisal(employeeCode: string, reviewerCode: string | null, fy = 2026) {
    return env.pool.query(
      `INSERT INTO core.appraisal (employee_id, fiscal_year, reviewer_user_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [await emp(employeeCode), fy, reviewerCode ? env.ids[reviewerCode] : null, env.ids.E1003],
    );
  }

  it('the database accepts HOD / Manager, Plant Head and Management reviewers', async () => {
    await insertAppraisal('E1020', 'E1007', 2024);
    await insertAppraisal('E1020', 'E1005', 2025);
    await insertAppraisal('E1021', 'E1011', 2024);
  });

  it('the database rejects any other reviewer: Employee, Plant HR, Corporate HR, Admin', async () => {
    for (const [i, reviewer] of ['E1021', 'E1002', 'E1003', 'E1001'].entries()) {
      await expect(insertAppraisal('E1020', reviewer, 2030 + i)).rejects.toThrow(/SOD: a reviewer must hold/);
    }
  });

  it('nobody reviews their own appraisal, even with a qualifying role', async () => {
    await expect(insertAppraisal('E1007', 'E1007', 2026)).rejects.toThrow(/SOD: an employee cannot review their own appraisal/);
  });

  it('Corporate HR creates an appraisal with a reviewer; the reviewer and Management see it, Plant HR may not', async () => {
    const created = await env.post('/appraisals', { employeeCode: 'E1020', fiscalYear: 2026, reviewerLoginId: 'E1007' }, c.E1003);
    expect(created.statusCode).toBe(201);
    appraisalId = created.json().id;

    const asReviewer = (await env.get('/appraisals?fiscalYear=2026', c.E1007)).json().appraisals;
    expect(asReviewer).toEqual([expect.objectContaining({ employeeCode: 'E1020', reviewerLoginId: 'E1007', fiscalYear: 2026 })]);
    expect((await env.get('/appraisals?fiscalYear=2026', c.E1011)).json().appraisals).toHaveLength(1);
    expect((await env.get('/appraisals', c.E1002)).statusCode).toBe(403);
    expect((await env.get('/appraisals', c.E1020)).statusCode).toBe(403);
    expect((await env.post('/appraisals', { employeeCode: 'E1020', fiscalYear: 2026 }, c.E1003)).statusCode).toBe(409); // one per employee per year
  });

  it('a reviewer outside the unit scope still sees only appraisals assigned to them', async () => {
    // E1005 (Plant Head) has plant scope; E1020 has no unit, so E1005 sees the 2025 appraisal only because they review it.
    const seen = (await env.get('/appraisals?fiscalYear=2025', c.E1005)).json().appraisals;
    expect(seen).toHaveLength(1);
    expect((await env.get('/appraisals?fiscalYear=2026', c.E1005)).json().appraisals).toHaveLength(0);
  });

  it('reassigning the reviewer is audited and the same rules apply through the API', async () => {
    const ok = await env.put(`/appraisals/${appraisalId}/reviewer`, { reviewerLoginId: 'E1005' }, c.E1003);
    expect(ok.statusCode).toBe(200);
    const notQualified = await env.put(`/appraisals/${appraisalId}/reviewer`, { reviewerLoginId: 'E1021' }, c.E1003);
    expect(notQualified.statusCode).toBe(409);
    expect(notQualified.json().error).toMatch(/^SOD: a reviewer must hold/);
    expect((await env.put(`/appraisals/${appraisalId}/reviewer`, { reviewerLoginId: 'NOPE' }, c.E1003)).statusCode).toBe(400);
    expect((await env.put(`/appraisals/${appraisalId}/reviewer`, { reviewerLoginId: 'E1007' }, c.E1002)).statusCode).toBe(403);
    // A plant-scoped Plant Head cannot assign for an employee outside the plant (E1020 has no unit): answered as not found.
    expect((await env.put(`/appraisals/${appraisalId}/reviewer`, { reviewerLoginId: 'E1007' }, c.E1005)).statusCode).toBe(404);

    const { rows } = await env.pool.query("SELECT before, after FROM core.audit_log WHERE action = 'APPRAISAL_REVIEWER_ASSIGNED' AND entity_id = $1", [appraisalId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ reviewer: 'E1007' });
    expect(rows[0].after).toMatchObject({ reviewer: 'E1005' });
  });
});

describe('what an Employee sees', () => {
  it('only their own locked unit-level results; nothing when there are none', async () => {
    const levelId = (await env.pool.query("INSERT INTO core.people_level (plant_type_id, code, name_en, rank) VALUES ($1,'HOD','HOD',1) RETURNING id", [env.ids.forge])).rows[0].id;
    const empId = (await env.pool.query("SELECT id FROM core.employee WHERE employee_code = 'E1020'")).rows[0].id;
    const client = await env.pool.connect();
    try {
      // Fixture rows only: foreign keys and guard triggers are skipped in replica mode.
      await client.query('SET session_replication_role = replica');
      const any = randomUUID();
      const run = async (period: string, state: string, superseded: boolean) => {
        const sub = (
          await client.query(
            `INSERT INTO core.monthly_submission (org_unit_id, period, scorecard_version_id, state, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [env.ids.d1, period, any, state, any],
          )
        ).rows[0].id;
        const cr = (
          await client.query(
            `INSERT INTO core.calc_run (submission_id, revision, params, engine_version, input_hash, inputs, ran_by, superseded_at)
             VALUES ($1, 1, '{}', 't', 'h', '{}', $2, ${superseded ? 'now()' : 'NULL'}) RETURNING id`,
            [sub, any],
          )
        ).rows[0].id;
        await client.query('INSERT INTO core.employee_score (calc_run_id, employee_id, period, people_level_id, days_in_unit, score) VALUES ($1,$2,$3,$4,30,91.5)', [cr, empId, period, levelId]);
      };
      await run('2026-05', 'LOCKED', false);
      await run('2026-06', 'APPROVED', false); // not locked yet: hidden
      await run('2026-07', 'LOCKED', true); // official run superseded by a reopen: hidden
    } finally {
      await client.query('SET session_replication_role = DEFAULT');
      client.release();
    }

    const mine = (await env.get('/me/scores', c.E1020)).json();
    expect(mine.unitMonths).toEqual([{ period: '2026-05', unitCode: 'P1-FORGE', unitName: 'P1-FORGE', levelCode: 'HOD', levelName: 'HOD', daysInUnit: 30, score: '91.5' }]);
    expect((await env.get('/me/scores', c.E1021)).json().unitMonths).toEqual([]);
  });

  it('is refused to every role that is not an Employee', async () => {
    for (const code of ['E1001', 'E1002', 'E1003', 'E1005', 'E1007', 'E1011']) expect((await env.get('/me/scores', c[code])).statusCode).toBe(403);
    expect((await env.get('/me/scores')).statusCode).toBe(401);
  });
});

describe('the read-only audit log', () => {
  type Event = { id: number; action: string; category: string; actorLoginId: string | null };
  const SYSTEM = ['LOGIN_OK', 'LOGIN_FAIL', 'LOGIN_BLOCKED', 'LOGOUT', 'ACCOUNT_LOCKED', 'USER_CREATED', 'ROLE_GRANTED', 'ROLE_GRANT_REJECTED', 'ACCESS_DENIED'];

  it('Admin sees system events only; Corporate HR sees business events only', async () => {
    const admin = (await env.get('/audit-log?limit=200', c.E1001)).json();
    expect(admin.categories).toEqual(['system']);
    expect(admin.events.length).toBeGreaterThan(0);
    expect(admin.events.every((e: Event) => e.category === 'system' && SYSTEM.includes(e.action))).toBe(true);
    expect(admin.events.map((e: Event) => e.action)).toEqual(expect.arrayContaining(['LOGIN_OK', 'USER_CREATED', 'ROLE_GRANT_REJECTED']));

    const hr = (await env.get('/audit-log?limit=200', c.E1003)).json();
    expect(hr.categories).toEqual(['business']);
    expect(hr.events.every((e: Event) => e.category === 'business' && !SYSTEM.includes(e.action))).toBe(true);
    expect(hr.events.map((e: Event) => e.action)).toEqual(expect.arrayContaining(['APPRAISAL_CREATED', 'APPRAISAL_REVIEWER_ASSIGNED']));
  });

  it('a caller cannot ask for the category they do not hold', async () => {
    expect((await env.get('/audit-log?category=business', c.E1001)).statusCode).toBe(403);
    expect((await env.get('/audit-log?category=system', c.E1003)).statusCode).toBe(403);
    expect((await env.get('/audit-log?category=system', c.E1001)).statusCode).toBe(200);
    expect((await env.get('/audit-log?category=other', c.E1001)).statusCode).toBe(400);
  });

  it('every other role is refused, and nothing can be written through the API', async () => {
    for (const code of ['E1002', 'E1005', 'E1007', 'E1011', 'E1020']) {
      expect((await env.get('/audit-log', c[code])).statusCode).toBe(403);
      expect((await env.get('/audit-log/integrity', c[code])).statusCode).toBe(403);
    }
    expect((await env.get('/audit-log')).statusCode).toBe(401);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect((await env.app.inject({ method, url: '/audit-log', payload: {}, headers: { cookie: c.E1001! } })).statusCode).toBe(404);
    }
  });

  it('pages newest first with a cursor, and filters by action, actor and date', async () => {
    const first = (await env.get('/audit-log?limit=2', c.E1001)).json();
    expect(first.events).toHaveLength(2);
    expect(first.events[0].id).toBeGreaterThan(first.events[1].id);
    expect(first.nextBefore).toBe(first.events[1].id);
    const next = (await env.get(`/audit-log?limit=2&before=${first.nextBefore}`, c.E1001)).json();
    expect(next.events.every((e: Event) => e.id < first.nextBefore)).toBe(true);

    const byAction = (await env.get('/audit-log?action=APPRAISAL_CREATED', c.E1003)).json().events;
    expect(byAction.length).toBeGreaterThan(0);
    expect(byAction.every((e: Event) => e.action === 'APPRAISAL_CREATED' && e.actorLoginId === 'E1003')).toBe(true);
    expect((await env.get('/audit-log?actor=E1004', c.E1003)).json().events).toEqual([]);
    expect((await env.get('/audit-log?from=2999-01-01', c.E1003)).json().events).toEqual([]);
    expect((await env.get('/audit-log?to=2000-01-01', c.E1003)).json().events).toEqual([]);
    for (const bad of ['limit=0', 'limit=500', 'before=abc', 'from=yesterday', 'to=2026-13-40']) expect((await env.get(`/audit-log?${bad}`, c.E1001)).statusCode).toBe(400);
  });

  it('reports whether the hash chain is intact', async () => {
    for (const code of ['E1001', 'E1003']) expect((await env.get('/audit-log/integrity', c[code])).json()).toEqual({ intact: true, brokenAtId: null });
  });
});
