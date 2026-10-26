/** Module A: senior-staff KRA cycles (doc 07 "Module A"). Thin HTTP layer over src/senior/service.ts. */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  confirmMonth,
  createCycle,
  getConfig,
  getDetail,
  isListView,
  listCycles,
  listPeople,
  parseGoals,
  parseResults,
  replaceGoals,
  saveAssessment,
  saveResults,
  transition,
} from '../senior/service.js';
import type { Guards } from './types.js';
import { asObject, bad } from './util.js';

type Params = { id: string; period?: string };

export function seniorRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  const auth = { preHandler: g.requireAuth };

  app.get('/senior/config', auth, async () => getConfig(pool));

  app.get('/senior/people', { preHandler: g.requirePermission('senior:hr') }, async () => listPeople(pool));

  app.get('/senior/cycles', auth, async (req, reply) => {
    const q = asObject(req.query);
    if (!isListView(q.view)) return reply.code(400).send(bad('view must be one of mine, team, review, all'));
    const fy = q.fy === undefined ? null : Number(q.fy);
    if (fy !== null && !Number.isInteger(fy)) return reply.code(400).send(bad('fy must be a start year such as 2026'));
    return listCycles(pool, { auth: req.auth!, ip: req.ip }, q.view, { fiscalYear: fy, state: typeof q.state === 'string' ? q.state : null });
  });

  app.post('/senior/cycles', { preHandler: g.requirePermission('senior:hr') }, async (req, reply) => {
    const b = asObject(req.body);
    const id = await createCycle(
      pool,
      { auth: req.auth!, ip: req.ip },
      {
        employeeId: b.employeeId as string,
        fiscalYear: b.fiscalYear as number,
        managerUserId: b.managerUserId as string,
        reviewerUserId: b.reviewerUserId as string,
      },
    );
    return reply.code(201).send({ id });
  });

  app.get('/senior/cycles/:id', auth, async (req) => getDetail(pool, { auth: req.auth!, ip: req.ip }, (req.params as Params).id));

  app.put('/senior/cycles/:id/goals', auth, async (req) =>
    replaceGoals(pool, { auth: req.auth!, ip: req.ip }, (req.params as Params).id, parseGoals(req.body)),
  );

  app.post('/senior/cycles/:id/transitions', auth, async (req, reply) => {
    const b = asObject(req.body);
    if (typeof b.action !== 'string') return reply.code(400).send(bad('action is required'));
    return transition(pool, { auth: req.auth!, ip: req.ip }, (req.params as Params).id, b.action, b.comment);
  });

  app.put('/senior/cycles/:id/results/:period', auth, async (req) => {
    const p = req.params as Params;
    return saveResults(pool, { auth: req.auth!, ip: req.ip }, p.id, p.period!, parseResults(req.body));
  });

  app.post('/senior/cycles/:id/months/:period/confirm', auth, async (req) => {
    const p = req.params as Params;
    return confirmMonth(pool, { auth: req.auth!, ip: req.ip }, p.id, p.period!);
  });

  app.put('/senior/cycles/:id/assessment', auth, async (req) =>
    saveAssessment(pool, { auth: req.auth!, ip: req.ip }, (req.params as Params).id, asObject(req.body)),
  );
}
