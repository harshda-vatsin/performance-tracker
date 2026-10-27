import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { audit } from '../audit.js';
import { withTransaction } from '../db.js';
import { loadWorkflowSettings, SETTING_KEYS, type WorkflowSettings } from '../workflow.js';
import type { Guards } from './types.js';
import { asObject, bad } from './util.js';

/** Approval-step settings (migration 007). Everyone signed in may read them (the screens adapt); Corporate HR writes. */
export function settingsRoutes(app: FastifyInstance, pool: pg.Pool, g: Guards): void {
  const shape = (s: WorkflowSettings) => ({
    monthly: { hodVerify: s.monthlyHodVerify, plantHeadApprove: s.monthlyPlantHeadApprove },
    senior: { reviewerStep: s.seniorReviewerStep },
  });

  app.get('/settings/workflow', { preHandler: g.requireAuth }, async () => shape(await loadWorkflowSettings(pool)));

  app.put('/settings/workflow', { preHandler: g.requirePermission('settings:write') }, async (req, reply) => {
    const b = asObject(req.body);
    const monthly = asObject(b.monthly);
    const senior = asObject(b.senior);
    const patch: Partial<WorkflowSettings> = {};
    for (const [group, name, key] of [
      [monthly, 'hodVerify', 'monthlyHodVerify'],
      [monthly, 'plantHeadApprove', 'monthlyPlantHeadApprove'],
      [senior, 'reviewerStep', 'seniorReviewerStep'],
    ] as const) {
      if (group[name] === undefined) continue;
      if (typeof group[name] !== 'boolean') return reply.code(400).send(bad(`${name} must be true or false`));
      patch[key] = group[name] as boolean;
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send(bad('nothing to change'));

    const before = await loadWorkflowSettings(pool);
    await withTransaction(pool, async (tx) => {
      for (const [key, enabled] of Object.entries(patch) as [keyof WorkflowSettings, boolean][]) {
        await tx.query('UPDATE core.workflow_setting SET enabled = $2, updated_by = $3, updated_at = now() WHERE key = $1', [SETTING_KEYS[key], enabled, req.auth!.userId]);
      }
      await audit(tx, { actorId: req.auth!.userId, action: 'WORKFLOW_SETTINGS_CHANGED', entityType: 'workflow_setting', before: shape(before), after: shape({ ...before, ...patch }), ip: req.ip });
    });
    return shape(await loadWorkflowSettings(pool));
  });
}
