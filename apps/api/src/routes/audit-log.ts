import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { verifyAuditChain } from '../audit.js';
import { hasAnyScope, scopeFor } from '../rbac/policy.js';
import type { Guards } from './types.js';
import { bad, isoDate } from './util.js';

/**
 * Read-only audit log (doc 04 §3 row 27). Two categories, each behind its own permission:
 *   system   (audit:read_system, Admin):            sign-ins, accounts, roles, access denials, system configuration;
 *   business (audit:read_business, Corporate HR):   everything else (templates, scorecards, monthly cycle, employees, appraisals ...).
 * Nobody can write through this API; the table itself is append-only and hash-chained.
 */
export const SYSTEM_ACTIONS = [
  'LOGIN_OK', 'LOGIN_FAIL', 'LOGIN_BLOCKED', 'LOGOUT', 'ACCOUNT_LOCKED', 'USER_CREATED',
  'ROLE_GRANTED', 'ROLE_GRANT_REJECTED', 'ACCESS_DENIED', 'PLANT_TYPE_CREATED', 'PEOPLE_LEVEL_CREATED',
];

const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;

export function auditLogRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  const anyAuditRead: ReturnType<Guards['requirePermission']> = async (req, reply) => {
    const denied = await g.requireAuth(req, reply);
    if (denied) return denied;
    const a = req.auth!.assignments;
    if (!hasAnyScope(scopeFor(a, 'audit:read_system')) && !hasAnyScope(scopeFor(a, 'audit:read_business'))) {
      return g.requirePermission('audit:read_system')(req, reply); // answers 403 and records the denial
    }
  };

  const allowed = (req: { auth?: { assignments: Parameters<typeof scopeFor>[0] } }) => ({
    system: hasAnyScope(scopeFor(req.auth!.assignments, 'audit:read_system')),
    business: hasAnyScope(scopeFor(req.auth!.assignments, 'audit:read_business')),
  });

  app.get('/audit-log', { preHandler: anyAuditRead }, async (req, reply) => {
    const can = allowed(req);
    const q = req.query as Record<string, string | undefined>;

    const category = q.category;
    if (category !== undefined && category !== 'system' && category !== 'business') return reply.code(400).send(bad('category must be system or business'));
    if (category && !can[category]) return reply.code(403).send({ error: 'FORBIDDEN' });

    const limit = q.limit === undefined ? PAGE_DEFAULT : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) return reply.code(400).send(bad(`limit must be 1 to ${PAGE_MAX}`));
    const before = q.before === undefined ? null : Number(q.before);
    if (before !== null && (!Number.isInteger(before) || before < 1)) return reply.code(400).send(bad('before must be an event id'));
    const from = q.from === undefined ? null : isoDate(q.from);
    const to = q.to === undefined ? null : isoDate(q.to);
    if ((q.from !== undefined && !from) || (q.to !== undefined && !to)) return reply.code(400).send(bad('from and to must be YYYY-MM-DD dates'));
    const action = q.action === undefined ? null : q.action.slice(0, 60);
    const actor = q.actor === undefined ? null : q.actor.slice(0, 60);

    // The categories this caller may see, narrowed by the optional filter. A row's category is derived, never stored.
    const wantSystem = can.system && category !== 'business';
    const wantBusiness = can.business && category !== 'system';
    const { rows } = await pool.query(
      `SELECT l.id::float8 AS id, l.at, l.action,
              CASE WHEN l.action = ANY($1::text[]) THEN 'system' ELSE 'business' END AS category,
              u.login_id AS "actorLoginId", e.full_name AS "actorName",
              l.entity_type AS "entityType", l.entity_id AS "entityId", l.before, l.after, host(l.ip) AS ip
       FROM core.audit_log l
       LEFT JOIN core.user_account u ON u.id = l.actor_id
       LEFT JOIN core.employee e ON e.id = u.employee_id
       WHERE (($2::boolean AND l.action = ANY($1::text[])) OR ($3::boolean AND NOT l.action = ANY($1::text[])))
         AND ($4::bigint IS NULL OR l.id < $4)
         AND ($5::text IS NULL OR l.action = $5)
         AND ($6::text IS NULL OR u.login_id = $6)
         AND ($7::date IS NULL OR l.at >= $7::date)
         AND ($8::date IS NULL OR l.at < $8::date + 1)
       ORDER BY l.id DESC
       LIMIT $9`,
      [SYSTEM_ACTIONS, wantSystem, wantBusiness, before, action, actor, from, to, limit + 1],
    );
    const more = rows.length > limit;
    const events = more ? rows.slice(0, limit) : rows;
    return {
      categories: [...(can.system ? ['system'] : []), ...(can.business ? ['business'] : [])],
      events,
      nextBefore: more ? events[events.length - 1].id : null,
    };
  });

  /** Walks the whole hash chain. Reveals nothing but intact / the id of the first broken row. */
  app.get('/audit-log/integrity', { preHandler: anyAuditRead }, async () => {
    const broken = await verifyAuditChain(pool);
    return { intact: broken === null, brokenAtId: broken };
  });
}
