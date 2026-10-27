import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import { bandFor, bonusAmount, dayWeightedScore, parsePaise, rupees, type Band } from '../bonus/calc.js';
import { buildCsv, buildXlsx, type Cell } from '../bonus/xlsx.js';
import { withTransaction, type Db } from '../db.js';
import { daysInMonth, isPeriod } from '../fiscal.js';
import type { Guards } from './types.js';
import { asObject, bad, str } from './util.js';

/**
 * Monthly bonus (migration 008, doc 05 §2). Corporate HR calculates a plant-month batch from locked scores; a DIFFERENT
 * Corporate HR user approves it, which locks it; later corrections are a separate adjustment batch with the same approval.
 * All money is integer paise. Only Corporate HR, Management (totals only) and the Employee (own statement) can see any of
 * it: Admin holds no bonus permission, and the audit entries written here carry counts, never amounts.
 */
export function bonusRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  const loadBands = async (db: Db): Promise<Band[]> =>
    (await db.query('SELECT min_score::float8 AS "minScore", percent_bp AS "percentBp", label FROM pay.bonus_band ORDER BY min_score')).rows;

  const rulesOf = (bands: Band[]) => ({ bands });

  // ------------------------------------------------------------------ rules

  app.get('/bonus/rules', { preHandler: g.requirePermission('bonus:read') }, async () => ({ bands: await loadBands(pool) }));

  app.put('/bonus/rules', { preHandler: g.requirePermission('bonus:calculate') }, async (req, reply) => {
    const raw = asObject(req.body).bands;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return reply.code(400).send(bad('bands must be a list of 1 to 20 bands'));
    const bands: Band[] = [];
    for (const [i, b] of raw.entries()) {
      const it = asObject(b);
      const label = str(it.label, 80);
      if (typeof it.minScore !== 'number' || !Number.isFinite(it.minScore) || it.minScore < 0) return reply.code(400).send(bad(`bands[${i}]: minScore must be a number, zero or more`));
      if (typeof it.percentBp !== 'number' || !Number.isInteger(it.percentBp) || it.percentBp < 0 || it.percentBp > 100000) {
        return reply.code(400).send(bad(`bands[${i}]: percentBp must be a whole number of basis points, 0 to 100000 (7000 = 70%)`));
      }
      if (!label) return reply.code(400).send(bad(`bands[${i}]: label is required`));
      bands.push({ minScore: it.minScore, percentBp: it.percentBp, label });
    }
    bands.sort((a, b) => a.minScore - b.minScore);
    if (bands[0].minScore !== 0) return reply.code(400).send(bad('the lowest band must start at score 0 so every score has a band'));
    if (bands.some((b, i) => i > 0 && b.minScore === bands[i - 1].minScore)) return reply.code(400).send(bad('two bands start at the same score'));

    await withTransaction(pool, async (tx) => {
      await tx.query('DELETE FROM pay.bonus_band');
      for (const b of bands) await tx.query('INSERT INTO pay.bonus_band (min_score, percent_bp, label) VALUES ($1,$2,$3)', [b.minScore, b.percentBp, b.label]);
      await audit(tx, { actorId: req.auth!.userId, action: 'BONUS_RULES_CHANGED', entityType: 'bonus_rules', after: { bands }, ip: req.ip });
    });
    return { bands };
  });

  // ------------------------------------------------------------------ bases

  app.get('/bonus/bases', { preHandler: g.requirePermission('bonus:calculate') }, async () => {
    const { rows } = await pool.query(
      `SELECT e.employee_code AS "employeeCode", e.full_name AS "fullName", b.base_paise::text AS "basePaise"
       FROM pay.employee_base b JOIN core.employee e ON e.id = b.employee_id ORDER BY e.employee_code`,
    );
    return { bases: rows.map((r) => ({ ...r, basePaise: Number(r.basePaise) })) };
  });

  app.put('/bonus/bases', { preHandler: g.requirePermission('bonus:calculate') }, async (req, reply) => {
    const raw = asObject(req.body).bases;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 5000) return reply.code(400).send(bad('bases must be a list of 1 to 5000 rows'));
    const parsed: { code: string; paise: bigint }[] = [];
    for (const [i, r] of raw.entries()) {
      const it = asObject(r);
      const code = str(it.employeeCode, 40);
      const paise = parsePaise(it.basePaise);
      if (!code || paise === null) return reply.code(400).send(bad(`bases[${i}]: employeeCode and basePaise (a whole number of paise, zero or more) are required`));
      parsed.push({ code, paise });
    }
    const known = new Map(
      (await pool.query('SELECT id, employee_code AS code FROM core.employee WHERE employee_code = ANY($1)', [parsed.map((p) => p.code)])).rows.map((r) => [r.code as string, r.id as string]),
    );
    const unknown = parsed.filter((p) => !known.has(p.code)).map((p) => p.code);
    if (unknown.length > 0) return reply.code(400).send(bad(`unknown employee codes: ${unknown.slice(0, 10).join(', ')}`));

    await withTransaction(pool, async (tx) => {
      for (const p of parsed) {
        await tx.query(
          `INSERT INTO pay.employee_base (employee_id, base_paise, updated_by) VALUES ($1,$2,$3)
           ON CONFLICT (employee_id) DO UPDATE SET base_paise = $2, updated_by = $3, updated_at = now()`,
          [known.get(p.code), p.paise.toString(), req.auth!.userId],
        );
      }
      await audit(tx, { actorId: req.auth!.userId, action: 'BONUS_BASES_SAVED', entityType: 'pay.employee_base', after: { rows: parsed.length }, ip: req.ip });
    });
    return { saved: parsed.length };
  });

  // -------------------------------------------------------------- calculate

  interface Candidate {
    id: string;
    code: string;
    name: string;
    path: string;
    units: number;
    locked: number;
  }

  async function plantsFor(period: string, plantId: string | null): Promise<Candidate[]> {
    return (
      await pool.query(
        `SELECT p.id, p.code, p.name, p.path::text AS path,
                (SELECT count(*) FROM core.org_unit u WHERE u.unit_type = pt.scoring_unit_type AND u.active AND u.path <@ p.path)::int AS units,
                (SELECT count(*) FROM core.org_unit u JOIN core.monthly_submission s ON s.org_unit_id = u.id AND s.period = $1 AND s.state = 'LOCKED'
                  WHERE u.unit_type = pt.scoring_unit_type AND u.active AND u.path <@ p.path)::int AS locked
         FROM core.org_unit p JOIN core.plant_type pt ON pt.id = p.plant_type_id
         WHERE p.unit_type = 'PLANT' AND p.active AND ($2::uuid IS NULL OR p.id = $2) ORDER BY p.code`,
        [period, plantId],
      )
    ).rows;
  }

  /** One line per employee scored in the plant-month: day-weighted score -> band -> percentage of base, pro-rated by days. */
  async function buildLines(db: Db, plant: Candidate, period: string, bands: Band[]) {
    const first = `${period}-01`;
    const rows = (
      await db.query(
        `SELECT e.id AS "employeeId", es.score::float8 AS score, es.days_in_unit AS days, COALESCE(cat.eligible, false) AS eligible
         FROM core.monthly_submission ms
         JOIN core.org_unit u ON u.id = ms.org_unit_id AND u.path <@ $2::ltree
         JOIN core.calc_run cr ON cr.submission_id = ms.id AND cr.superseded_at IS NULL
         JOIN core.employee_score es ON es.calc_run_id = cr.id
         JOIN core.employee e ON e.id = es.employee_id
         LEFT JOIN LATERAL (
           SELECT c.bonus_eligible_default AS eligible
           FROM core.employee_assignment ea JOIN core.employee_category c ON c.id = ea.category_id
           WHERE ea.employee_id = e.id AND ea.valid && daterange($1::date, ($1::date + interval '1 month')::date, '[)')
           ORDER BY lower(ea.valid) DESC LIMIT 1
         ) cat ON true
         WHERE ms.period = $3 AND ms.state = 'LOCKED'`,
        [first, plant.path, period],
      )
    ).rows as { employeeId: string; score: number | null; days: number; eligible: boolean }[];

    const byEmployee = new Map<string, typeof rows>();
    for (const r of rows) byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r]);
    const bases = new Map(
      (await db.query('SELECT employee_id AS id, base_paise::text AS base FROM pay.employee_base WHERE employee_id = ANY($1)', [[...byEmployee.keys()]])).rows.map((r) => [r.id as string, BigInt(r.base)]),
    );
    const dim = daysInMonth(period);

    return [...byEmployee].map(([employeeId, stints]) => {
      const { score, days } = dayWeightedScore(stints);
      const base = bases.get(employeeId) ?? 0n;
      let percentBp = 0;
      let amount = 0n;
      let note: string | null = null;
      if (!stints.every((s) => s.eligible)) note = 'NOT_ELIGIBLE';
      else if (!bases.has(employeeId)) note = 'NO_BASE';
      else if (score === null) note = 'NO_SCORE';
      else {
        percentBp = bandFor(score, bands)?.percentBp ?? 0;
        amount = bonusAmount(base, percentBp, days, dim);
      }
      return { employeeId, score, days, base, percentBp, amount, note };
    });
  }

  app.post('/bonus/calculate', { preHandler: g.requirePermission('bonus:calculate') }, async (req, reply) => {
    const b = asObject(req.body);
    if (!isPeriod(b.period)) return reply.code(400).send(bad('period (YYYY-MM) is required'));
    const period = b.period;
    const plantId = b.plantId === undefined ? null : str(b.plantId, 40);
    if (b.plantId !== undefined && !plantId) return reply.code(400).send(bad('plantId must be an id'));

    const bands = await loadBands(pool);
    const batches: { id: string; plantCode: string; lines: number; totalPaise: number }[] = [];
    const skipped: { plantCode: string; reason: string }[] = [];

    await withTransaction(pool, async (tx) => {
      for (const plant of await plantsFor(period, plantId)) {
        if (plant.units === 0) {
          skipped.push({ plantCode: plant.code, reason: 'NO_SCORING_UNITS' });
          continue;
        }
        if (plant.locked < plant.units) {
          skipped.push({ plantCode: plant.code, reason: 'MONTH_NOT_LOCKED' });
          continue;
        }
        const live = (await tx.query("SELECT id, state FROM pay.bonus_batch WHERE period = $1 AND plant_id = $2 AND kind = 'REGULAR' AND state IN ('CALCULATED','LOCKED')", [period, plant.id])).rows[0];
        if (live?.state === 'LOCKED') {
          skipped.push({ plantCode: plant.code, reason: 'ALREADY_LOCKED' });
          continue;
        }
        if (live) await tx.query("UPDATE pay.bonus_batch SET state = 'SUPERSEDED' WHERE id = $1", [live.id]);

        const lines = await buildLines(tx, plant, period, bands);
        const batch = await tx.query(
          "INSERT INTO pay.bonus_batch (period, plant_id, kind, rules, calculated_by) VALUES ($1,$2,'REGULAR',$3,$4) RETURNING id",
          [period, plant.id, JSON.stringify(rulesOf(bands)), req.auth!.userId],
        );
        let total = 0n;
        for (const l of lines) {
          await tx.query(
            'INSERT INTO pay.bonus_line (batch_id, employee_id, score, days, base_paise, percent_bp, amount_paise, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [batch.rows[0].id, l.employeeId, l.score, l.days, l.base.toString(), l.percentBp, l.amount.toString(), l.note],
          );
          total += l.amount;
        }
        await audit(tx, { actorId: req.auth!.userId, action: 'BONUS_CALCULATED', entityType: 'pay.bonus_batch', entityId: batch.rows[0].id, after: { period, plant: plant.code, lines: lines.length }, ip: req.ip });
        batches.push({ id: batch.rows[0].id, plantCode: plant.code, lines: lines.length, totalPaise: Number(total) });
      }
    });
    if (batches.length === 0 && skipped.length === 0) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { period, batches, skipped };
  });

  // ---------------------------------------------------------------- batches

  interface BatchRow {
    id: string;
    period: string;
    plantId: string;
    plantCode: string;
    plantName: string;
    kind: 'REGULAR' | 'ADJUSTMENT';
    state: 'CALCULATED' | 'LOCKED' | 'REJECTED' | 'SUPERSEDED';
    parentBatchId: string | null;
    reason: string | null;
    calculatedById: string;
    calculatedBy: string;
    calculatedAt: string;
    decidedBy: string | null;
    decidedAt: string | null;
    comment: string | null;
    lines: number;
    total: string;
  }

  const BATCH_SQL = `
    SELECT b.id, b.period, b.plant_id AS "plantId", p.code AS "plantCode", p.name AS "plantName", b.kind, b.state,
           b.parent_batch_id AS "parentBatchId", b.reason, b.calculated_by AS "calculatedById", ce.full_name AS "calculatedBy",
           b.calculated_at AS "calculatedAt", de.full_name AS "decidedBy", b.decided_at AS "decidedAt", b.decision_comment AS comment,
           (SELECT count(*) FROM pay.bonus_line l WHERE l.batch_id = b.id)::int AS lines,
           (SELECT COALESCE(sum(l.amount_paise), 0) FROM pay.bonus_line l WHERE l.batch_id = b.id)::text AS total
    FROM pay.bonus_batch b
    JOIN core.org_unit p ON p.id = b.plant_id
    JOIN core.user_account cu ON cu.id = b.calculated_by JOIN core.employee ce ON ce.id = cu.employee_id
    LEFT JOIN core.user_account du ON du.id = b.decided_by LEFT JOIN core.employee de ON de.id = du.employee_id`;

  const shapeBatch = ({ total, ...b }: BatchRow) => ({ ...b, totalPaise: Number(total) });

  app.get('/bonus/batches', { preHandler: g.requirePermission('bonus:read') }, async (req, reply) => {
    const q = asObject(req.query);
    const period = q.period === undefined ? null : q.period;
    if (period !== null && !isPeriod(period)) return reply.code(400).send(bad('period must be YYYY-MM'));
    const { rows } = await pool.query(
      `${BATCH_SQL} WHERE ($1::text IS NULL OR b.period = $1) AND b.state <> 'SUPERSEDED' ORDER BY b.period DESC, p.code, b.kind, b.calculated_at`,
      [period],
    );
    return { batches: (rows as BatchRow[]).map(shapeBatch) };
  });

  app.get('/bonus/batches/:id', { preHandler: g.requirePermission('bonus:lines') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const batch = (await pool.query(`${BATCH_SQL} WHERE b.id = $1`, [id])).rows[0] as BatchRow | undefined;
    if (!batch) return reply.code(404).send({ error: 'NOT_FOUND' });
    const bands: Band[] = (await pool.query('SELECT rules FROM pay.bonus_batch WHERE id = $1', [id])).rows[0].rules.bands;
    const lines = (
      await pool.query(
        `SELECT e.employee_code AS "employeeCode", e.full_name AS "fullName", l.score::float8 AS score, l.days,
                l.base_paise::text AS base, l.percent_bp AS "percentBp", l.amount_paise::text AS amount, l.note
         FROM pay.bonus_line l JOIN core.employee e ON e.id = l.employee_id WHERE l.batch_id = $1 ORDER BY e.employee_code`,
        [id],
      )
    ).rows;
    return {
      batch: shapeBatch(batch),
      lines: lines.map(({ base, amount, ...l }) => ({ ...l, band: bandFor(l.score, bands)?.label ?? null, basePaise: Number(base), amountPaise: Number(amount) })),
    };
  });

  /** Approve (which locks) or reject a batch. The maker can never be the checker: refused here and by a CHECK in the table. */
  async function decide(req: Parameters<Guards['requireAuth']>[0], reply: Parameters<Guards['requireAuth']>[1], approve: boolean) {
    const id = (req.params as { id: string }).id;
    const comment = str(asObject(req.body).comment, 1000);
    if (!approve && !comment) return reply.code(400).send(bad('a comment is required to reject a batch'));
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'NOT_FOUND' });

    const outcome = await withTransaction(pool, async (tx) => {
      const b = (await tx.query('SELECT period, state, calculated_by AS "by", (SELECT code FROM core.org_unit WHERE id = plant_id) AS plant FROM pay.bonus_batch WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!b) return { status: 404, body: { error: 'NOT_FOUND' } };
      if (b.state !== 'CALCULATED') return { status: 409, body: { error: 'WRONG_STATE', state: b.state } };
      if (b.by === req.auth!.userId) return { status: 409, body: { error: 'SOD: a different Corporate HR user must decide a batch you calculated' } };
      await tx.query('UPDATE pay.bonus_batch SET state = $2, decided_by = $3, decided_at = now(), decision_comment = $4 WHERE id = $1', [id, approve ? 'LOCKED' : 'REJECTED', req.auth!.userId, comment ?? null]);
      await audit(tx, { actorId: req.auth!.userId, action: approve ? 'BONUS_BATCH_APPROVED' : 'BONUS_BATCH_REJECTED', entityType: 'pay.bonus_batch', entityId: id, after: { period: b.period, plant: b.plant }, ip: req.ip });
      return { status: 200, body: { state: approve ? 'LOCKED' : 'REJECTED' } };
    });
    return reply.code(outcome.status).send(outcome.body);
  }
  app.post('/bonus/batches/:id/approve', { preHandler: g.requirePermission('bonus:approve') }, (req, reply) => decide(req, reply, true));
  app.post('/bonus/batches/:id/reject', { preHandler: g.requirePermission('bonus:approve') }, (req, reply) => decide(req, reply, false));

  // ------------------------------------------------------------ adjustments

  app.post('/bonus/batches/:id/adjustments', { preHandler: g.requirePermission('bonus:calculate') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = asObject(req.body);
    const reason = str(b.reason, 1000);
    const raw = b.lines;
    if (!reason) return reply.code(400).send(bad('reason is required'));
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 1000) return reply.code(400).send(bad('lines must be a list of 1 to 1000 adjustments'));
    const parsed: { code: string; delta: bigint; note: string | null }[] = [];
    for (const [i, r] of raw.entries()) {
      const it = asObject(r);
      const code = str(it.employeeCode, 40);
      if (!code || typeof it.deltaPaise !== 'number' || !Number.isSafeInteger(it.deltaPaise) || it.deltaPaise === 0) {
        return reply.code(400).send(bad(`lines[${i}]: employeeCode and a non-zero whole number of paise (deltaPaise, may be negative) are required`));
      }
      parsed.push({ code, delta: BigInt(it.deltaPaise), note: str(it.note, 500) });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'NOT_FOUND' });

    const outcome = await withTransaction(pool, async (tx) => {
      const parent = (await tx.query('SELECT period, plant_id AS "plantId", kind, state, rules FROM pay.bonus_batch WHERE id = $1', [id])).rows[0];
      if (!parent) return { status: 404, body: { error: 'NOT_FOUND' } };
      if (parent.kind !== 'REGULAR' || parent.state !== 'LOCKED') return { status: 409, body: { error: 'WRONG_STATE', message: 'only a locked regular batch can be adjusted' } };
      const paid = new Map(
        (await tx.query('SELECT e.employee_code AS code, e.id FROM pay.bonus_line l JOIN core.employee e ON e.id = l.employee_id WHERE l.batch_id = $1', [id])).rows.map((r) => [r.code as string, r.id as string]),
      );
      const outside = parsed.filter((p) => !paid.has(p.code)).map((p) => p.code);
      if (outside.length > 0) return { status: 400, body: bad(`not in the batch being adjusted: ${outside.slice(0, 10).join(', ')}`) };
      if (new Set(parsed.map((p) => p.code)).size !== parsed.length) return { status: 400, body: bad('an employee is listed twice') };

      const batch = await tx.query(
        "INSERT INTO pay.bonus_batch (period, plant_id, kind, parent_batch_id, rules, reason, calculated_by) VALUES ($1,$2,'ADJUSTMENT',$3,$4,$5,$6) RETURNING id",
        [parent.period, parent.plantId, id, JSON.stringify(parent.rules), reason, req.auth!.userId],
      );
      for (const p of parsed) {
        await tx.query('INSERT INTO pay.bonus_line (batch_id, employee_id, amount_paise, note) VALUES ($1,$2,$3,$4)', [batch.rows[0].id, paid.get(p.code), p.delta.toString(), p.note]);
      }
      await audit(tx, { actorId: req.auth!.userId, action: 'BONUS_ADJUSTMENT_CREATED', entityType: 'pay.bonus_batch', entityId: batch.rows[0].id, after: { parent: id, period: parent.period, lines: parsed.length }, ip: req.ip });
      return { status: 201, body: { id: batch.rows[0].id } };
    });
    return reply.code(outcome.status).send(outcome.body);
  });

  // ----------------------------------------------------------------- export

  /** Payroll file for one month: every locked batch (regular and adjustment), one row per employee line. */
  app.get('/bonus/export', { preHandler: g.requirePermission('bonus:export') }, async (req, reply) => {
    const q = asObject(req.query);
    if (!isPeriod(q.period)) return reply.code(400).send(bad('period (YYYY-MM) is required'));
    const format = q.format === 'xlsx' ? 'xlsx' : q.format === undefined || q.format === 'csv' ? 'csv' : null;
    if (!format) return reply.code(400).send(bad('format must be csv or xlsx'));

    const { rows } = await pool.query(
      `SELECT e.employee_code AS code, e.full_name AS name, b.period, p.code AS plant, b.kind, b.reason, l.score::float8 AS score, l.days,
              l.base_paise::text AS base, l.percent_bp AS bp, l.amount_paise::text AS amount, l.note
       FROM pay.bonus_line l
       JOIN pay.bonus_batch b ON b.id = l.batch_id AND b.state = 'LOCKED'
       JOIN core.org_unit p ON p.id = b.plant_id JOIN core.employee e ON e.id = l.employee_id
       WHERE b.period = $1 ORDER BY p.code, b.kind, e.employee_code`,
      [q.period],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'NOTHING_TO_EXPORT', message: 'no locked bonus batch exists for this month' });

    const header: Cell[] = ['Employee code', 'Employee name', 'Period', 'Plant', 'Batch type', 'Score', 'Days', 'Base (paise)', 'Percent of base', 'Amount (paise)', 'Amount (rupees)', 'Note'];
    const body: Cell[][] = rows.map((r) => [
      r.code, r.name, r.period, r.plant, r.kind === 'REGULAR' ? 'Bonus' : 'Adjustment', r.score === null ? null : String(r.score), r.days, BigInt(r.base), rupees(r.bp), BigInt(r.amount), rupees(BigInt(r.amount)), r.note ?? r.reason ?? null,
    ]);
    const file = format === 'xlsx' ? buildXlsx(`Bonus ${q.period}`, [header, ...body]) : Buffer.from(buildCsv([header, ...body]), 'utf8');
    await audit(pool, { actorId: req.auth!.userId, action: 'BONUS_EXPORTED', entityType: 'pay.bonus_batch', after: { period: q.period, format, rows: rows.length, sha256: createHash('sha256').update(file).digest('hex') }, ip: req.ip });
    return reply
      .header('content-type', format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="bonus-${q.period}.${format}"`)
      .send(file);
  });

  // -------------------------------------------------------------- statement

  /** An Employee's own bonus statement: locked batches only, by month, with adjustments shown as their own lines. */
  app.get('/me/bonus', { preHandler: g.requireSelf('bonus:own') }, async (req) => {
    const { rows } = await pool.query(
      `SELECT b.period, b.kind, b.reason, p.name AS "plantName", l.score::float8 AS score, l.days, l.base_paise::text AS base,
              l.percent_bp AS bp, l.amount_paise::text AS amount, l.note, b.rules
       FROM core.user_account u
       JOIN pay.bonus_line l ON l.employee_id = u.employee_id
       JOIN pay.bonus_batch b ON b.id = l.batch_id AND b.state = 'LOCKED'
       JOIN core.org_unit p ON p.id = b.plant_id
       WHERE u.id = $1 ORDER BY b.period DESC, b.kind, b.calculated_at`,
      [req.auth!.userId],
    );
    const months = new Map<string, { period: string; totalPaise: bigint; lines: unknown[] }>();
    let total = 0n;
    for (const r of rows) {
      const m = months.get(r.period) ?? { period: r.period as string, totalPaise: 0n, lines: [] };
      const amount = BigInt(r.amount);
      m.totalPaise += amount;
      total += amount;
      m.lines.push({
        kind: r.kind,
        plantName: r.plantName,
        score: r.score,
        days: r.days,
        band: r.kind === 'REGULAR' ? (bandFor(r.score, r.rules.bands)?.label ?? null) : null,
        basePaise: Number(r.base),
        percentBp: r.bp,
        amountPaise: Number(amount),
        note: r.note ?? r.reason ?? null,
        reason: r.reason,
      });
      months.set(r.period, m);
    }
    return { totalPaise: Number(total), months: [...months.values()].map((m) => ({ ...m, totalPaise: Number(m.totalPaise) })) };
  });
}
