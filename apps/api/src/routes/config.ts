import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import type { Guards } from './types.js';
import { asObject, bad, finite, str } from './util.js';

/** Reference data: plant types, people levels, employee categories (doc 04 §3 row 2: Super Admin writes). */
export function configRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  app.get('/config/plant-types', { preHandler: g.requireAuth }, async () => {
    const { rows } = await pool.query('SELECT id, code, name, active FROM core.plant_type ORDER BY code');
    return { plantTypes: rows };
  });

  app.post('/config/plant-types', { preHandler: g.requirePermission('config:write') }, async (req, reply) => {
    const b = asObject(req.body);
    const code = str(b.code, 30)?.toUpperCase();
    const name = str(b.name);
    if (!code || !name || !/^[A-Z0-9_]+$/.test(code)) return reply.code(400).send(bad('code (A-Z, 0-9, _) and name are required'));
    const scoringUnitType = b.scoringUnitType === undefined ? 'DEPARTMENT' : str(b.scoringUnitType, 20);
    if (scoringUnitType !== 'DEPARTMENT' && scoringUnitType !== 'CELL') return reply.code(400).send(bad('scoringUnitType must be DEPARTMENT or CELL'));
    const { rows } = await pool.query('INSERT INTO core.plant_type (code, name, scoring_unit_type) VALUES ($1,$2,$3) RETURNING id', [code, name, scoringUnitType]);
    await audit(pool, { actorId: req.auth!.userId, action: 'PLANT_TYPE_CREATED', entityType: 'plant_type', entityId: rows[0].id, after: { code, name, scoringUnitType }, ip: req.ip });
    return reply.code(201).send({ id: rows[0].id });
  });

  app.get('/config/employee-categories', { preHandler: g.requireAuth }, async () => {
    const { rows } = await pool.query(
      'SELECT id, code, name, bonus_eligible_default AS "bonusEligibleDefault" FROM core.employee_category ORDER BY code',
    );
    return { categories: rows };
  });

  app.get('/config/plant-types/:id/levels', { preHandler: g.requireAuth }, async (req) => {
    const { rows } = await pool.query(
      'SELECT id, code, name_en AS "nameEn", name_ta AS "nameTa", rank FROM core.people_level WHERE plant_type_id = $1 ORDER BY rank',
      [(req.params as { id: string }).id],
    );
    return { levels: rows };
  });

  app.post('/config/plant-types/:id/levels', { preHandler: g.requirePermission('config:write') }, async (req, reply) => {
    const b = asObject(req.body);
    const code = str(b.code, 40)?.toUpperCase();
    const nameEn = str(b.nameEn);
    const rank = finite(b.rank);
    if (!code || !nameEn || rank === null || !Number.isInteger(rank) || !/^[A-Z0-9_]+$/.test(code)) {
      return reply.code(400).send(bad('code, nameEn and integer rank are required'));
    }
    const plantTypeId = (req.params as { id: string }).id;
    const { rows } = await pool.query(
      'INSERT INTO core.people_level (plant_type_id, code, name_en, name_ta, rank) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [plantTypeId, code, nameEn, str(b.nameTa) ?? null, rank],
    );
    await audit(pool, { actorId: req.auth!.userId, action: 'PEOPLE_LEVEL_CREATED', entityType: 'people_level', entityId: rows[0].id, after: { plantTypeId, code, rank }, ip: req.ip });
    return reply.code(201).send({ id: rows[0].id });
  });
}
