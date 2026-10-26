import { scoreKra } from '@mmf/scoring';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import type { AuthContext } from '../auth/service.js';
import { withTransaction, type Db } from '../db.js';
import { daysInMonth, fiscalYearOf, isPeriod, quarterOf } from '../fiscal.js';
import { scopeFor } from '../rbac/policy.js';
import { computeMonth, ENGINE_VERSION, hashInputs, resolveParams, type ResultRow, type Stint } from '../scoring/monthly.js';
import type { Guards } from './types.js';
import { asObject, bad, finite, str, unitProblem } from './util.js';

type State = 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'LOCKED' | 'REOPENED';

interface Sub {
  id: string;
  orgUnitId: string;
  unitCode: string;
  period: string;
  state: State;
  revision: number;
  scorecardVersionId: string;
  plantTypeId: string;
  plantDefaults: unknown;
}

interface FullRow extends ResultRow {
  kraId: string;
  pqcdsm: string;
  unit: string;
  remarks: string | null;
}

interface Issue {
  code: 'MISSING' | 'OUTLIER_NEEDS_COMMENT' | 'CHANGE_NEEDS_COMMENT';
  kra: string;
  message: string;
}

/** Doc 06 §1 transition table (Phase 1 states). `perm` may depend on the state a rejection comes from. */
const ACTIONS: Record<string, { from: State[]; to: State; perm: (from: State) => string }> = {
  submit: { from: ['DRAFT', 'REOPENED'], to: 'SUBMITTED', perm: () => 'submissions:submit' },
  verify: { from: ['SUBMITTED'], to: 'VERIFIED', perm: () => 'submissions:verify' },
  approve: { from: ['VERIFIED'], to: 'APPROVED', perm: () => 'submissions:approve' },
  lock: { from: ['APPROVED'], to: 'LOCKED', perm: () => 'submissions:lock' },
  reject: {
    from: ['SUBMITTED', 'VERIFIED', 'APPROVED'],
    to: 'REJECTED',
    perm: (from) => (from === 'SUBMITTED' ? 'submissions:verify' : from === 'VERIFIED' ? 'submissions:approve' : 'submissions:lock'),
  },
  resume: { from: ['REJECTED'], to: 'DRAFT', perm: () => 'submissions:enter' },
};

export function submissionRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  async function loadSub(id: string): Promise<Sub | undefined> {
    return (
      await pool.query(
        `SELECT s.id, s.org_unit_id AS "orgUnitId", ou.code AS "unitCode", s.period, s.state, s.revision,
                s.scorecard_version_id AS "scorecardVersionId", pt.id AS "plantTypeId", pt.defaults AS "plantDefaults"
         FROM core.monthly_submission s
         JOIN core.org_unit ou ON ou.id = s.org_unit_id
         JOIN core.org_unit p ON p.unit_type = 'PLANT' AND ou.path <@ p.path
         JOIN core.plant_type pt ON pt.id = p.plant_type_id
         WHERE s.id = $1`,
        [id],
      )
    ).rows[0];
  }

  async function loadRows(db: Db, submissionId: string): Promise<FullRow[]> {
    return (
      await db.query(
        `SELECT r.id AS "resultId", r.scorecard_kra_id AS "kraId", k.name_en AS "nameEn", k.pqcdsm, k.direction, k.unit,
                r.present_level_used::float8 AS "presentLevel", r.target_used::float8 AS target,
                r.result::float8 AS result, r.na_reason AS "naReason", r.remarks,
                COALESCE((SELECT jsonb_object_agg(pl.code, w.weight::float8) FROM core.scorecard_kra_weight w
                          JOIN core.people_level pl ON pl.id = w.people_level_id WHERE w.scorecard_kra_id = k.id), '{}'::jsonb) AS weights
         FROM core.monthly_result r JOIN core.scorecard_kra k ON k.id = r.scorecard_kra_id
         WHERE r.submission_id = $1 ORDER BY k.sort_order`,
        [submissionId],
      )
    ).rows;
  }

  const loadLevels = async (db: Db, plantTypeId: string) =>
    (await db.query('SELECT id, code FROM core.people_level WHERE plant_type_id = $1 ORDER BY rank', [plantTypeId])).rows as { id: string; code: string }[];

  async function loadStints(db: Db, submissionId: string): Promise<Stint[]> {
    return (
      await db.query(
        `SELECT la.employee_id AS "employeeId", pl.code AS "levelCode", la.days_in_unit AS days
         FROM core.level_assignment la JOIN core.people_level pl ON pl.id = la.people_level_id
         WHERE la.submission_id = $1 ORDER BY la.employee_id`,
        [submissionId],
      )
    ).rows;
  }

  /** Submission the caller may see, else answers 404 (scope cannot be probed). */
  async function visible(req: Parameters<Guards['requireAuth']>[0], reply: Parameters<Guards['requireAuth']>[1], id: string): Promise<Sub | null> {
    const sub = await loadSub(id);
    if (!sub || !(await g.canAtUnit(req.auth!, 'submissions:read', sub.orgUnitId))) {
      await reply.code(404).send({ error: 'NOT_FOUND' });
      return null;
    }
    return sub;
  }

  /** Submit-time guard (doc 06 §1): complete, outliers explained, and reopened changes commented. */
  async function submitIssues(sub: Sub, rows: FullRow[], params: ReturnType<typeof resolveParams>): Promise<Issue[]> {
    const issues: Issue[] = [];
    for (const r of rows) {
      if (r.result === null && !r.naReason) {
        issues.push({ code: 'MISSING', kra: r.nameEn, message: `"${r.nameEn}" needs a result or an N/A reason` });
        continue;
      }
      if (r.result !== null && !r.remarks) {
        let outlier = r.presentLevel !== 0 && Math.abs(r.result) > 3 * Math.abs(r.presentLevel);
        try {
          const raw = scoreKra({ presentLevel: r.presentLevel, target: r.target, result: r.result, direction: r.direction }, params).raw;
          outlier ||= raw < -100 || raw > 200;
        } catch {
          // Target on the wrong side cannot be scored; the template/scorecard rules already forbid it.
        }
        if (outlier) issues.push({ code: 'OUTLIER_NEEDS_COMMENT', kra: r.nameEn, message: `"${r.nameEn}" is an outlier and needs a comment` });
      }
    }
    if (sub.state === 'REOPENED') {
      const prev = (
        await pool.query('SELECT inputs FROM core.calc_run WHERE submission_id = $1 ORDER BY ran_at DESC LIMIT 1', [sub.id])
      ).rows[0]?.inputs as { results: { kraId: string; result: number | null; naReason: string | null; remarks: string | null }[] } | undefined;
      const before = new Map((prev?.results ?? []).map((p) => [p.kraId, p]));
      for (const r of rows) {
        const p = before.get(r.kraId);
        const changed = !p || p.result !== r.result || (p.naReason ?? null) !== (r.naReason ?? null);
        if (changed && (!r.remarks || r.remarks === (p?.remarks ?? null))) {
          issues.push({ code: 'CHANGE_NEEDS_COMMENT', kra: r.nameEn, message: `"${r.nameEn}" changed after reopening and needs a new comment` });
        }
      }
    }
    return issues;
  }

  async function createOfficialRun(tx: Db, sub: Sub, rows: FullRow[], levels: { id: string; code: string }[], stints: Stint[], params: ReturnType<typeof resolveParams>, userId: string) {
    const scores = computeMonth(rows, levels.map((l) => l.code), stints, params);
    const inputs = {
      period: sub.period,
      scorecardVersionId: sub.scorecardVersionId,
      results: rows.map((r) => ({ kraId: r.kraId, result: r.result, naReason: r.naReason, remarks: r.remarks, target: r.target, presentLevel: r.presentLevel })),
      assignments: stints,
    };
    const run = await tx.query(
      `INSERT INTO core.calc_run (submission_id, revision, params, engine_version, input_hash, inputs, ran_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [sub.id, sub.revision, JSON.stringify(params), ENGINE_VERSION, hashInputs({ inputs, params, engine: ENGINE_VERSION }), JSON.stringify(inputs), userId],
    );
    const runId = run.rows[0].id as string;
    for (const k of scores.kras) {
      await tx.query('INSERT INTO core.kra_score (calc_run_id, monthly_result_id, raw_score, final_score, flags) VALUES ($1,$2,$3,$4,$5)', [runId, k.resultId, k.raw, k.final, k.flags]);
    }
    const levelId = new Map(levels.map((l) => [l.code, l.id]));
    for (const l of scores.levels) {
      await tx.query('INSERT INTO core.level_score (calc_run_id, people_level_id, score, flags) VALUES ($1,$2,$3,$4)', [runId, levelId.get(l.levelCode), l.score, l.flags]);
    }
    for (const e of scores.employees) {
      await tx.query(
        'INSERT INTO core.employee_score (calc_run_id, employee_id, period, people_level_id, days_in_unit, score) VALUES ($1,$2,$3,$4,$5,$6)',
        [runId, e.employeeId, sub.period, levelId.get(e.levelCode), e.days, e.score],
      );
    }
    return runId;
  }

  // ------------------------------------------------------------ create & read

  app.post('/submissions', { preHandler: g.requirePermission('submissions:enter') }, async (req, reply) => {
    const auth = req.auth!;
    const b = asObject(req.body);
    const orgUnitId = str(b.orgUnitId, 40);
    if (!orgUnitId || !isPeriod(b.period)) return reply.code(400).send(bad('orgUnitId and period (YYYY-MM) are required'));
    const period = b.period;
    if (!(await g.canAtUnit(auth, 'submissions:enter', orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });

    const version = (
      await pool.query(
        `SELECT v.id FROM core.scorecard s JOIN core.scorecard_version v ON v.scorecard_id = s.id
         WHERE s.org_unit_id = $1 AND s.fiscal_year = $2 AND v.effective_from <= ($3 || '-01')::date
         ORDER BY v.effective_from DESC, v.version DESC LIMIT 1`,
        [orgUnitId, fiscalYearOf(period), period],
      )
    ).rows[0];
    if (!version) return reply.code(409).send({ error: 'NO_SCORECARD' });

    const q = quarterOf(period);
    const id = await withTransaction(pool, async (tx) => {
      const sub = await tx.query(
        'INSERT INTO core.monthly_submission (org_unit_id, period, scorecard_version_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
        [orgUnitId, period, version.id, auth.userId],
      );
      const kras = await tx.query(
        'SELECT id, present_level, q1_target, q2_target, q3_target, q4_target FROM core.scorecard_kra WHERE scorecard_version_id = $1',
        [version.id],
      );
      for (const k of kras.rows) {
        await tx.query('INSERT INTO core.monthly_result (submission_id, scorecard_kra_id, target_used, present_level_used) VALUES ($1,$2,$3,$4)', [
          sub.rows[0].id,
          k.id,
          k[`q${q}_target`],
          k.present_level,
        ]);
      }
      await audit(tx, { actorId: auth.userId, action: 'SUBMISSION_CREATED', entityType: 'monthly_submission', entityId: sub.rows[0].id, after: { orgUnitId, period }, ip: req.ip });
      return sub.rows[0].id as string;
    });
    return reply.code(201).send({ id });
  });

  app.get('/submissions', { preHandler: g.requirePermission('submissions:read') }, async (req) => {
    const scope = scopeFor(req.auth!.assignments, 'submissions:read');
    const q = asObject(req.query);
    const { rows } = await pool.query(
      `SELECT s.id, s.org_unit_id AS "orgUnitId", u.code AS "unitCode", s.period, s.state, s.revision
       FROM core.monthly_submission s JOIN core.org_unit u ON u.id = s.org_unit_id
       WHERE ($1::boolean OR u.path <@ ANY($2::ltree[]))
         AND ($3::uuid IS NULL OR s.org_unit_id = $3) AND ($4::text IS NULL OR s.period = $4) AND ($5::text IS NULL OR s.state = $5)
       ORDER BY s.period DESC, u.code`,
      [scope.company, scope.paths, str(q.orgUnitId, 40) ?? null, isPeriod(q.period) ? q.period : null, str(q.state, 20) ?? null],
    );
    return { submissions: rows };
  });

  app.get('/submissions/:id', { preHandler: g.requirePermission('submissions:read') }, async (req, reply) => {
    const sub = await visible(req, reply, (req.params as { id: string }).id);
    if (!sub) return;
    const rows = await loadRows(pool, sub.id);
    const assignments = (
      await pool.query(
        `SELECT e.employee_code AS "employeeCode", e.full_name AS "fullName", pl.code AS "levelCode", la.days_in_unit AS "daysInUnit"
         FROM core.level_assignment la JOIN core.employee e ON e.id = la.employee_id JOIN core.people_level pl ON pl.id = la.people_level_id
         WHERE la.submission_id = $1 ORDER BY e.employee_code`,
        [sub.id],
      )
    ).rows;
    const events = (
      await pool.query(
        `SELECT w.revision, w.from_state AS "fromState", w.to_state AS "toState", u.login_id AS actor, w.comment, w.at
         FROM core.workflow_event w JOIN core.user_account u ON u.id = w.actor_id
         WHERE w.entity_type = 'SUBMISSION' AND w.entity_id = $1 ORDER BY w.id`,
        [sub.id],
      )
    ).rows;
    return {
      submission: { id: sub.id, orgUnitId: sub.orgUnitId, unitCode: sub.unitCode, period: sub.period, state: sub.state, revision: sub.revision },
      results: rows.map(({ weights: _w, ...r }) => r),
      levelAssignments: assignments,
      events,
    };
  });

  // ------------------------------------------------------------- data entry

  app.put('/submissions/:id/results', { preHandler: g.requirePermission('submissions:enter') }, async (req, reply) => {
    const auth = req.auth!;
    const sub = await visible(req, reply, (req.params as { id: string }).id);
    if (!sub) return;
    if (!(await g.canAtUnit(auth, 'submissions:enter', sub.orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (sub.state !== 'DRAFT' && sub.state !== 'REOPENED') return reply.code(409).send({ error: 'NOT_EDITABLE', state: sub.state });

    const items = asObject(req.body).results;
    if (!Array.isArray(items) || items.length === 0) return reply.code(400).send(bad('results must be a non-empty array'));
    const current = new Map((await loadRows(pool, sub.id)).map((r) => [r.kraId, r]));
    const updates: { kraId: string; result: number | null; naReason: string | null; remarks: string | null }[] = [];

    for (const [i, raw] of items.entries()) {
      const it = asObject(raw);
      const kraId = str(it.kraId, 40);
      const row = kraId ? current.get(kraId) : undefined;
      if (!kraId || !row) return reply.code(400).send(bad(`results[${i}]: unknown kraId`));

      let result = row.result;
      let naReason = row.naReason;
      let remarks = row.remarks;
      if ('result' in it) {
        if (it.result === null) result = null;
        else {
          const n = finite(it.result);
          if (n === null) return reply.code(400).send(bad(`results[${i}]: result must be a number or null`));
          const problem = unitProblem(row.unit, n);
          if (problem) return reply.code(400).send(bad(`results[${i}] "${row.nameEn}": ${problem}`));
          result = n;
          naReason = null;
        }
      }
      if ('naReason' in it) {
        if (it.naReason === null) naReason = null;
        else {
          const reason = str(it.naReason, 500);
          if (!reason) return reply.code(400).send(bad(`results[${i}]: naReason must be text or null`));
          if (it.result !== undefined && it.result !== null) return reply.code(400).send(bad(`results[${i}]: give either a result or an N/A reason, not both`));
          naReason = reason;
          result = null;
        }
      }
      if ('remarks' in it) remarks = it.remarks === null ? null : (str(it.remarks, 1000) ?? null);
      updates.push({ kraId, result, naReason, remarks });
    }

    await withTransaction(pool, async (tx) => {
      for (const u of updates) {
        await tx.query(
          'UPDATE core.monthly_result SET result = $3, na_reason = $4, remarks = $5, updated_by = $6, updated_at = now() WHERE submission_id = $1 AND scorecard_kra_id = $2',
          [sub.id, u.kraId, u.result, u.naReason, u.remarks, auth.userId],
        );
      }
      await audit(tx, { actorId: auth.userId, action: 'RESULTS_SAVED', entityType: 'monthly_submission', entityId: sub.id, after: { rows: updates.length }, ip: req.ip });
    });
    return { saved: updates.length };
  });

  app.put('/submissions/:id/level-assignments', { preHandler: g.requirePermission('submissions:enter') }, async (req, reply) => {
    const auth = req.auth!;
    const sub = await visible(req, reply, (req.params as { id: string }).id);
    if (!sub) return;
    if (!(await g.canAtUnit(auth, 'submissions:enter', sub.orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (sub.state !== 'DRAFT' && sub.state !== 'REOPENED') return reply.code(409).send({ error: 'NOT_EDITABLE', state: sub.state });

    const items = asObject(req.body).assignments;
    if (!Array.isArray(items)) return reply.code(400).send(bad('assignments must be an array'));
    const levels = await loadLevels(pool, sub.plantTypeId);
    const levelId = new Map(levels.map((l) => [l.code, l.id]));
    const month = daysInMonth(sub.period);
    const seen = new Set<string>();
    const parsed: { employeeId: string; levelId: string; days: number }[] = [];

    for (const [i, raw] of items.entries()) {
      const it = asObject(raw);
      const employeeId = str(it.employeeId, 40);
      const lvl = str(it.levelCode, 40)?.toUpperCase();
      const days = finite(it.daysInUnit);
      if (!employeeId || !lvl || !levelId.has(lvl)) return reply.code(400).send(bad(`assignments[${i}]: employeeId and a valid levelCode are required`));
      if (days === null || !Number.isInteger(days) || days < 1 || days > month) return reply.code(400).send(bad(`assignments[${i}]: daysInUnit must be 1 to ${month}`));
      if (seen.has(employeeId)) return reply.code(400).send(bad(`assignments[${i}]: employee listed twice`));
      seen.add(employeeId);
      const placed = await pool.query(
        `SELECT 1 FROM core.employee_assignment WHERE employee_id = $1 AND org_unit_id = $2
           AND valid && daterange($3::date, ($3::date + interval '1 month')::date, '[)')`,
        [employeeId, sub.orgUnitId, `${sub.period}-01`],
      );
      if (!placed.rowCount) return reply.code(400).send(bad(`assignments[${i}]: employee is not assigned to this unit during ${sub.period}`));
      parsed.push({ employeeId, levelId: levelId.get(lvl)!, days });
    }

    await withTransaction(pool, async (tx) => {
      await tx.query('DELETE FROM core.level_assignment WHERE submission_id = $1', [sub.id]);
      for (const p of parsed) {
        await tx.query(
          'INSERT INTO core.level_assignment (submission_id, org_unit_id, people_level_id, employee_id, period, days_in_unit) VALUES ($1,$2,$3,$4,$5,$6)',
          [sub.id, sub.orgUnitId, p.levelId, p.employeeId, sub.period, p.days],
        );
      }
      await audit(tx, { actorId: auth.userId, action: 'LEVEL_ASSIGNMENTS_SAVED', entityType: 'monthly_submission', entityId: sub.id, after: { count: parsed.length }, ip: req.ip });
    });
    return { saved: parsed.length };
  });

  app.get('/submissions/:id/preview', { preHandler: g.requirePermission('submissions:read') }, async (req, reply) => {
    const sub = await visible(req, reply, (req.params as { id: string }).id);
    if (!sub) return;
    const rows = await loadRows(pool, sub.id);
    const levels = await loadLevels(pool, sub.plantTypeId);
    const scores = computeMonth(rows, levels.map((l) => l.code), await loadStints(pool, sub.id), resolveParams(sub.plantDefaults));
    return { official: false, state: sub.state, ...scores };
  });

  /**
   * One workflow step for one submission inside the caller's transaction (shared by the single-unit and plant-month
   * routes). Returns the new revision, or null when the row had already moved on (stale client).
   */
  async function applyTransition(tx: Db, sub: Sub, action: string, to: State, auth: AuthContext, comment: string | null, ip: string): Promise<number | null> {
    const newRevision = action === 'resume' ? sub.revision + 1 : sub.revision;
    const upd = await tx.query(
      `UPDATE core.monthly_submission
       SET state = $2, revision = $3, submitted_at = CASE WHEN $2 = 'SUBMITTED' THEN now() ELSE submitted_at END
       WHERE id = $1 AND state = $4 AND revision = $5`,
      [sub.id, to, newRevision, sub.state, sub.revision],
    );
    if (upd.rowCount === 0) return null;
    await tx.query(
      `INSERT INTO core.workflow_event (entity_type, entity_id, revision, from_state, to_state, actor_id, comment)
       VALUES ('SUBMISSION', $1, $2, $3, $4, $5, $6)`,
      [sub.id, newRevision, sub.state, to, auth.userId, comment],
    );
    if (action === 'lock') {
      const levels = await loadLevels(tx, sub.plantTypeId);
      await createOfficialRun(tx, sub, await loadRows(tx, sub.id), levels, await loadStints(tx, sub.id), resolveParams(sub.plantDefaults), auth.userId);
    }
    await audit(tx, {
      actorId: auth.userId,
      action: `SUBMISSION_${action.toUpperCase()}`,
      entityType: 'monthly_submission',
      entityId: sub.id,
      before: { state: sub.state },
      after: { state: to, revision: newRevision },
      ip,
    });
    return newRevision;
  }

  // ------------------------------------------------------- plant-month bulk

  /**
   * Approve or lock every scored unit of a plant for a month in one action (doc 06 §1 "Rules"). All-or-nothing: if any
   * unit is not ready and not explicitly excluded with a reason, nothing changes. One workflow event is written per unit.
   */
  app.post('/plants/:plantId/months/:period/transitions', { preHandler: g.requireAuth }, async (req, reply) => {
    const auth = req.auth!;
    const { plantId, period } = req.params as { plantId: string; period: string };
    const b = asObject(req.body);
    const action = str(b.action, 20);
    if (!isPeriod(period) || (action !== 'approve' && action !== 'lock')) {
      return reply.code(400).send(bad('period (YYYY-MM) and action (approve or lock) are required'));
    }
    const def = ACTIONS[action];

    const plant = (
      await pool.query(
        `SELECT p.path::text AS path, pt.scoring_unit_type AS "unitType"
         FROM core.org_unit p JOIN core.plant_type pt ON pt.id = p.plant_type_id WHERE p.id = $1 AND p.unit_type = 'PLANT'`,
        [plantId],
      )
    ).rows[0] as { path: string; unitType: string } | undefined;
    if (!plant || !(await g.canAtUnit(auth, 'submissions:read', plantId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!(await g.canAtUnit(auth, def.perm(def.from[0]), plantId))) return reply.code(403).send({ error: 'FORBIDDEN' });

    const units = (
      await pool.query(
        `SELECT u.id, u.code, s.id AS "submissionId", s.state
         FROM core.org_unit u LEFT JOIN core.monthly_submission s ON s.org_unit_id = u.id AND s.period = $2
         WHERE u.unit_type = $3 AND u.active AND u.path <@ $1::ltree ORDER BY u.code`,
        [plant.path, period, plant.unitType],
      )
    ).rows as { id: string; code: string; submissionId: string | null; state: State | null }[];

    const excluded = new Map<string, string>();
    for (const [i, raw] of (Array.isArray(b.exclusions) ? b.exclusions : []).entries()) {
      const ex = asObject(raw);
      const unitId = str(ex.orgUnitId, 40);
      const reason = str(ex.reason, 500);
      if (!unitId || !units.some((u) => u.id === unitId) || !reason) {
        return reply.code(400).send(bad(`exclusions[${i}]: a unit of this plant and a reason are required`));
      }
      excluded.set(unitId, reason);
    }

    const notReady = units.filter((u) => !excluded.has(u.id) && !(u.state && def.from.includes(u.state)));
    if (notReady.length > 0) {
      return reply.code(409).send({ error: 'UNITS_NOT_READY', units: notReady.map((u) => ({ unitCode: u.code, state: u.state ?? 'NOT_STARTED' })) });
    }
    const targets = units.filter((u) => !excluded.has(u.id));
    if (targets.length === 0) return reply.code(409).send({ error: 'NOTHING_TO_DO' });
    const subs = (await Promise.all(targets.map((t) => loadSub(t.submissionId!)))).filter((s): s is Sub => s !== undefined);

    try {
      await withTransaction(pool, async (tx) => {
        for (const s of subs) {
          if ((await applyTransition(tx, s, action, def.to, auth, null, req.ip)) === null) throw new Error('STALE_STATE');
        }
        await audit(tx, {
          actorId: auth.userId,
          action: `PLANT_MONTH_${action.toUpperCase()}`,
          entityType: 'org_unit',
          entityId: plantId,
          after: { period, units: targets.map((t) => t.code), exclusions: [...excluded].map(([id, reason]) => ({ unit: units.find((u) => u.id === id)!.code, reason })) },
          ip: req.ip,
        });
      });
    } catch (err) {
      if ((err as Error).message === 'STALE_STATE') return reply.code(409).send({ error: 'STALE_STATE' });
      throw err;
    }
    return {
      action,
      period,
      state: def.to,
      count: subs.length,
      excluded: [...excluded].map(([id, reason]) => ({ unitCode: units.find((u) => u.id === id)!.code, reason })),
    };
  });

  // ------------------------------------------------------------ transitions

  app.post('/submissions/:id/transitions', { preHandler: g.requireAuth }, async (req, reply) => {
    const auth = req.auth!;
    const b = asObject(req.body);
    const action = str(b.action, 20);
    const def = action ? ACTIONS[action] : undefined;
    if (!action || !def) return reply.code(400).send(bad(`action must be one of ${Object.keys(ACTIONS).join(', ')}`));

    const sub = await visible(req, reply, (req.params as { id: string }).id);
    if (!sub) return;
    if (!def.from.includes(sub.state)) return reply.code(409).send({ error: 'WRONG_STATE', state: sub.state });
    if (!(await g.canAtUnit(auth, def.perm(sub.state), sub.orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });

    const comment = str(b.comment, 1000);
    if ((action === 'reject' || (action === 'submit' && sub.state === 'REOPENED')) && !comment) {
      return reply.code(400).send(bad('a comment is required for this action'));
    }
    if (b.revision !== undefined && b.revision !== sub.revision) return reply.code(409).send({ error: 'STALE_REVISION', revision: sub.revision });

    if (action === 'submit') {
      const issues = await submitIssues(sub, await loadRows(pool, sub.id), resolveParams(sub.plantDefaults));
      if (issues.length > 0) return reply.code(422).send({ error: 'SUBMISSION_INVALID', issues });
    }

    const newRevision = await withTransaction(pool, (tx) => applyTransition(tx, sub, action, def.to, auth, comment ?? null, req.ip));
    if (newRevision === null) return reply.code(409).send({ error: 'STALE_STATE' });
    return { state: def.to, revision: newRevision };
  });

  // ----------------------------------------------------------------- scores

  app.get('/submissions/:id/scores', { preHandler: g.requirePermission('scores:read') }, async (req, reply) => {
    const sub = await loadSub((req.params as { id: string }).id);
    if (!sub || !(await g.canAtUnit(req.auth!, 'scores:read', sub.orgUnitId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    const run = (
      await pool.query(
        `SELECT id, revision, engine_version AS "engineVersion", input_hash AS "inputHash", params, ran_at AS "ranAt"
         FROM core.calc_run WHERE submission_id = $1 AND superseded_at IS NULL`,
        [sub.id],
      )
    ).rows[0];
    if (!run) return reply.code(404).send({ error: 'NO_OFFICIAL_RUN' });

    const kras = (
      await pool.query(
        `SELECT k.name_en AS "nameEn", ks.raw_score::float8 AS raw, ks.final_score::float8 AS final, ks.flags
         FROM core.kra_score ks JOIN core.monthly_result r ON r.id = ks.monthly_result_id
         JOIN core.scorecard_kra k ON k.id = r.scorecard_kra_id WHERE ks.calc_run_id = $1 ORDER BY k.sort_order`,
        [run.id],
      )
    ).rows;
    const levels = (
      await pool.query(
        `SELECT pl.code AS "levelCode", ls.score::float8 AS score, ls.flags FROM core.level_score ls
         JOIN core.people_level pl ON pl.id = ls.people_level_id WHERE ls.calc_run_id = $1 ORDER BY pl.rank`,
        [run.id],
      )
    ).rows;
    const employees = (
      await pool.query(
        `SELECT e.employee_code AS "employeeCode", e.full_name AS "fullName", pl.code AS "levelCode", es.days_in_unit AS days, es.score::float8 AS score
         FROM core.employee_score es JOIN core.employee e ON e.id = es.employee_id JOIN core.people_level pl ON pl.id = es.people_level_id
         WHERE es.calc_run_id = $1 ORDER BY e.employee_code`,
        [run.id],
      )
    ).rows;
    return { official: true, run, kras, levels, employees };
  });

  // ----------------------------------------------------------------- reopen

  app.post('/submissions/:id/reopen-requests', { preHandler: g.requirePermission('reopen:request') }, async (req, reply) => {
    const auth = req.auth!;
    const sub = await visible(req, reply, (req.params as { id: string }).id);
    if (!sub) return;
    if (!(await g.canAtUnit(auth, 'reopen:request', sub.orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (sub.state !== 'LOCKED') return reply.code(409).send({ error: 'WRONG_STATE', state: sub.state });
    const reason = str(asObject(req.body).reason, 1000);
    if (!reason) return reply.code(400).send(bad('reason is required'));

    const { rows } = await pool.query('INSERT INTO core.reopen_request (submission_id, requested_by, reason) VALUES ($1,$2,$3) RETURNING id', [sub.id, auth.userId, reason]);
    await audit(pool, { actorId: auth.userId, action: 'REOPEN_REQUESTED', entityType: 'monthly_submission', entityId: sub.id, after: { reason }, ip: req.ip });
    return reply.code(201).send({ id: rows[0].id });
  });

  app.get('/reopen-requests', { preHandler: g.requirePermission('submissions:read') }, async (req) => {
    const scope = scopeFor(req.auth!.assignments, 'submissions:read');
    const state = str(asObject(req.query).state, 10) ?? null;
    const { rows } = await pool.query(
      `SELECT rr.id, rr.submission_id AS "submissionId", u.code AS "unitCode", s.period, rr.reason, rr.state, rr.requested_at AS "requestedAt"
       FROM core.reopen_request rr JOIN core.monthly_submission s ON s.id = rr.submission_id JOIN core.org_unit u ON u.id = s.org_unit_id
       WHERE ($1::boolean OR u.path <@ ANY($2::ltree[])) AND ($3::text IS NULL OR rr.state = $3)
       ORDER BY rr.requested_at DESC`,
      [scope.company, scope.paths, state],
    );
    return { requests: rows };
  });

  app.post('/reopen-requests/:id/decision', { preHandler: g.requirePermission('reopen:approve') }, async (req, reply) => {
    const auth = req.auth!;
    const b = asObject(req.body);
    if (typeof b.approve !== 'boolean') return reply.code(400).send(bad('approve (true/false) is required'));
    const rr = (
      await pool.query('SELECT id, submission_id AS "submissionId", requested_by AS "requestedBy", state FROM core.reopen_request WHERE id = $1', [(req.params as { id: string }).id])
    ).rows[0];
    const sub = rr ? await loadSub(rr.submissionId) : undefined;
    if (!rr || !sub || !(await g.canAtUnit(auth, 'submissions:read', sub.orgUnitId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!(await g.canAtUnit(auth, 'reopen:approve', sub.orgUnitId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (rr.state !== 'PENDING') return reply.code(409).send({ error: 'ALREADY_DECIDED' });
    if (rr.requestedBy === auth.userId) return reply.code(409).send({ error: 'SOD: the requester cannot decide their own reopen request' });
    const comment = str(b.comment, 1000);
    if (!b.approve && !comment) return reply.code(400).send(bad('a comment is required to refuse a reopen request'));

    const outcome = await withTransaction(pool, async (tx) => {
      await tx.query("UPDATE core.reopen_request SET state = $2, decided_by = $3, decision_comment = $4, decided_at = now() WHERE id = $1", [
        rr.id,
        b.approve ? 'APPROVED' : 'REJECTED',
        auth.userId,
        comment ?? null,
      ]);
      if (b.approve) {
        const upd = await tx.query("UPDATE core.monthly_submission SET state = 'REOPENED', revision = revision + 1 WHERE id = $1 AND state = 'LOCKED'", [sub.id]);
        if (upd.rowCount === 0) return 'STALE' as const;
        await tx.query('UPDATE core.calc_run SET superseded_at = now() WHERE submission_id = $1 AND superseded_at IS NULL', [sub.id]);
        await tx.query(
          `INSERT INTO core.workflow_event (entity_type, entity_id, revision, from_state, to_state, actor_id, comment)
           VALUES ('SUBMISSION', $1, $2, 'LOCKED', 'REOPENED', $3, $4)`,
          [sub.id, sub.revision + 1, auth.userId, comment ?? null],
        );
      }
      await audit(tx, {
        actorId: auth.userId,
        action: b.approve ? 'REOPEN_APPROVED' : 'REOPEN_REFUSED',
        entityType: 'monthly_submission',
        entityId: sub.id,
        after: { requestId: rr.id, comment },
        ip: req.ip,
      });
      return 'OK' as const;
    });
    if (outcome === 'STALE') return reply.code(409).send({ error: 'STALE_STATE' });
    return { state: b.approve ? 'REOPENED' : 'LOCKED' };
  });
}
