import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import { withTransaction } from '../db.js';
import type { AuthContext } from '../auth/service.js';
import { isPeriod } from '../fiscal.js';
import { scopeFor } from '../rbac/policy.js';
import { combineStints, resolveParams } from '../scoring/monthly.js';
import type { Guards } from './types.js';
import { asObject, bad, isoDate, str } from './util.js';

/**
 * Employee master. An employee is "in scope" when their current assignment sits under an org unit the caller
 * can reach for the permission (company scope also reaches employees with no assignment yet). Out-of-scope and
 * non-existent employees both answer 404 so scope cannot be probed.
 */
export function employeeRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  async function inScope(auth: AuthContext, permission: string, employeeId: string): Promise<boolean> {
    const scope = scopeFor(auth.assignments, permission);
    if (scope.company) return (await pool.query('SELECT 1 FROM core.employee WHERE id = $1', [employeeId])).rowCount === 1;
    const { rowCount } = await pool.query(
      `SELECT 1 FROM core.employee_assignment a JOIN core.org_unit ou ON ou.id = a.org_unit_id
       WHERE a.employee_id = $1 AND a.valid @> current_date AND ou.path <@ ANY($2::ltree[])`,
      [employeeId, scope.paths],
    );
    return rowCount === 1;
  }

  async function categoryId(code: string): Promise<string | undefined> {
    return (await pool.query('SELECT id FROM core.employee_category WHERE code = $1', [code])).rows[0]?.id;
  }

  app.get('/employees', { preHandler: g.requirePermission('employees:read') }, async (req) => {
    const scope = scopeFor(req.auth!.assignments, 'employees:read');
    const { rows } = await pool.query(
      `SELECT e.id, e.employee_code AS "employeeCode", e.full_name AS "fullName", e.mobile, e.email, e.status,
              ou.code AS "unitCode", ou.name AS "unitName", c.code AS category, a.designation, a.grade
       FROM core.employee e
       LEFT JOIN core.employee_assignment a ON a.employee_id = e.id AND a.valid @> current_date
       LEFT JOIN core.org_unit ou ON ou.id = a.org_unit_id
       LEFT JOIN core.employee_category c ON c.id = a.category_id
       WHERE $1::boolean OR ou.path <@ ANY($2::ltree[])
       ORDER BY e.employee_code`,
      [scope.company, scope.paths],
    );
    return { employees: rows };
  });

  app.get('/employees/:id/assignments', { preHandler: g.requirePermission('employees:read') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await inScope(req.auth!, 'employees:read', id))) return reply.code(404).send({ error: 'NOT_FOUND' });
    const { rows } = await pool.query(
      `SELECT a.id, ou.code AS "unitCode", c.code AS category, a.designation, a.grade,
              lower(a.valid)::text AS "validFrom", upper(a.valid)::text AS "validTo"
       FROM core.employee_assignment a
       JOIN core.org_unit ou ON ou.id = a.org_unit_id
       JOIN core.employee_category c ON c.id = a.category_id
       WHERE a.employee_id = $1 ORDER BY lower(a.valid)`,
      [id],
    );
    return { assignments: rows };
  });

  app.post('/employees', { preHandler: g.requirePermission('employees:write') }, async (req, reply) => {
    const auth = req.auth!;
    const b = asObject(req.body);
    const employeeCode = str(b.employeeCode, 30);
    const fullName = str(b.fullName);
    const orgUnitId = str(b.orgUnitId, 40);
    const categoryCode = str(b.categoryCode, 40);
    const dateOfJoining = b.dateOfJoining === undefined ? null : isoDate(b.dateOfJoining);
    const validFrom = b.validFrom === undefined ? null : isoDate(b.validFrom);
    if (!employeeCode || !fullName || !orgUnitId || !categoryCode || (b.dateOfJoining !== undefined && !dateOfJoining) || (b.validFrom !== undefined && !validFrom)) {
      return reply.code(400).send(bad('employeeCode, fullName, orgUnitId, categoryCode and valid dates are required'));
    }
    if (!(await g.canAtUnit(auth, 'employees:write', orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    const catId = await categoryId(categoryCode);
    if (!catId) return reply.code(400).send(bad('unknown categoryCode'));

    const id = await withTransaction(pool, async (tx) => {
      const emp = await tx.query(
        'INSERT INTO core.employee (employee_code, full_name, mobile, email, date_of_joining) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [employeeCode, fullName, str(b.mobile, 20) ?? null, str(b.email) ?? null, dateOfJoining],
      );
      await tx.query(
        `INSERT INTO core.employee_assignment (employee_id, org_unit_id, category_id, designation, grade, valid)
         VALUES ($1,$2,$3,$4,$5, daterange(COALESCE($6::date, current_date), NULL, '[)'))`,
        [emp.rows[0].id, orgUnitId, catId, str(b.designation) ?? null, str(b.grade, 30) ?? null, validFrom],
      );
      await audit(tx, {
        actorId: auth.userId,
        action: 'EMPLOYEE_CREATED',
        entityType: 'employee',
        entityId: emp.rows[0].id,
        after: { employeeCode, fullName, orgUnitId, categoryCode },
        ip: req.ip,
      });
      return emp.rows[0].id as string;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/employees/:id', { preHandler: g.requirePermission('employees:write') }, async (req, reply) => {
    const auth = req.auth!;
    const id = (req.params as { id: string }).id;
    const b = asObject(req.body);
    if (!(await inScope(auth, 'employees:write', id))) return reply.code(404).send({ error: 'NOT_FOUND' });

    const before = (
      await pool.query(
        `SELECT full_name AS "fullName", mobile, email, status, date_of_leaving::text AS "dateOfLeaving"
         FROM core.employee WHERE id = $1`,
        [id],
      )
    ).rows[0];

    const fullName = 'fullName' in b ? str(b.fullName) : before.fullName;
    const mobile = 'mobile' in b ? (b.mobile === null ? null : str(b.mobile, 20)) : before.mobile;
    const email = 'email' in b ? (b.email === null ? null : str(b.email)) : before.email;
    const status = 'status' in b ? str(b.status, 10) : before.status;
    const dateOfLeaving = 'dateOfLeaving' in b ? (b.dateOfLeaving === null ? null : isoDate(b.dateOfLeaving)) : before.dateOfLeaving;
    if (!fullName || (mobile === null && b.mobile !== null && 'mobile' in b) || (email === null && b.email !== null && 'email' in b) ||
        !status || !['ACTIVE', 'INACTIVE'].includes(status) || (dateOfLeaving === null && b.dateOfLeaving !== null && 'dateOfLeaving' in b)) {
      return reply.code(400).send(bad('invalid employee fields'));
    }

    await pool.query(
      'UPDATE core.employee SET full_name = $2, mobile = $3, email = $4, status = $5, date_of_leaving = $6 WHERE id = $1',
      [id, fullName, mobile, email, status, dateOfLeaving],
    );
    await audit(pool, {
      actorId: auth.userId,
      action: 'EMPLOYEE_UPDATED',
      entityType: 'employee',
      entityId: id,
      before,
      after: { fullName, mobile, email, status, dateOfLeaving },
      ip: req.ip,
    });
    return { id };
  });

  /** Transfer / re-categorise: closes the open assignment on `validFrom` and opens a new one. */
  app.post('/employees/:id/assignments', { preHandler: g.requirePermission('employees:write') }, async (req, reply) => {
    const auth = req.auth!;
    const id = (req.params as { id: string }).id;
    const b = asObject(req.body);
    const orgUnitId = str(b.orgUnitId, 40);
    const categoryCode = str(b.categoryCode, 40);
    const validFrom = isoDate(b.validFrom);
    if (!orgUnitId || !categoryCode || !validFrom) return reply.code(400).send(bad('orgUnitId, categoryCode and validFrom (YYYY-MM-DD) are required'));
    if (!(await inScope(auth, 'employees:write', id))) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!(await g.canAtUnit(auth, 'employees:write', orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    const catId = await categoryId(categoryCode);
    if (!catId) return reply.code(400).send(bad('unknown categoryCode'));

    const result = await withTransaction(pool, async (tx) => {
      const open = (
        await tx.query('SELECT id, lower(valid)::text AS since FROM core.employee_assignment WHERE employee_id = $1 AND upper_inf(valid) FOR UPDATE', [id])
      ).rows[0];
      if (open) {
        if (open.since >= validFrom) return 'BAD_DATE' as const;
        await tx.query("UPDATE core.employee_assignment SET valid = daterange(lower(valid), $2::date, '[)') WHERE id = $1", [open.id, validFrom]);
      }
      const { rows } = await tx.query(
        `INSERT INTO core.employee_assignment (employee_id, org_unit_id, category_id, designation, grade, valid)
         VALUES ($1,$2,$3,$4,$5, daterange($6::date, NULL, '[)')) RETURNING id`,
        [id, orgUnitId, catId, str(b.designation) ?? null, str(b.grade, 30) ?? null, validFrom],
      );
      await audit(tx, {
        actorId: auth.userId,
        action: 'EMPLOYEE_REASSIGNED',
        entityType: 'employee',
        entityId: id,
        before: open ? { assignmentId: open.id } : undefined,
        after: { orgUnitId, categoryCode, validFrom },
        ip: req.ip,
      });
      return rows[0].id as string;
    });
    if (result === 'BAD_DATE') return reply.code(400).send(bad('validFrom must be after the start of the current assignment'));
    return reply.code(201).send({ id: result });
  });

  /** Month score across every unit the employee worked in (days-weighted); partial until all those units are locked. */
  app.get('/employees/:id/scores', { preHandler: g.requirePermission('scores:read') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const period = asObject(req.query).period;
    if (!isPeriod(period)) return reply.code(400).send(bad('period (YYYY-MM) is required'));
    if (!(await inScope(req.auth!, 'scores:read', id))) return reply.code(404).send({ error: 'NOT_FOUND' });

    const { rows } = await pool.query(
      `SELECT ou.code AS "unitCode", pl.code AS "levelCode", la.days_in_unit AS days, es.score::float8 AS score, pt.defaults
       FROM core.level_assignment la
       JOIN core.org_unit ou ON ou.id = la.org_unit_id
       JOIN core.people_level pl ON pl.id = la.people_level_id
       JOIN core.plant_type pt ON pt.id = pl.plant_type_id
       LEFT JOIN core.calc_run cr ON cr.submission_id = la.submission_id AND cr.superseded_at IS NULL
       LEFT JOIN core.employee_score es ON es.calc_run_id = cr.id AND es.employee_id = la.employee_id
       WHERE la.employee_id = $1 AND la.period = $2 ORDER BY ou.code`,
      [id, period],
    );
    const score = combineStints(rows.map((r) => ({ score: r.score, days: r.days })), resolveParams(rows[0]?.defaults));
    return {
      period,
      score,
      partial: rows.some((r) => r.score === null),
      stints: rows.map((r) => ({ unitCode: r.unitCode, levelCode: r.levelCode, days: r.days, score: r.score })),
    };
  });
}
