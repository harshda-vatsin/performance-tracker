import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import { withTransaction } from '../db.js';
import { PQCDSM, validateTemplate, type Direction, type DraftKra } from '../templates/validate.js';
import type { Guards } from './types.js';
import { asObject, bad, finite, str } from './util.js';

const DIRECTIONS = ['HIGHER_BETTER', 'LOWER_BETTER'];

interface ParsedKra extends DraftKra {
  kpiId: string | null;
  nameTa: string | null;
  unit: string;
}

/** Shape/range checks for a saved draft. Business totals are NOT required here: drafts may be incomplete. */
function parseKras(raw: unknown, levelCodes: Set<string>): ParsedKra[] | string {
  if (!Array.isArray(raw)) return 'kras must be an array';
  const out: ParsedKra[] = [];
  for (const [i, item] of raw.entries()) {
    const k = asObject(item);
    const at = `kras[${i}]`;
    const nameEn = str(k.nameEn);
    const pqcdsm = str(k.pqcdsm, 1)?.toUpperCase();
    const direction = str(k.direction, 20);
    const unit = str(k.unit, 30);
    const presentLevel = finite(k.presentLevel);
    if (!nameEn) return `${at}: nameEn is required`;
    if (!pqcdsm || !(PQCDSM as readonly string[]).includes(pqcdsm)) return `${at}: pqcdsm must be one of P,Q,C,D,S,M`;
    if (!direction || !DIRECTIONS.includes(direction)) return `${at}: direction must be HIGHER_BETTER or LOWER_BETTER`;
    if (!unit) return `${at}: unit is required`;
    if (presentLevel === null) return `${at}: presentLevel must be a number`;
    const t = Array.isArray(k.targets) ? k.targets.map(finite) : [];
    if (t.length !== 4 || t.some((x) => x === null)) return `${at}: targets must be four numbers (Q1..Q4)`;
    const weights: Record<string, number> = {};
    for (const [code, w] of Object.entries(asObject(k.weights))) {
      const n = finite(w);
      if (!levelCodes.has(code)) return `${at}: unknown level code ${code}`;
      if (n === null || n < 0 || n > 100) return `${at}: weight for ${code} must be between 0 and 100`;
      weights[code] = n;
    }
    out.push({
      nameEn,
      nameTa: str(k.nameTa) ?? null,
      pqcdsm,
      direction: direction as Direction,
      unit,
      presentLevel,
      targets: t as [number, number, number, number],
      weights,
      kpiId: k.kpiId === undefined || k.kpiId === null ? null : str(k.kpiId, 40),
    });
  }
  return out;
}

export function templateRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  const header = async (id: string) =>
    (
      await pool.query(
        `SELECT t.id, t.plant_type_id AS "plantTypeId", pt.code AS "plantTypeCode", t.name, t.version, t.status,
                t.maker_id AS "makerId", t.checker_id AS "checkerId", t.activated_at AS "activatedAt"
         FROM core.kra_template t JOIN core.plant_type pt ON pt.id = t.plant_type_id WHERE t.id = $1`,
        [id],
      )
    ).rows[0] as
      | { id: string; plantTypeId: string; plantTypeCode: string; name: string; version: number; status: string; makerId: string; checkerId: string | null; activatedAt: string | null }
      | undefined;

  const levels = async (plantTypeId: string) =>
    (await pool.query('SELECT id, code, name_en AS "nameEn", rank FROM core.people_level WHERE plant_type_id = $1 ORDER BY rank', [plantTypeId])).rows as {
      id: string;
      code: string;
      nameEn: string;
      rank: number;
    }[];

  const krasOf = async (templateId: string) =>
    (
      await pool.query(
        `SELECT k.id, k.kpi_id AS "kpiId", k.name_en AS "nameEn", k.name_ta AS "nameTa", k.pqcdsm, k.direction, k.unit,
                k.present_level::float8 AS "presentLevel",
                ARRAY[k.q1_target::float8, k.q2_target::float8, k.q3_target::float8, k.q4_target::float8] AS targets,
                COALESCE((SELECT jsonb_object_agg(pl.code, w.weight::float8)
                          FROM core.template_kra_weight w JOIN core.people_level pl ON pl.id = w.people_level_id
                          WHERE w.template_kra_id = k.id), '{}'::jsonb) AS weights
         FROM core.template_kra k WHERE k.template_id = $1 ORDER BY k.sort_order`,
        [templateId],
      )
    ).rows as (DraftKra & { id: string; kpiId: string | null; nameTa: string | null; unit: string })[];

  app.get('/templates', { preHandler: g.requirePermission('templates:read') }, async (req) => {
    const q = asObject(req.query);
    const { rows } = await pool.query(
      `SELECT t.id, t.plant_type_id AS "plantTypeId", pt.code AS "plantTypeCode", t.name, t.version, t.status,
              t.activated_at AS "activatedAt", (SELECT count(*) FROM core.template_kra k WHERE k.template_id = t.id)::int AS "kraCount"
       FROM core.kra_template t JOIN core.plant_type pt ON pt.id = t.plant_type_id
       WHERE ($1::uuid IS NULL OR t.plant_type_id = $1) AND ($2::text IS NULL OR t.status = $2)
       ORDER BY pt.code, t.name, t.version DESC`,
      [str(q.plantTypeId, 40) ?? null, str(q.status, 10) ?? null],
    );
    return { templates: rows };
  });

  app.get('/templates/:id', { preHandler: g.requirePermission('templates:read') }, async (req, reply) => {
    const t = await header((req.params as { id: string }).id);
    if (!t) return reply.code(404).send({ error: 'NOT_FOUND' });
    const lv = await levels(t.plantTypeId);
    const kras = await krasOf(t.id);
    return { template: t, levels: lv, kras, validation: validateTemplate(lv.map((l) => l.code), kras) };
  });

  app.get('/templates/:id/validation', { preHandler: g.requirePermission('templates:read') }, async (req, reply) => {
    const t = await header((req.params as { id: string }).id);
    if (!t) return reply.code(404).send({ error: 'NOT_FOUND' });
    const lv = await levels(t.plantTypeId);
    return validateTemplate(lv.map((l) => l.code), await krasOf(t.id));
  });

  app.post('/templates', { preHandler: g.requirePermission('templates:write') }, async (req, reply) => {
    const b = asObject(req.body);
    const plantTypeId = str(b.plantTypeId, 40);
    const name = str(b.name);
    if (!plantTypeId || !name) return reply.code(400).send(bad('plantTypeId and name are required'));
    const { rows } = await pool.query(
      `INSERT INTO core.kra_template (plant_type_id, name, version, maker_id)
       VALUES ($1, $2, (SELECT COALESCE(MAX(version), 0) + 1 FROM core.kra_template WHERE plant_type_id = $1 AND name = $2), $3)
       RETURNING id, version`,
      [plantTypeId, name, req.auth!.userId],
    );
    await audit(pool, { actorId: req.auth!.userId, action: 'TEMPLATE_CREATED', entityType: 'kra_template', entityId: rows[0].id, after: { plantTypeId, name, version: rows[0].version }, ip: req.ip });
    return reply.code(201).send({ id: rows[0].id, version: rows[0].version });
  });

  /** Replace the whole KRA list of a draft. Only the author may edit, and only while it is a draft. */
  app.put('/templates/:id/kras', { preHandler: g.requirePermission('templates:write') }, async (req, reply) => {
    const auth = req.auth!;
    const t = await header((req.params as { id: string }).id);
    if (!t) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (t.status !== 'DRAFT') return reply.code(409).send({ error: 'NOT_DRAFT' });
    if (t.makerId !== auth.userId) return reply.code(403).send({ error: 'NOT_MAKER' });

    const lv = await levels(t.plantTypeId);
    const parsed = parseKras(asObject(req.body).kras, new Set(lv.map((l) => l.code)));
    if (typeof parsed === 'string') return reply.code(400).send(bad(parsed));
    const levelId = new Map(lv.map((l) => [l.code, l.id]));

    await withTransaction(pool, async (tx) => {
      await tx.query('DELETE FROM core.template_kra WHERE template_id = $1', [t.id]);
      for (const [i, k] of parsed.entries()) {
        const ins = await tx.query(
          `INSERT INTO core.template_kra
             (template_id, kpi_id, name_en, name_ta, pqcdsm, direction, unit, present_level, q1_target, q2_target, q3_target, q4_target, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [t.id, k.kpiId, k.nameEn, k.nameTa, k.pqcdsm, k.direction, k.unit, k.presentLevel, ...k.targets, i],
        );
        for (const [code, weight] of Object.entries(k.weights)) {
          await tx.query('INSERT INTO core.template_kra_weight (template_kra_id, people_level_id, weight) VALUES ($1,$2,$3)', [
            ins.rows[0].id,
            levelId.get(code),
            weight,
          ]);
        }
      }
      await audit(tx, { actorId: auth.userId, action: 'TEMPLATE_KRAS_SAVED', entityType: 'kra_template', entityId: t.id, after: { kraCount: parsed.length }, ip: req.ip });
    });
    return { saved: parsed.length, validation: validateTemplate(lv.map((l) => l.code), parsed) };
  });

  /** Checker step: activates a valid draft and retires the previous live version in one transaction. */
  app.post('/templates/:id/activate', { preHandler: g.requirePermission('templates:approve') }, async (req, reply) => {
    const auth = req.auth!;
    const t = await header((req.params as { id: string }).id);
    if (!t) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (t.status !== 'DRAFT') return reply.code(409).send({ error: 'NOT_DRAFT' });
    if (t.makerId === auth.userId) return reply.code(409).send({ error: 'SOD: the author of a template cannot approve it' });

    const lv = await levels(t.plantTypeId);
    const validation = validateTemplate(lv.map((l) => l.code), await krasOf(t.id));
    if (validation.errors.length > 0) {
      return reply.code(422).send({ error: 'TEMPLATE_INVALID', issues: validation.errors, warnings: validation.warnings });
    }

    await withTransaction(pool, async (tx) => {
      await tx.query("UPDATE core.kra_template SET status = 'RETIRED' WHERE plant_type_id = $1 AND name = $2 AND status = 'ACTIVE'", [t.plantTypeId, t.name]);
      await tx.query("UPDATE core.kra_template SET status = 'ACTIVE', checker_id = $2, activated_at = now() WHERE id = $1", [t.id, auth.userId]);
      await audit(tx, {
        actorId: auth.userId,
        action: 'TEMPLATE_ACTIVATED',
        entityType: 'kra_template',
        entityId: t.id,
        before: { status: 'DRAFT' },
        after: { status: 'ACTIVE', makerId: t.makerId, version: t.version },
        ip: req.ip,
      });
    });
    return { id: t.id, status: 'ACTIVE', warnings: validation.warnings };
  });

  /** Copies a live/retired template into a new draft version for editing. */
  app.post('/templates/:id/new-version', { preHandler: g.requirePermission('templates:write') }, async (req, reply) => {
    const auth = req.auth!;
    const src = await header((req.params as { id: string }).id);
    if (!src) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (src.status === 'DRAFT') return reply.code(409).send({ error: 'ALREADY_DRAFT' });

    const created = await withTransaction(pool, async (tx) => {
      const nt = await tx.query(
        `INSERT INTO core.kra_template (plant_type_id, name, version, maker_id)
         VALUES ($1, $2, (SELECT MAX(version) + 1 FROM core.kra_template WHERE plant_type_id = $1 AND name = $2), $3)
         RETURNING id, version`,
        [src.plantTypeId, src.name, auth.userId],
      );
      const olds = await tx.query('SELECT id FROM core.template_kra WHERE template_id = $1 ORDER BY sort_order', [src.id]);
      for (const [i, old] of olds.rows.entries()) {
        const copy = await tx.query(
          `INSERT INTO core.template_kra
             (template_id, kpi_id, name_en, name_ta, pqcdsm, direction, unit, present_level, q1_target, q2_target, q3_target, q4_target, sort_order)
           SELECT $2, kpi_id, name_en, name_ta, pqcdsm, direction, unit, present_level, q1_target, q2_target, q3_target, q4_target, $3
           FROM core.template_kra WHERE id = $1 RETURNING id`,
          [old.id, nt.rows[0].id, i],
        );
        await tx.query(
          `INSERT INTO core.template_kra_weight (template_kra_id, people_level_id, weight)
           SELECT $2, people_level_id, weight FROM core.template_kra_weight WHERE template_kra_id = $1`,
          [old.id, copy.rows[0].id],
        );
      }
      await audit(tx, { actorId: auth.userId, action: 'TEMPLATE_VERSION_CREATED', entityType: 'kra_template', entityId: nt.rows[0].id, before: { sourceId: src.id }, after: { version: nt.rows[0].version }, ip: req.ip });
      return nt.rows[0] as { id: string; version: number };
    });
    return reply.code(201).send(created);
  });
}
