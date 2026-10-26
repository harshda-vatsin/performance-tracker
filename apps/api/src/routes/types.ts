import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext } from '../auth/service.js';

export type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export interface Guards {
  requireAuth: Guard;
  requirePermission: (permission: string) => Guard;
  /** True when the caller's scope for `permission` covers the org unit (checked against its ltree path). */
  canAtUnit: (auth: AuthContext, permission: string, orgUnitId: string) => Promise<boolean>;
}
