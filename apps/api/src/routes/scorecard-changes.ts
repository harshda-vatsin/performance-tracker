import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import { withTransaction } from '../db.js';
import { fiscalYearOf, isPeriod } from '../fiscal.js';
import type { Guards } from './types.js';
import { asObject, bad, finite, str } from './util.js';

interface Change {
  kraId: string;
  presentLevel?: number;
  targets?: number[];
}

interface BaseKra {
  id: string;
  nameEn: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  presentLevel: number;
  targets: number[];
}

/**
 * Plant-level scorecard adjustments (doc 04 §3 row 6): Plant HR (or Corporate HR) proposes new present levels and
 * targets from a given month; a different person approves; approval creates a new immutable scorecard version.
 * Weights cannot change here, so the weight-per-level totals validated on the template always still hold.
 */
export function scorecardChangeRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  async function latestVersion(scorecardId: string) {
    return (
      await pool.query(
        `SELECT s.id, s.org_unit_id AS "orgUnitId", s.fiscal_year AS "fiscalYear", v.id AS "versionId", v.version
         FROM core.scorecard s JOIN core.scorecard_version v ON v.scorecard_id = s.id
         WHERE s.id = $1 ORDER BY v.version DESC LIMIT 1`,
        [scorecardId],
      )
    ).rows[0] as { id: string; orgUnitId: string; fiscalYear: number; versionId: string; version: number } | undefined;
  }

  async function baseKras(versionId: string): Promise<BaseKra[]> {
    return (
      await pool.query(
        `SELECT id, name_en AS "nameEn", direction, present_level::float8 AS "presentLevel",
                ARRAY[q1_target::float8, q2_target::float8, q3_target::float8, q4_target::float8] AS targets
         FROM core.scorecard_kra WHERE scorecard_version_id = $1 ORDER BY sort_order`,
        [versionId],
      )
    ).rows;
  }

  /** Months from `effectivePeriod` to the end of the fiscal year in which this unit already has a submission. */
  async function submissionsFrom(orgUnitId: string, effectivePeriod: string, fiscalYear: number): Promise<string[]> {
    const { rows } = await pool.query(
      'SELECT period FROM core.monthly_submission WHERE org_unit_id = $1 AND period >= $2 AND period <= $3 ORDER BY period',
      [orgUnitId, effectivePeriod, `${fiscalYear + 1}-03`],
    );
    return rows.map((r) => r.period);
  }

  app.post('/scorecards/:id/change-requests', { preHandler: g.requirePermission('scorecards:propose') }, async (req, reply) => {
    const auth = req.auth!;
    const sc = await latestVersion((req.params as { id: string }).id);
    if (!sc || !(await g.canAtUnit(auth, 'scorecards:read', sc.orgUnitId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!(await g.canAtUnit(auth, 'scorecards:propose', sc.orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });

    const b = asObject(req.body);
    const effectivePeriod = b.effectiveFromPeriod;
    const reason = str(b.reason, 1000);
    if (!isPeriod(effectivePeriod) || !reason || !Array.isArray(b.changes) || b.changes.length === 0) {
      return reply.code(400).send(bad('effectiveFromPeriod (YYYY-MM), reason and a non-empty changes array are required'));
    }
    if (fiscalYearOf(effectivePeriod) !== sc.fiscalYear) {
      return reply.code(400).send(bad(`effectiveFromPeriod must fall in fiscal year ${sc.fiscalYear}-${String(sc.fiscalYear + 1).slice(2)}`));
    }

    const kras = new Map((await baseKras(sc.versionId)).map((k) => [k.id, k]));
    const changes: Change[] = [];
    for (const [i, raw] of b.changes.entries()) {
      const it = asObject(raw);
      const kraId = str(it.kraId, 40);
      const base = kraId ? kras.get(kraId) : undefined;
      if (!kraId || !base) return reply.code(400).send(bad(`changes[${i}]: unknown kraId`));
      const presentLevel = it.presentLevel === undefined ? undefined : finite(it.presentLevel);
      const targets = it.targets === undefined ? undefined : Array.isArray(it.targets) ? it.targets.map(finite) : null;
      if (presentLevel === null || targets === null || (targets && (targets.length !== 4 || targets.some((t) => t === null)))) {
        return reply.code(400).send(bad(`changes[${i}]: presentLevel must be a number and targets four numbers`));
      }
      if (presentLevel === undefined && targets === undefined) return reply.code(400).send(bad(`changes[${i}]: nothing to change`));

      // The result must still have every target on the improving side of the present level (doc 05 §1.7 rule 1).
      const pl = presentLevel ?? base.presentLevel;
      const tg = (targets as number[] | undefined) ?? base.targets;
      const ok = base.direction === 'HIGHER_BETTER' ? tg.every((t) => t >= pl) : tg.every((t) => t <= pl);
      if (!ok) return reply.code(400).send(bad(`changes[${i}] "${base.nameEn}": a target would be on the wrong side of present level ${pl}`));
      changes.push({ kraId, ...(presentLevel !== undefined ? { presentLevel } : {}), ...(targets ? { targets: targets as number[] } : {}) });
    }

    const existing = await submissionsFrom(sc.orgUnitId, effectivePeriod, sc.fiscalYear);
    if (existing.length > 0) return reply.code(409).send({ error: 'SUBMISSIONS_EXIST', periods: existing });

    const { rows } = await pool.query(
      `INSERT INTO core.scorecard_change_request (scorecard_id, base_version_id, effective_period, reason, changes, maker_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [sc.id, sc.versionId, effectivePeriod, reason, JSON.stringify(changes), auth.userId],
    );
    await audit(pool, {
      actorId: auth.userId,
      action: 'SCORECARD_CHANGE_PROPOSED',
      entityType: 'scorecard_change_request',
      entityId: rows[0].id,
      after: { scorecardId: sc.id, effectivePeriod, reason, changes },
      ip: req.ip,
    });
    return reply.code(201).send({ id: rows[0].id });
  });

  app.get('/scorecards/:id/change-requests', { preHandler: g.requirePermission('scorecards:read') }, async (req, reply) => {
    const sc = await latestVersion((req.params as { id: string }).id);
    if (!sc || !(await g.canAtUnit(req.auth!, 'scorecards:read', sc.orgUnitId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    const { rows } = await pool.query(
      `SELECT id, effective_period AS "effectivePeriod", reason, changes, state, decision_comment AS "decisionComment",
              created_at AS "createdAt", decided_at AS "decidedAt"
       FROM core.scorecard_change_request WHERE scorecard_id = $1 ORDER BY created_at DESC`,
      [sc.id],
    );
    return { requests: rows };
  });

  app.post('/scorecard-change-requests/:id/decision', { preHandler: g.requirePermission('scorecards:approve') }, async (req, reply) => {
    const auth = req.auth!;
    const b = asObject(req.body);
    if (typeof b.approve !== 'boolean') return reply.code(400).send(bad('approve (true/false) is required'));

    const cr = (
      await pool.query(
        `SELECT id, scorecard_id AS "scorecardId", base_version_id AS "baseVersionId", effective_period AS "effectivePeriod",
                changes, maker_id AS "makerId", state
         FROM core.scorecard_change_request WHERE id = $1`,
        [(req.params as { id: string }).id],
      )
    ).rows[0] as { id: string; scorecardId: string; baseVersionId: string; effectivePeriod: string; changes: Change[]; makerId: string; state: string } | undefined;
    const sc = cr ? await latestVersion(cr.scorecardId) : undefined;
    if (!cr || !sc || !(await g.canAtUnit(auth, 'scorecards:read', sc.orgUnitId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!(await g.canAtUnit(auth, 'scorecards:approve', sc.orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (cr.state !== 'PENDING') return reply.code(409).send({ error: 'ALREADY_DECIDED' });
    if (cr.makerId === auth.userId) return reply.code(409).send({ error: 'SOD: the author of a scorecard change cannot approve it' });
    const comment = str(b.comment, 1000);
    if (!b.approve && !comment) return reply.code(400).send(bad('a comment is required to refuse a change'));

    if (!b.approve) {
      await pool.query("UPDATE core.scorecard_change_request SET state = 'REJECTED', checker_id = $2, decision_comment = $3, decided_at = now() WHERE id = $1", [cr.id, auth.userId, comment]);
      await audit(pool, { actorId: auth.userId, action: 'SCORECARD_CHANGE_REFUSED', entityType: 'scorecard_change_request', entityId: cr.id, after: { comment }, ip: req.ip });
      return { state: 'REJECTED' };
    }

    // The world may have moved since the proposal: re-check the base version and that no month it affects has started.
    if (sc.versionId !== cr.baseVersionId) return reply.code(409).send({ error: 'STALE_BASE' });
    const existing = await submissionsFrom(sc.orgUnitId, cr.effectivePeriod, sc.fiscalYear);
    if (existing.length > 0) return reply.code(409).send({ error: 'SUBMISSIONS_EXIST', periods: existing });

    const newVersionId = await withTransaction(pool, async (tx) => {
      const ver = await tx.query(
        "INSERT INTO core.scorecard_version (scorecard_id, version, effective_from) VALUES ($1, $2, ($3 || '-01')::date) RETURNING id",
        [sc.id, sc.version + 1, cr.effectivePeriod],
      );
      const byKra = new Map(cr.changes.map((c) => [c.kraId, c]));
      const olds = await tx.query(
        `SELECT id, name_en, name_ta, pqcdsm, direction, unit, present_level::text, q1_target::text, q2_target::text,
                q3_target::text, q4_target::text, sort_order
         FROM core.scorecard_kra WHERE scorecard_version_id = $1 ORDER BY sort_order`,
        [cr.baseVersionId],
      );
      for (const o of olds.rows) {
        const ch = byKra.get(o.id);
        const t = ch?.targets;
        const copy = await tx.query(
          `INSERT INTO core.scorecard_kra
             (scorecard_version_id, name_en, name_ta, pqcdsm, direction, unit, present_level, q1_target, q2_target, q3_target, q4_target, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [ver.rows[0].id, o.name_en, o.name_ta, o.pqcdsm, o.direction, o.unit, ch?.presentLevel ?? o.present_level, t?.[0] ?? o.q1_target, t?.[1] ?? o.q2_target, t?.[2] ?? o.q3_target, t?.[3] ?? o.q4_target, o.sort_order],
        );
        await tx.query(
          `INSERT INTO core.scorecard_kra_weight (scorecard_kra_id, people_level_id, weight)
           SELECT $2, people_level_id, weight FROM core.scorecard_kra_weight WHERE scorecard_kra_id = $1`,
          [o.id, copy.rows[0].id],
        );
      }
      await tx.query(
        "UPDATE core.scorecard_change_request SET state = 'APPROVED', checker_id = $2, decision_comment = $3, new_version_id = $4, decided_at = now() WHERE id = $1",
        [cr.id, auth.userId, comment, ver.rows[0].id],
      );
      await audit(tx, {
        actorId: auth.userId,
        action: 'SCORECARD_CHANGE_APPROVED',
        entityType: 'scorecard_change_request',
        entityId: cr.id,
        after: { newVersion: sc.version + 1, effectivePeriod: cr.effectivePeriod, makerId: cr.makerId },
        ip: req.ip,
      });
      return ver.rows[0].id as string;
    });
    return { state: 'APPROVED', version: sc.version + 1, versionId: newVersionId };
  });
}
