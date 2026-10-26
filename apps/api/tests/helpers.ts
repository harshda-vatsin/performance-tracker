import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { createUserAccount } from '../src/auth/service.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const PASSWORD = 'correct-horse-battery';

const adminUrl = process.env.TEST_ADMIN_URL ?? config.databaseUrl.replace(/\/[^/]+$/, '/postgres');
const testUrl = config.databaseUrl.replace(/\/[^/]+$/, '/mmf_test');

export interface TestEnv {
  pool: pg.Pool;
  app: FastifyInstance;
  /** Ids by name: users by employee code, plus org units (company, p1, p2, d1, d2) and plant type (forge). */
  ids: Record<string, string>;
  user(code: string, role?: string, scopeType?: string, scopeId?: string | null): Promise<string>;
  assign(userId: string, role: string, scopeType: string, scopeId?: string | null): Promise<void>;
  loginAs(code: string, password?: string): Promise<{ cookie: string | undefined; status: number }>;
  get(url: string, cookie?: string): Promise<LightMyRequestResponse>;
  post(url: string, payload: unknown, cookie?: string): Promise<LightMyRequestResponse>;
  put(url: string, payload: unknown, cookie?: string): Promise<LightMyRequestResponse>;
  patch(url: string, payload: unknown, cookie?: string): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

/** Fresh mmf_test database with the schema migrated and a small org: company, two Forge plants, a department each. */
export async function setupEnv(): Promise<TestEnv> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS mmf_test WITH (FORCE)');
  await admin.query('CREATE DATABASE mmf_test');
  await admin.end();

  const pool = createPool(testUrl);
  await migrate(pool);
  const app = buildApp(pool);
  const ids: Record<string, string> = {};

  const ft = await pool.query("INSERT INTO core.plant_type (code, name) VALUES ('FORGE','Forge') RETURNING id");
  ids.forge = ft.rows[0].id;
  const unit = async (parent: string | null, type: string, code: string, plantType: string | null = null) =>
    (
      await pool.query('INSERT INTO core.org_unit (parent_id, unit_type, plant_type_id, code, name) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
        parent,
        type,
        plantType,
        code,
        code,
      ])
    ).rows[0].id as string;
  ids.company = await unit(null, 'COMPANY', 'MMF');
  ids.p1 = await unit(ids.company, 'PLANT', 'P1', ids.forge);
  ids.p2 = await unit(ids.company, 'PLANT', 'P2', ids.forge);
  ids.d1 = await unit(ids.p1, 'DEPARTMENT', 'P1-FORGE');
  ids.d2 = await unit(ids.p2, 'DEPARTMENT', 'P2-FORGE');

  const assign: TestEnv['assign'] = async (userId, role, scopeType, scopeId = null) => {
    await pool.query(
      `INSERT INTO core.role_assignment (user_id, role_id, scope_type, scope_id)
       SELECT $1, id, $3, $4 FROM core.role WHERE code = $2`,
      [userId, role, scopeType, scopeId],
    );
  };
  const user: TestEnv['user'] = async (code, role, scopeType = 'COMPANY', scopeId = null) => {
    const { userId } = await createUserAccount(pool, { employeeCode: code, fullName: `Test ${code}`, password: PASSWORD });
    ids[code] = userId;
    if (role) await assign(userId, role, scopeType, scopeId);
    return userId;
  };

  const headers = (cookie?: string) => (cookie ? { cookie } : {});
  return {
    pool,
    app,
    ids,
    user,
    assign,
    async loginAs(code, password = PASSWORD) {
      const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { loginId: code, password } });
      return { cookie: res.cookies[0] ? `${res.cookies[0].name}=${res.cookies[0].value}` : undefined, status: res.statusCode };
    },
    get: (url, cookie) => app.inject({ method: 'GET', url, headers: headers(cookie) }),
    post: (url, payload, cookie) => app.inject({ method: 'POST', url, payload: payload as object, headers: headers(cookie) }),
    put: (url, payload, cookie) => app.inject({ method: 'PUT', url, payload: payload as object, headers: headers(cookie) }),
    patch: (url, payload, cookie) => app.inject({ method: 'PATCH', url, payload: payload as object, headers: headers(cookie) }),
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
