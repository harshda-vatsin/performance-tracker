import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { withTransaction, type Db } from '../db.js';
import { isPrivileged, loadAssignments, type Assignment } from '../rbac/policy.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from './password.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface AuthContext {
  sessionId: string;
  userId: string;
  employeeId: string;
  loginId: string;
  fullName: string;
  assignments: Assignment[];
}

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; user: Pick<AuthContext, 'userId' | 'loginId' | 'fullName'> }
  | { ok: false; reason: 'INVALID' | 'LOCKED' | 'MFA_UNAVAILABLE' };

interface Origin {
  ip?: string | null;
  deviceLabel?: string | null;
}

async function loginEvent(db: Db, userId: string | null, loginId: string, outcome: string, ip?: string | null) {
  await db.query('INSERT INTO core.login_event (user_id, login_id, outcome, method, ip) VALUES ($1,$2,$3,$4,$5)', [
    userId,
    loginId,
    outcome,
    'PASSWORD',
    ip ?? null,
  ]);
}

/** Employee code + password login (doc 03 §3). Failures are indistinguishable to the caller. */
export async function login(pool: pg.Pool, loginId: string, password: string, origin: Origin = {}): Promise<LoginResult> {
  const { rows } = await pool.query(
    `SELECT u.id, u.employee_id, u.status, u.auth_mode, u.locked_until, e.full_name, c.password_hash
     FROM core.user_account u
     JOIN core.employee e ON e.id = u.employee_id
     LEFT JOIN core.credential c ON c.user_id = u.id
     WHERE u.login_id = $1`,
    [loginId],
  );
  const u = rows[0];

  if (!u || !u.password_hash || u.auth_mode !== 'PASSWORD') {
    await verifyPassword(await dummyPasswordHash(), password); // burn time
    await loginEvent(pool, u?.id ?? null, loginId, 'FAIL', origin.ip);
    await audit(pool, { actorId: u?.id ?? null, action: 'LOGIN_FAIL', entityType: 'user_account', entityId: u?.id, ip: origin.ip });
    return { ok: false, reason: 'INVALID' };
  }

  if (u.status === 'DISABLED' || (u.locked_until && new Date(u.locked_until) > new Date())) {
    await loginEvent(pool, u.id, loginId, 'LOCKED', origin.ip);
    await audit(pool, { actorId: u.id, action: 'LOGIN_BLOCKED', entityType: 'user_account', entityId: u.id, ip: origin.ip });
    return { ok: false, reason: 'LOCKED' };
  }

  if (!(await verifyPassword(u.password_hash, password))) {
    const { maxFailures, baseMinutes, maxMinutes } = config.lockout;
    const upd = await pool.query(
      `UPDATE core.user_account SET failed_attempts = failed_attempts + 1 WHERE id = $1
       RETURNING failed_attempts, lock_count`,
      [u.id],
    );
    let lockedNow = false;
    if (upd.rows[0].failed_attempts >= maxFailures) {
      // Escalating lock: 15 min, 30 min, 60 min ... capped.
      const minutes = Math.min(baseMinutes * 2 ** upd.rows[0].lock_count, maxMinutes);
      await pool.query(
        `UPDATE core.user_account
         SET failed_attempts = 0, lock_count = lock_count + 1, locked_until = now() + make_interval(mins => $2)
         WHERE id = $1`,
        [u.id, minutes],
      );
      lockedNow = true;
    }
    await loginEvent(pool, u.id, loginId, lockedNow ? 'LOCKOUT' : 'FAIL', origin.ip);
    await audit(pool, {
      actorId: u.id,
      action: lockedNow ? 'ACCOUNT_LOCKED' : 'LOGIN_FAIL',
      entityType: 'user_account',
      entityId: u.id,
      ip: origin.ip,
    });
    return { ok: false, reason: 'INVALID' };
  }

  const assignments = await loadAssignments(pool, u.id);
  if (isPrivileged(assignments) && !config.mfaBypassUntilMfaSlice) {
    await loginEvent(pool, u.id, loginId, 'MFA_UNAVAILABLE', origin.ip);
    return { ok: false, reason: 'MFA_UNAVAILABLE' };
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.session.absoluteHours * 3600_000);
  await withTransaction(pool, async (tx) => {
    await tx.query('UPDATE core.user_account SET failed_attempts = 0, lock_count = 0, locked_until = NULL WHERE id = $1', [u.id]);
    // Keep at most maxConcurrent sessions: revoke the oldest beyond (max - 1) before adding this one.
    await tx.query(
      `UPDATE core.auth_session SET revoked_at = now()
       WHERE id IN (
         SELECT id FROM core.auth_session
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC OFFSET $2
       )`,
      [u.id, config.session.maxConcurrent - 1],
    );
    await tx.query(
      `INSERT INTO core.auth_session (token_hash, user_id, device_label, ip, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [sha256(token), u.id, origin.deviceLabel ?? null, origin.ip ?? null, expiresAt],
    );
    await loginEvent(tx, u.id, loginId, 'OK', origin.ip);
    await audit(tx, { actorId: u.id, action: 'LOGIN_OK', entityType: 'user_account', entityId: u.id, ip: origin.ip });
  });
  return { ok: true, token, expiresAt, user: { userId: u.id, loginId, fullName: u.full_name } };
}

/** Resolves a session token to an AuthContext, enforcing absolute + idle timeouts and account status. */
export async function authenticate(pool: pg.Pool, token: string): Promise<AuthContext | null> {
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.last_seen, s.expires_at, u.id AS user_id, u.employee_id, u.login_id, u.status, e.full_name
     FROM core.auth_session s
     JOIN core.user_account u ON u.id = s.user_id
     JOIN core.employee e ON e.id = u.employee_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [sha256(token)],
  );
  const s = rows[0];
  if (!s || s.status !== 'ACTIVE' || new Date(s.expires_at) <= new Date()) return null;

  const assignments = await loadAssignments(pool, s.user_id);
  const idleMinutes = isPrivileged(assignments) ? config.session.idleMinutesPrivileged : config.session.idleMinutes;
  if (Date.now() - new Date(s.last_seen).getTime() > idleMinutes * 60_000) {
    await pool.query('UPDATE core.auth_session SET revoked_at = now() WHERE id = $1', [s.session_id]);
    return null;
  }
  await pool.query('UPDATE core.auth_session SET last_seen = now() WHERE id = $1', [s.session_id]);
  return {
    sessionId: s.session_id,
    userId: s.user_id,
    employeeId: s.employee_id,
    loginId: s.login_id,
    fullName: s.full_name,
    assignments,
  };
}

export async function logout(pool: pg.Pool, ctx: AuthContext, ip?: string | null): Promise<void> {
  await pool.query('UPDATE core.auth_session SET revoked_at = now() WHERE id = $1', [ctx.sessionId]);
  await audit(pool, { actorId: ctx.userId, action: 'LOGOUT', entityType: 'auth_session', entityId: ctx.sessionId, ip });
}

/** Creates employee + account + credential in one transaction (used by seeding and tests; admin UI comes later). */
export async function createUserAccount(
  pool: pg.Pool,
  input: { employeeCode: string; fullName: string; password: string; authMode?: 'PASSWORD' | 'OTP_ONLY'; mobile?: string },
): Promise<{ userId: string; employeeId: string }> {
  const passwordHash = await hashPassword(input.password);
  return withTransaction(pool, async (tx) => {
    const emp = await tx.query(
      'INSERT INTO core.employee (employee_code, full_name, mobile) VALUES ($1,$2,$3) RETURNING id',
      [input.employeeCode, input.fullName, input.mobile ?? null],
    );
    const usr = await tx.query(
      'INSERT INTO core.user_account (employee_id, login_id, auth_mode) VALUES ($1,$2,$3) RETURNING id',
      [emp.rows[0].id, input.employeeCode, input.authMode ?? 'PASSWORD'],
    );
    await tx.query('INSERT INTO core.credential (user_id, password_hash) VALUES ($1,$2)', [usr.rows[0].id, passwordHash]);
    await audit(tx, { action: 'USER_CREATED', entityType: 'user_account', entityId: usr.rows[0].id, after: { loginId: input.employeeCode } });
    return { userId: usr.rows[0].id, employeeId: emp.rows[0].id };
  });
}
