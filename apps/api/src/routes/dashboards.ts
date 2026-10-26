import { roundHalfUp } from '@mmf/scoring';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { isPeriod } from '../fiscal.js';
import { scopeFor } from '../rbac/policy.js';
import { resolveParams } from '../scoring/monthly.js';
import { fiscalMonths, rollupFiscalYear } from '../scoring/rollup.js';
import type { Guards } from './types.js';
import { asObject, bad } from './util.js';

/**
 * Read-only views over OFFICIAL (locked, non-superseded) results only, so unfinished months never leak into
 * dashboards and a reopened month disappears from them until it is locked again.
 */
export function dashboardRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  /** Trend for one scored unit: per people level, locked months plus quarter and year roll-ups. */
  app.get('/dashboards/units/:id', { preHandler: g.requirePermission('scores:read') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const fy = Number(asObject(req.query).fiscalYear);
    if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) return reply.code(400).send(bad('fiscalYear (start year, e.g. 2026) is required'));

    const unit = (
      await pool.query(
        `SELECT u.id, u.code, pt.defaults
         FROM core.org_unit u
         JOIN core.org_unit p ON p.unit_type = 'PLANT' AND u.path <@ p.path
         JOIN core.plant_type pt ON pt.id = p.plant_type_id
         WHERE u.id = $1 AND u.unit_type = pt.scoring_unit_type`,
        [id],
      )
    ).rows[0];
    if (!unit || !(await g.canAtUnit(req.auth!, 'scores:read', id))) return reply.code(404).send({ error: 'NOT_FOUND' });

    const months = fiscalMonths(fy);
    const { rows } = await pool.query(
      `SELECT s.period, pl.code AS "levelCode", pl.rank, ls.score::float8 AS score
       FROM core.monthly_submission s
       JOIN core.calc_run cr ON cr.submission_id = s.id AND cr.superseded_at IS NULL
       JOIN core.level_score ls ON ls.calc_run_id = cr.id
       JOIN core.people_level pl ON pl.id = ls.people_level_id
       WHERE s.org_unit_id = $1 AND s.period BETWEEN $2 AND $3
       ORDER BY pl.rank, s.period`,
      [id, months[0], months[11]],
    );

    const byLevel = new Map<string, { rank: number; monthly: Map<string, number | null> }>();
    for (const r of rows) {
      if (!byLevel.has(r.levelCode)) byLevel.set(r.levelCode, { rank: r.rank, monthly: new Map() });
      byLevel.get(r.levelCode)!.monthly.set(r.period, r.score);
    }
    const params = resolveParams(unit.defaults);
    const levels = [...byLevel.entries()]
      .sort((a, b) => a[1].rank - b[1].rank)
      .map(([levelCode, v]) => ({ levelCode, ...rollupFiscalYear(fy, v.monthly, params) }));
    return { orgUnitId: id, unitCode: unit.code, fiscalYear: fy, levels };
  });

  /** Month status board for one plant: every scored unit, its workflow state and, once locked, its level scores. */
  app.get('/plants/:id/months/:period', { preHandler: g.requirePermission('submissions:read') }, async (req, reply) => {
    const { id, period } = req.params as { id: string; period: string };
    if (!isPeriod(period)) return reply.code(400).send(bad('period must be YYYY-MM'));
    const plant = (await pool.query("SELECT 1 FROM core.org_unit WHERE id = $1 AND unit_type = 'PLANT'", [id])).rows[0];
    if (!plant || !(await g.canAtUnit(req.auth!, 'submissions:read', id))) return reply.code(404).send({ error: 'NOT_FOUND' });

    const { rows } = await pool.query(
      `SELECT u.id AS "orgUnitId", u.code AS "unitCode", s.id AS "submissionId", s.state, s.revision,
              pl.code AS "levelCode", ls.score::float8 AS score
       FROM core.org_unit p
       JOIN core.plant_type pt ON pt.id = p.plant_type_id
       JOIN core.org_unit u ON u.unit_type = pt.scoring_unit_type AND u.active AND u.path <@ p.path
       LEFT JOIN core.monthly_submission s ON s.org_unit_id = u.id AND s.period = $2
       LEFT JOIN core.calc_run cr ON cr.submission_id = s.id AND cr.superseded_at IS NULL
       LEFT JOIN core.level_score ls ON ls.calc_run_id = cr.id
       LEFT JOIN core.people_level pl ON pl.id = ls.people_level_id
       WHERE p.id = $1
       ORDER BY u.code, pl.rank`,
      [id, period],
    );
    const units = new Map<string, { orgUnitId: string; unitCode: string; submissionId: string | null; state: string; revision: number | null; levels: { levelCode: string; score: number | null }[] }>();
    for (const r of rows) {
      if (!units.has(r.orgUnitId)) {
        units.set(r.orgUnitId, { orgUnitId: r.orgUnitId, unitCode: r.unitCode, submissionId: r.submissionId, state: r.state ?? 'NOT_STARTED', revision: r.revision, levels: [] });
      }
      if (r.levelCode) units.get(r.orgUnitId)!.levels.push({ levelCode: r.levelCode, score: r.score });
    }
    const list = [...units.values()];
    const summary: Record<string, number> = {};
    for (const u of list) summary[u.state] = (summary[u.state] ?? 0) + 1;
    return { plantId: id, period, units: list, summary };
  });

  /** Plant-vs-plant comparison within each plant type for one month: average level score across the plant's locked units. */
  app.get('/dashboards/management', { preHandler: g.requirePermission('scores:read') }, async (req, reply) => {
    const period = asObject(req.query).period;
    if (!isPeriod(period)) return reply.code(400).send(bad('period (YYYY-MM) is required'));
    const scope = scopeFor(req.auth!.assignments, 'scores:read');

    const { rows } = await pool.query(
      `SELECT p.id AS "plantId", p.code AS "plantCode", pt.code AS "plantTypeCode", pt.defaults,
              u.id AS "unitId", pl.code AS "levelCode", pl.rank, ls.score::float8 AS score
       FROM core.org_unit p
       JOIN core.plant_type pt ON pt.id = p.plant_type_id
       JOIN core.org_unit u ON u.unit_type = pt.scoring_unit_type AND u.active AND u.path <@ p.path
       LEFT JOIN core.monthly_submission s ON s.org_unit_id = u.id AND s.period = $1
       LEFT JOIN core.calc_run cr ON cr.submission_id = s.id AND cr.superseded_at IS NULL
       LEFT JOIN core.level_score ls ON ls.calc_run_id = cr.id
       LEFT JOIN core.people_level pl ON pl.id = ls.people_level_id
       WHERE p.unit_type = 'PLANT' AND p.active AND ($2::boolean OR p.path <@ ANY($3::ltree[]))
       ORDER BY pt.code, p.code, pl.rank`,
      [period, scope.company, scope.paths],
    );

    interface Plant {
      plantId: string;
      code: string;
      digits: number;
      units: Set<string>;
      locked: Set<string>;
      sums: Map<string, { rank: number; scores: number[] }>;
    }
    const types = new Map<string, Map<string, Plant>>();
    for (const r of rows) {
      if (!types.has(r.plantTypeCode)) types.set(r.plantTypeCode, new Map());
      const plants = types.get(r.plantTypeCode)!;
      if (!plants.has(r.plantId)) {
        plants.set(r.plantId, { plantId: r.plantId, code: r.plantCode, digits: resolveParams(r.defaults).rounding.level, units: new Set(), locked: new Set(), sums: new Map() });
      }
      const p = plants.get(r.plantId)!;
      p.units.add(r.unitId);
      if (r.levelCode) {
        p.locked.add(r.unitId);
        if (!p.sums.has(r.levelCode)) p.sums.set(r.levelCode, { rank: r.rank, scores: [] });
        if (r.score !== null) p.sums.get(r.levelCode)!.scores.push(r.score);
      }
    }

    return {
      period,
      plantTypes: [...types.entries()].map(([code, plants]) => ({
        code,
        plants: [...plants.values()].map((p) => ({
          plantId: p.plantId,
          code: p.code,
          unitsTotal: p.units.size,
          unitsLocked: p.locked.size,
          levels: [...p.sums.entries()]
            .sort((a, b) => a[1].rank - b[1].rank)
            .map(([levelCode, v]) => ({
              levelCode,
              score: v.scores.length ? roundHalfUp(v.scores.reduce((s, x) => s + x, 0) / v.scores.length, p.digits) : null,
            })),
        })),
      })),
    };
  });
}
