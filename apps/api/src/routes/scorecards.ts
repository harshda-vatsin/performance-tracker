import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import { withTransaction } from '../db.js';
import { scopeFor } from '../rbac/policy.js';
import type { Guards } from './types.js';
import { asObject, bad, finite, str } from './util.js';

/**
 * Per-unit scorecards. For now a scorecard is an immutable snapshot of the active template for the unit's plant
 * type; plant-level target adjustments with maker-checker approval arrive with the next slice.
 */
export function scorecardRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  app.post('/scorecards', { preHandler: g.requirePermission('scorecards:create') }, async (req, reply) => {
    const auth = req.auth!;
    const b = asObject(req.body);
    const orgUnitId = str(b.orgUnitId, 40);
    const fiscalYear = finite(b.fiscalYear);
    if (!orgUnitId || fiscalYear === null || !Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return reply.code(400).send(bad('orgUnitId and an integer fiscalYear (start year, e.g. 2026) are required'));
    }
    if (!(await g.canAtUnit(auth, 'scorecards:create', orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });

    const info = (
      await pool.query(
        `SELECT u.unit_type AS "unitType", pt.id AS "plantTypeId", pt.scoring_unit_type AS "scoringUnitType"
         FROM core.org_unit u
         JOIN core.org_unit p ON p.unit_type = 'PLANT' AND u.path <@ p.path
         JOIN core.plant_type pt ON pt.id = p.plant_type_id
         WHERE u.id = $1`,
        [orgUnitId],
      )
    ).rows[0] as { unitType: string; plantTypeId: string; scoringUnitType: string } | undefined;
    if (!info) return reply.code(400).send(bad('unit not found or not inside a plant'));
    if (info.unitType !== info.scoringUnitType) {
      return reply.code(400).send(bad(`only ${info.scoringUnitType} units are scored for this plant type`));
    }

    const templateId = str(b.templateId, 40);
    const templates = (
      await pool.query("SELECT id FROM core.kra_template WHERE plant_type_id = $1 AND status = 'ACTIVE' AND ($2::uuid IS NULL OR id = $2)", [
        info.plantTypeId,
        templateId ?? null,
      ])
    ).rows;
    if (templates.length === 0) return reply.code(409).send({ error: 'NO_ACTIVE_TEMPLATE' });
    if (templates.length > 1) return reply.code(400).send(bad('several active templates exist; pass templateId'));
    const sourceId = templates[0].id as string;

    const created = await withTransaction(pool, async (tx) => {
      const sc = await tx.query(
        'INSERT INTO core.scorecard (org_unit_id, fiscal_year, source_template_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
        [orgUnitId, fiscalYear, sourceId, auth.userId],
      );
      const ver = await tx.query(
        "INSERT INTO core.scorecard_version (scorecard_id, version, effective_from) VALUES ($1, 1, make_date($2::int, 4, 1)) RETURNING id",
        [sc.rows[0].id, fiscalYear],
      );
      const kras = await tx.query('SELECT id FROM core.template_kra WHERE template_id = $1 ORDER BY sort_order', [sourceId]);
      for (const [i, k] of kras.rows.entries()) {
        const copy = await tx.query(
          `INSERT INTO core.scorecard_kra
             (scorecard_version_id, name_en, name_ta, pqcdsm, direction, unit, present_level, q1_target, q2_target, q3_target, q4_target, sort_order)
           SELECT $2, name_en, name_ta, pqcdsm, direction, unit, present_level, q1_target, q2_target, q3_target, q4_target, $3
           FROM core.template_kra WHERE id = $1 RETURNING id`,
          [k.id, ver.rows[0].id, i],
        );
        await tx.query(
          `INSERT INTO core.scorecard_kra_weight (scorecard_kra_id, people_level_id, weight)
           SELECT $2, people_level_id, weight FROM core.template_kra_weight WHERE template_kra_id = $1`,
          [k.id, copy.rows[0].id],
        );
      }
      await audit(tx, {
        actorId: auth.userId,
        action: 'SCORECARD_CREATED',
        entityType: 'scorecard',
        entityId: sc.rows[0].id,
        after: { orgUnitId, fiscalYear, sourceTemplateId: sourceId },
        ip: req.ip,
      });
      return { id: sc.rows[0].id as string, versionId: ver.rows[0].id as string };
    });
    return reply.code(201).send(created);
  });

  app.get('/scorecards', { preHandler: g.requirePermission('scorecards:read') }, async (req) => {
    const scope = scopeFor(req.auth!.assignments, 'scorecards:read');
    const q = asObject(req.query);
    const fy = Number(q.fiscalYear);
    const { rows } = await pool.query(
      `SELECT s.id, s.org_unit_id AS "orgUnitId", u.code AS "unitCode", s.fiscal_year AS "fiscalYear", s.source_template_id AS "sourceTemplateId"
       FROM core.scorecard s JOIN core.org_unit u ON u.id = s.org_unit_id
       WHERE ($1::boolean OR u.path <@ ANY($2::ltree[]))
         AND ($3::uuid IS NULL OR s.org_unit_id = $3) AND ($4::int IS NULL OR s.fiscal_year = $4)
       ORDER BY s.fiscal_year DESC, u.code`,
      [scope.company, scope.paths, str(q.orgUnitId, 40) ?? null, Number.isInteger(fy) ? fy : null],
    );
    return { scorecards: rows };
  });

  app.get('/scorecards/:id', { preHandler: g.requirePermission('scorecards:read') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const sc = (
      await pool.query(
        `SELECT s.id, s.org_unit_id AS "orgUnitId", s.fiscal_year AS "fiscalYear", v.id AS "versionId", v.version
         FROM core.scorecard s JOIN core.scorecard_version v ON v.scorecard_id = s.id WHERE s.id = $1 ORDER BY v.version DESC LIMIT 1`,
        [id],
      )
    ).rows[0];
    if (!sc || !(await g.canAtUnit(req.auth!, 'scorecards:read', sc.orgUnitId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    const { rows } = await pool.query(
      `SELECT k.id, k.name_en AS "nameEn", k.pqcdsm, k.direction, k.unit, k.present_level::float8 AS "presentLevel",
              ARRAY[k.q1_target::float8, k.q2_target::float8, k.q3_target::float8, k.q4_target::float8] AS targets,
              COALESCE((SELECT jsonb_object_agg(pl.code, w.weight::float8) FROM core.scorecard_kra_weight w
                        JOIN core.people_level pl ON pl.id = w.people_level_id WHERE w.scorecard_kra_id = k.id), '{}'::jsonb) AS weights
       FROM core.scorecard_kra k WHERE k.scorecard_version_id = $1 ORDER BY k.sort_order`,
      [sc.versionId],
    );
    return { scorecard: sc, kras: rows };
  });
}
