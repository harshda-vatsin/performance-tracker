/** Maps database errors raised by constraints and guard triggers to client-safe HTTP responses. */
export interface HttpError {
  status: number;
  body: { error: string };
}

const GUARD_PREFIX = /^(SOD|MFA|WEIGHTS|TARGET|LOCKED|WORKFLOW):/;

export function dbErrorResponse(err: unknown): HttpError | null {
  const e = err as { code?: string; message?: string };
  if (e.message && GUARD_PREFIX.test(e.message)) return { status: 409, body: { error: e.message } };
  switch (e.code) {
    case '23505':
      return { status: 409, body: { error: 'DUPLICATE' } };
    case '23P01':
      return { status: 409, body: { error: 'OVERLAP' } };
    case '23503':
      return { status: 400, body: { error: 'BAD_REFERENCE' } };
    case '23514':
    case '23502':
      return { status: 400, body: { error: 'CONSTRAINT_VIOLATION' } };
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return { status: 400, body: { error: 'BAD_REQUEST' } };
    default:
      return null;
  }
}
