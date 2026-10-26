import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import type { AuthContext } from '../auth/service.js';
import { scopeFor } from '../rbac/policy.js';
import type { Guards } from './types.js';
import { asObject, bad, str } from './util.js';

/**
 * Senior-staff appraisals. The reviewer is an assignment on the appraisal, not a role: any user who holds HOD / Manager,
 * Plant Head or Management can be assigned (enforced by the database trigger appraisal_reviewer_check).
 * An appraisal is in scope when its employee sits under a unit the caller reaches for the permission, or when the caller
 * is its reviewer. Out-of-scope and non-existent appraisals both answer 404.
 */
export function appraisalRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  async function employeeInScope(auth: AuthContext, permission: string, employeeId: string): Promise<boolean> {
    const scope = scopeFor(auth.assignments, permission);
    if (scope.company) return true;
    const { rowCount } = await pool.query(
      `SELECT 1 FROM core.employee_assignment a JOIN core.org_unit ou ON ou.id = a.org_unit_id
       WHERE a.employee_id = $1 AND a.valid @> current_date AND ou.path <@ ANY($2::ltree[])`,
      [employeeId, scope.paths],
    );
    return rowCount === 1;
  }

  /** The user account behind a login id (the employee code), or undefined. */
  async function reviewerId(loginId: string): Promise<string | undefined> {
    return (await pool.query('SELECT id FROM core.user_account WHERE login_id = $1', [loginId])).rows[0]?.id;
  }

  const fiscalYear = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 2000 && v <= 2100 ? v : null);

  app.get('/appraisals', { preHandler: g.requirePermission('appraisals:read') }, async (req, reply) => {
    const auth = req.auth!;
    const q = req.query as { fiscalYear?: string };
    const fy = q.fiscalYear === undefined ? null : fiscalYear(Number(q.fiscalYear));
    if (q.fiscalYear !== undefined && fy === null) return reply.code(400).send(bad('fiscalYear must be a year'));
    const scope = scopeFor(auth.assignments, 'appraisals:read');
    const { rows } = await pool.query(
      `SELECT a.id, a.fiscal_year AS "fiscalYear", e.employee_code AS "employeeCode", e.full_name AS "employeeName",
              ou.code AS "unitCode", ru.login_id AS "reviewerLoginId", re.full_name AS "reviewerName"
       FROM core.appraisal a
       JOIN core.employee e ON e.id = a.employee_id
       LEFT JOIN core.employee_assignment ea ON ea.employee_id = e.id AND ea.valid @> current_date
       LEFT JOIN core.org_unit ou ON ou.id = ea.org_unit_id
       LEFT JOIN core.user_account ru ON ru.id = a.reviewer_user_id
       LEFT JOIN core.employee re ON re.id = ru.employee_id
       WHERE ($1::int IS NULL OR a.fiscal_year = $1)
         AND (a.reviewer_user_id = $2 OR $3::boolean OR ou.path <@ ANY($4::ltree[]))
       ORDER BY a.fiscal_year DESC, e.employee_code`,
      [fy, auth.userId, scope.company, scope.paths],
    );
    return { appraisals: rows };
  });

  app.post('/appraisals', { preHandler: g.requirePermission('appraisals:assign') }, async (req, reply) => {
    const auth = req.auth!;
    const b = asObject(req.body);
    const employeeCode = str(b.employeeCode, 30);
    const fy = fiscalYear(b.fiscalYear);
    const reviewerLogin = b.reviewerLoginId === undefined ? null : str(b.reviewerLoginId, 30);
    if (!employeeCode || fy === null || (b.reviewerLoginId !== undefined && !reviewerLogin)) {
      return reply.code(400).send(bad('employeeCode and fiscalYear (a year) are required; reviewerLoginId must be a login id'));
    }
    const emp = (await pool.query('SELECT id FROM core.employee WHERE employee_code = $1', [employeeCode])).rows[0];
    if (!emp || !(await employeeInScope(auth, 'appraisals:assign', emp.id))) return reply.code(404).send({ error: 'NOT_FOUND' });
    const reviewer = reviewerLogin ? await reviewerId(reviewerLogin) : null;
    if (reviewerLogin && !reviewer) return reply.code(400).send(bad('unknown reviewerLoginId'));

    const { rows } = await pool.query(
      `INSERT INTO core.appraisal (employee_id, fiscal_year, reviewer_user_id, assigned_by, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [emp.id, fy, reviewer, reviewer ? auth.userId : null, auth.userId],
    );
    await audit(pool, {
      actorId: auth.userId,
      action: 'APPRAISAL_CREATED',
      entityType: 'appraisal',
      entityId: rows[0].id,
      after: { employeeCode, fiscalYear: fy, reviewer: reviewerLogin },
      ip: req.ip,
    });
    return reply.code(201).send({ id: rows[0].id });
  });

  app.put('/appraisals/:id/reviewer', { preHandler: g.requirePermission('appraisals:assign') }, async (req, reply) => {
    const auth = req.auth!;
    const id = (req.params as { id: string }).id;
    const reviewerLogin = str(asObject(req.body).reviewerLoginId, 30);
    if (!reviewerLogin) return reply.code(400).send(bad('reviewerLoginId is required'));
    const cur = (
      await pool.query(
        `SELECT a.id, a.employee_id AS "employeeId", a.fiscal_year AS "fiscalYear", ru.login_id AS "reviewerLoginId"
         FROM core.appraisal a LEFT JOIN core.user_account ru ON ru.id = a.reviewer_user_id
         WHERE a.id = $1`,
        [id],
      )
    ).rows[0];
    if (!cur || !(await employeeInScope(auth, 'appraisals:assign', cur.employeeId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    const reviewer = await reviewerId(reviewerLogin);
    if (!reviewer) return reply.code(400).send(bad('unknown reviewerLoginId'));

    await pool.query('UPDATE core.appraisal SET reviewer_user_id = $2, assigned_by = $3 WHERE id = $1', [cur.id, reviewer, auth.userId]);
    await audit(pool, {
      actorId: auth.userId,
      action: 'APPRAISAL_REVIEWER_ASSIGNED',
      entityType: 'appraisal',
      entityId: cur.id,
      before: { reviewer: cur.reviewerLoginId },
      after: { reviewer: reviewerLogin, fiscalYear: cur.fiscalYear },
      ip: req.ip,
    });
    return { id: cur.id, reviewerLoginId: reviewerLogin };
  });
}
