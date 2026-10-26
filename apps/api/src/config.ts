/** Auth policy defaults from docs/design/03-authentication.md §2. */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mmf:mmf_dev_only@localhost:5442/mmf',
  isProduction: process.env.NODE_ENV === 'production',
  password: { minLength: 10 },
  lockout: { maxFailures: 5, baseMinutes: 15, maxMinutes: 24 * 60 },
  session: {
    cookieName: 'mmf_session',
    idleMinutes: 20,
    idleMinutesPrivileged: 15,
    absoluteHours: 10,
    maxConcurrent: 3,
  },
  /**
   * MFA is not built yet (next slice). Until then, users holding an mfa_required role can only log
   * in when this is true. It must never be true in production; startup enforces that.
   */
  mfaBypassUntilMfaSlice: process.env.MFA_BYPASS === 'true' || process.env.NODE_ENV !== 'production',
};

if (config.isProduction && process.env.MFA_BYPASS === 'true') {
  throw new Error('MFA_BYPASS must not be enabled in production');
}
