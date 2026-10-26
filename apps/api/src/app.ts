import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { audit } from './audit.js';
import { authenticate, login, logout, type AuthContext } from './auth/service.js';
import { config } from './config.js';
import { dbErrorResponse } from './http.js';
import { hasAnyScope, scopeCovers, scopeFor } from './rbac/policy.js';
import { appraisalRoutes } from './routes/appraisals.js';
import { auditLogRoutes } from './routes/audit-log.js';
import { configRoutes } from './routes/config.js';
import { myScoresRoutes } from './routes/my-scores.js';
import { employeeRoutes } from './routes/employees.js';
import { kpiRoutes } from './routes/kpi.js';
import { orgRoutes } from './routes/org.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { scorecardChangeRoutes } from './routes/scorecard-changes.js';
import { scorecardRoutes } from './routes/scorecards.js';
import { seniorRoutes } from './routes/senior.js';
import { submissionRoutes } from './routes/submissions.js';
import { templateRoutes } from './routes/templates.js';
import type { Guards } from './routes/types.js';
import { SeniorError } from './senior/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const SCOPE_TYPES = ['COMPANY', 'PLANT', 'DEPARTMENT', 'CELL'];

export function buildApp(pool: pg.Pool): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cookie);

  // Constraint and guard-trigger violations become 4xx; anything unexpected is a generic 500 (no internals leaked).
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof SeniorError) return reply.code(err.status).send({ error: err.code, message: err.message });
    const mapped = dbErrorResponse(err);
    if (mapped) return reply.code(mapped.status).send(mapped.body);
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'BAD_REQUEST' });
    console.error(err);
    return reply.code(500).send({ error: 'INTERNAL' });
  });

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[config.session.cookieName];
    const ctx = token ? await authenticate(pool, token) : null;
    if (!ctx) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    req.auth = ctx;
  };

  /** Layered guard: authenticated, then holds `permission` in at least one scope. */
  const requirePermission = (permission: string) => async (req: FastifyRequest, reply: FastifyReply) => {
    const denied = await requireAuth(req, reply);
    if (denied) return denied;
    if (!hasAnyScope(scopeFor(req.auth!.assignments, permission))) {
      await audit(pool, {
        actorId: req.auth!.userId,
        action: 'ACCESS_DENIED',
        entityType: 'permission',
        entityId: permission,
        ip: req.ip,
      });
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }
  };

  /** Own-records guard: the permission must come from a SELF-scoped assignment (the Employee role). */
  const requireSelf = (permission: string) => async (req: FastifyRequest, reply: FastifyReply) => {
    const denied = await requireAuth(req, reply);
    if (denied) return denied;
    if (!req.auth!.assignments.some((a) => a.scopeType === 'SELF' && a.permissions.includes(permission))) {
      await audit(pool, { actorId: req.auth!.userId, action: 'ACCESS_DENIED', entityType: 'permission', entityId: permission, ip: req.ip });
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }
  };

  app.post('/auth/login', async (req, reply) => {
    const body = req.body as { loginId?: unknown; password?: unknown } | null;
    if (typeof body?.loginId !== 'string' || typeof body?.password !== 'string') {
      return reply.code(400).send({ error: 'BAD_REQUEST' });
    }
    const result = await login(pool, body.loginId, body.password, {
      ip: req.ip,
      deviceLabel: req.headers['user-agent']?.slice(0, 120),
    });
    if (!result.ok) {
      if (result.reason === 'LOCKED') return reply.code(423).send({ error: 'ACCOUNT_LOCKED' });
      if (result.reason === 'MFA_UNAVAILABLE') return reply.code(403).send({ error: 'MFA_UNAVAILABLE' });
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }
    reply.setCookie(config.session.cookieName, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/',
      expires: result.expiresAt,
    });
    return { user: result.user };
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    await logout(pool, req.auth!, req.ip);
    reply.clearCookie(config.session.cookieName, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const a = req.auth!;
    return {
      user: { userId: a.userId, loginId: a.loginId, fullName: a.fullName },
      roles: a.assignments.map((r) => ({ code: r.roleCode, scopeType: r.scopeType, scopePath: r.scopePath })),
      // Only permissions the caller can exercise: an assignment with no company, org-unit or SELF scope grants nothing the
      // server's scope checks would accept, so it must not light up screens that can only answer 403. SELF is real for
      // the Employee role, whose only permission is myscores:read, served by requireSelf.
      permissions: [...new Set(a.assignments.filter((r) => r.scopeType === 'COMPANY' || r.scopeType === 'SELF' || r.scopePath).flatMap((r) => r.permissions))].sort(),
    };
  });

  // Scope is applied as a SQL predicate (never filtered in memory), per doc 04 §4.
  app.get('/org/units', { preHandler: requirePermission('org:read') }, async (req) => {
    const scope = scopeFor(req.auth!.assignments, 'org:read');
    const { rows } = await pool.query(
      `SELECT id, code, name, unit_type AS "unitType", path::text AS path
       FROM core.org_unit
       WHERE active AND ($1::boolean OR path <@ ANY($2::ltree[]))
       ORDER BY path`,
      [scope.company, scope.paths],
    );
    return { units: rows };
  });

  app.get('/admin/users', { preHandler: requirePermission('users:manage') }, async () => {
    // Identity fields only: Super Admin never sees scores or pay (doc 04 §3 note).
    const { rows } = await pool.query(
      `SELECT u.id, u.login_id AS "loginId", e.employee_code AS "employeeCode", e.full_name AS "fullName",
              e.mobile, u.status, u.auth_mode AS "authMode"
       FROM core.user_account u JOIN core.employee e ON e.id = u.employee_id
       ORDER BY u.login_id`,
    );
    return { users: rows };
  });

  app.post('/admin/role-assignments', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const b = req.body as { userId?: string; roleCode?: string; scopeType?: string; scopeId?: string } | null;
    if (!b?.userId || !b.roleCode || !b.scopeType || !SCOPE_TYPES.includes(b.scopeType)) {
      return reply.code(400).send({ error: 'BAD_REQUEST' });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO core.role_assignment (user_id, role_id, scope_type, scope_id, granted_by)
         SELECT $1, r.id, $3, $4, $5 FROM core.role r WHERE r.code = $2
         RETURNING id`,
        [b.userId, b.roleCode, b.scopeType, b.scopeId ?? null, req.auth!.userId],
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'UNKNOWN_ROLE' });
      await audit(pool, {
        actorId: req.auth!.userId,
        action: 'ROLE_GRANTED',
        entityType: 'role_assignment',
        entityId: rows[0].id,
        after: b,
        ip: req.ip,
      });
      return reply.code(201).send({ id: rows[0].id });
    } catch (err) {
      const message = (err as Error).message;
      if (/^(SOD|MFA):/.test(message)) {
        await audit(pool, { actorId: req.auth!.userId, action: 'ROLE_GRANT_REJECTED', after: { ...b, message }, ip: req.ip });
        return reply.code(409).send({ error: message });
      }
      throw err;
    }
  });

  const guards: Guards = {
    requireAuth,
    requirePermission,
    requireSelf,
    canAtUnit: async (auth, permission, orgUnitId) => {
      const scope = scopeFor(auth.assignments, permission);
      if (scope.company) return true;
      if (!hasAnyScope(scope)) return false;
      const { rows } = await pool.query('SELECT path::text AS path FROM core.org_unit WHERE id = $1', [orgUnitId]);
      return rows[0] ? scopeCovers(scope, rows[0].path) : false;
    },
  };
  configRoutes(app, pool, guards);
  orgRoutes(app, pool, guards);
  employeeRoutes(app, pool, guards);
  kpiRoutes(app, pool, guards);
  templateRoutes(app, pool, guards);
  scorecardRoutes(app, pool, guards);
  scorecardChangeRoutes(app, pool, guards);
  dashboardRoutes(app, pool, guards);
  submissionRoutes(app, pool, guards);
  seniorRoutes(app, pool, guards);
  appraisalRoutes(app, pool, guards);
  myScoresRoutes(app, pool, guards);
  auditLogRoutes(app, pool, guards);

  return app;
}
