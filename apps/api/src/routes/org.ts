import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import { scopeFor } from '../rbac/policy.js';
import type { Guards } from './types.js';
import { asObject, bad, str } from './util.js';

const UNIT_TYPES = ['COMPANY', 'PLANT', 'DEPARTMENT', 'CELL'];
/** Which parent types each unit type may sit under (doc 02 ERD 1: COMPANY, PLANT, DEPARTMENT, CELL). */
const PARENT_TYPES: Record<string, string[]> = {
  PLANT: ['COMPANY'],
  DEPARTMENT: ['PLANT'],
  CELL: ['DEPARTMENT', 'PLANT'],
};

/** Org tree maintenance. Listing lives in app.ts (GET /org/units). Scope is checked against the parent/target unit. */
export function orgRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  app.post('/org/units', { preHandler: g.requirePermission('org:write') }, async (req, reply) => {
    const auth = req.auth!;
    const b = asObject(req.body);
    const unitType = str(b.unitType, 20);
    const code = str(b.code, 40);
    const name = str(b.name);
    if (!unitType || !UNIT_TYPES.includes(unitType) || !code || !name) {
      return reply.code(400).send(bad('unitType, code and name are required'));
    }

    let parentId: string | null = null;
    let plantTypeId: string | null = null;
    if (unitType === 'COMPANY') {
      if (!scopeFor(auth.assignments, 'org:write').company) return reply.code(403).send({ error: 'FORBIDDEN' });
      if ((await pool.query("SELECT 1 FROM core.org_unit WHERE unit_type = 'COMPANY'")).rowCount) {
        return reply.code(409).send({ error: 'COMPANY_EXISTS' });
      }
    } else {
      parentId = str(b.parentId, 40);
      if (!parentId) return reply.code(400).send(bad('parentId is required'));
      const parent = (await pool.query('SELECT unit_type FROM core.org_unit WHERE id = $1', [parentId])).rows[0];
      if (!parent) return reply.code(400).send(bad('unknown parent unit'));
      if (!PARENT_TYPES[unitType].includes(parent.unit_type)) {
        return reply.code(400).send(bad(`${unitType} cannot be placed under ${parent.unit_type}`));
      }
      if (!(await g.canAtUnit(auth, 'org:write', parentId))) return reply.code(403).send({ error: 'FORBIDDEN' });
      if (unitType === 'PLANT') {
        plantTypeId = str(b.plantTypeId, 40);
        if (!plantTypeId) return reply.code(400).send(bad('plantTypeId is required for a PLANT'));
      }
    }

    const { rows } = await pool.query(
      'INSERT INTO core.org_unit (parent_id, unit_type, plant_type_id, code, name) VALUES ($1,$2,$3,$4,$5) RETURNING id, path::text AS path',
      [parentId, unitType, plantTypeId, code, name],
    );
    await audit(pool, {
      actorId: auth.userId,
      action: 'ORG_UNIT_CREATED',
      entityType: 'org_unit',
      entityId: rows[0].id,
      after: { unitType, code, name, parentId },
      ip: req.ip,
    });
    return reply.code(201).send({ id: rows[0].id, path: rows[0].path });
  });

  app.patch('/org/units/:id', { preHandler: g.requirePermission('org:write') }, async (req, reply) => {
    const auth = req.auth!;
    const id = (req.params as { id: string }).id;
    const b = asObject(req.body);
    if (!(await g.canAtUnit(auth, 'org:write', id))) return reply.code(404).send({ error: 'NOT_FOUND' });

    const before = (await pool.query('SELECT name, active FROM core.org_unit WHERE id = $1', [id])).rows[0];
    if (!before) return reply.code(404).send({ error: 'NOT_FOUND' });

    const name = 'name' in b ? str(b.name) : before.name;
    const active = 'active' in b ? b.active : before.active;
    if (!name || typeof active !== 'boolean') return reply.code(400).send(bad('name must be text and active a boolean'));

    if (!active && before.active) {
      const kids = await pool.query('SELECT 1 FROM core.org_unit WHERE parent_id = $1 AND active LIMIT 1', [id]);
      if (kids.rowCount) return reply.code(409).send({ error: 'HAS_ACTIVE_CHILDREN' });
    }
    await pool.query('UPDATE core.org_unit SET name = $2, active = $3 WHERE id = $1', [id, name, active]);
    await audit(pool, {
      actorId: auth.userId,
      action: 'ORG_UNIT_UPDATED',
      entityType: 'org_unit',
      entityId: id,
      before,
      after: { name, active },
      ip: req.ip,
    });
    return { id, name, active };
  });
}
