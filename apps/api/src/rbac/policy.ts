import type { Db } from '../db.js';

export interface Assignment {
  assignmentId: string;
  roleCode: string;
  scopeType: string;
  /** ltree path of the scope's org unit; null for COMPANY / SELF scopes. */
  scopePath: string | null;
  permissions: string[];
  mfaRequired: boolean;
  payAccess: boolean;
}

/** Active role assignments (valid today) with their permissions. Delegation arrives in a later slice. */
export async function loadAssignments(db: Db, userId: string): Promise<Assignment[]> {
  const { rows } = await db.query(
    `SELECT ra.id AS "assignmentId", r.code AS "roleCode", ra.scope_type AS "scopeType",
            ou.path::text AS "scopePath", r.mfa_required AS "mfaRequired", r.pay_access AS "payAccess",
            COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
     FROM core.role_assignment ra
     JOIN core.role r ON r.id = ra.role_id
     LEFT JOIN core.org_unit ou ON ou.id = ra.scope_id
     LEFT JOIN core.role_permission rp ON rp.role_id = r.id
     LEFT JOIN core.permission p ON p.id = rp.permission_id
     WHERE ra.user_id = $1 AND ra.valid @> current_date
     GROUP BY ra.id, r.code, ra.scope_type, ou.path, r.mfa_required, r.pay_access`,
    [userId],
  );
  return rows;
}

export interface DataScope {
  /** True when any granting assignment is COMPANY-wide. */
  company: boolean;
  /** ltree paths whose subtrees are visible. */
  paths: string[];
}

/** Union of the scopes of every assignment that grants `permission`; empty scope = deny. */
export function scopeFor(assignments: Assignment[], permission: string): DataScope {
  const scope: DataScope = { company: false, paths: [] };
  for (const a of assignments) {
    if (!a.permissions.includes(permission)) continue;
    if (a.scopeType === 'COMPANY') scope.company = true;
    else if (a.scopePath) scope.paths.push(a.scopePath);
  }
  return scope;
}

export const hasAnyScope = (s: DataScope): boolean => s.company || s.paths.length > 0;

/** Does the scope cover a resource anchored at `resourcePath`? Mirrors the `<@` ltree test in SQL. */
export function scopeCovers(scope: DataScope, resourcePath: string): boolean {
  if (scope.company) return true;
  return scope.paths.some((p) => resourcePath === p || resourcePath.startsWith(`${p}.`));
}

export const isPrivileged = (assignments: Assignment[]): boolean => assignments.some((a) => a.mfaRequired);
