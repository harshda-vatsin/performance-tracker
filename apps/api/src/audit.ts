import type { Db } from './db.js';

export interface AuditEntry {
  actorId?: string | null;
  onBehalfOf?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Appends to the hash-chained audit log. Hashing and chaining happen in the DB trigger. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO core.audit_log (actor_id, on_behalf_of, action, entity_type, entity_id, before, after, ip, prev_hash, row_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', '')`,
    [
      e.actorId ?? null,
      e.onBehalfOf ?? null,
      e.action,
      e.entityType ?? null,
      e.entityId ?? null,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.ip ?? null,
    ],
  );
}

/** Returns the id of the first row whose hash chain is broken, or null when intact. */
export async function verifyAuditChain(db: Db): Promise<number | null> {
  const { rows } = await db.query<{ broken: string | null }>('SELECT core.audit_log_verify() AS broken');
  return rows[0].broken === null ? null : Number(rows[0].broken);
}
