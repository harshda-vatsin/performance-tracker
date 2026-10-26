import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Guards } from './types.js';

/**
 * What an Employee sees: their own results only, never anyone else's. There is no individual scorecard model yet, so the
 * only source is a unit-level assignment: each month in which the employee was placed at a people level in a unit, with
 * that level's score, once the month is locked and its official run is current. Nothing locked means an empty list.
 */
export function myScoresRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  app.get('/me/scores', { preHandler: g.requireSelf('myscores:read') }, async (req) => {
    const { rows } = await pool.query(
      `SELECT ms.period, ou.code AS "unitCode", ou.name AS "unitName", pl.code AS "levelCode", pl.name_en AS "levelName",
              es.days_in_unit AS "daysInUnit", es.score
       FROM core.user_account u
       JOIN core.employee_score es ON es.employee_id = u.employee_id
       JOIN core.calc_run cr ON cr.id = es.calc_run_id AND cr.superseded_at IS NULL
       JOIN core.monthly_submission ms ON ms.id = cr.submission_id AND ms.state = 'LOCKED'
       JOIN core.org_unit ou ON ou.id = ms.org_unit_id
       JOIN core.people_level pl ON pl.id = es.people_level_id
       WHERE u.id = $1
       ORDER BY ms.period DESC, ou.code`,
      [req.auth!.userId],
    );
    return { unitMonths: rows };
  });
}
