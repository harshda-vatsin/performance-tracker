import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import { PQCDSM } from '../templates/validate.js';
import type { Guards } from './types.js';
import { asObject, bad, str } from './util.js';

const DIRECTIONS = ['HIGHER_BETTER', 'LOWER_BETTER'];

/** KPI library: reusable KRA definitions that templates copy from (doc 04 §3 row 5). */
export function kpiRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  app.get('/kpi-library', { preHandler: g.requirePermission('kpi:read') }, async () => {
    const { rows } = await pool.query(
      `SELECT id, code, name_en AS "nameEn", name_ta AS "nameTa", pqcdsm, direction, unit, description, active
       FROM core.kpi_library ORDER BY pqcdsm, code`,
    );
    return { items: rows };
  });

  app.post('/kpi-library', { preHandler: g.requirePermission('kpi:write') }, async (req, reply) => {
    const b = asObject(req.body);
    const code = str(b.code, 40)?.toUpperCase();
    const nameEn = str(b.nameEn);
    const pqcdsm = str(b.pqcdsm, 1)?.toUpperCase();
    const direction = str(b.direction, 20);
    const unit = str(b.unit, 30);
    if (!code || !nameEn || !pqcdsm || !(PQCDSM as readonly string[]).includes(pqcdsm) || !direction || !DIRECTIONS.includes(direction) || !unit) {
      return reply.code(400).send(bad('code, nameEn, pqcdsm (P,Q,C,D,S,M), direction and unit are required'));
    }
    const { rows } = await pool.query(
      `INSERT INTO core.kpi_library (code, name_en, name_ta, pqcdsm, direction, unit, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [code, nameEn, str(b.nameTa) ?? null, pqcdsm, direction, unit, str(b.description, 1000) ?? null],
    );
    await audit(pool, { actorId: req.auth!.userId, action: 'KPI_CREATED', entityType: 'kpi_library', entityId: rows[0].id, after: { code, nameEn, pqcdsm, direction, unit }, ip: req.ip });
    return reply.code(201).send({ id: rows[0].id });
  });

  app.patch('/kpi-library/:id', { preHandler: g.requirePermission('kpi:write') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = asObject(req.body);
    const before = (await pool.query('SELECT name_en, name_ta, unit, description, active FROM core.kpi_library WHERE id = $1', [id])).rows[0];
    if (!before) return reply.code(404).send({ error: 'NOT_FOUND' });

    const nameEn = 'nameEn' in b ? str(b.nameEn) : before.name_en;
    const unit = 'unit' in b ? str(b.unit, 30) : before.unit;
    const active = 'active' in b ? b.active : before.active;
    if (!nameEn || !unit || typeof active !== 'boolean') return reply.code(400).send(bad('nameEn, unit and active are invalid'));
    const nameTa = 'nameTa' in b ? (str(b.nameTa) ?? null) : before.name_ta;
    const description = 'description' in b ? (str(b.description, 1000) ?? null) : before.description;

    await pool.query(
      'UPDATE core.kpi_library SET name_en = $2, name_ta = $3, unit = $4, description = $5, active = $6 WHERE id = $1',
      [id, nameEn, nameTa, unit, description, active],
    );
    await audit(pool, { actorId: req.auth!.userId, action: 'KPI_UPDATED', entityType: 'kpi_library', entityId: id, before, after: { nameEn, unit, active }, ip: req.ip });
    return { id };
  });
}
