/** Thin fetch wrapper over the Fastify API (proxied at /api so the session cookie stays first-party). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, any>,
  ) {
    super(message);
  }
}

let onUnauthenticated: () => void = () => {};
export const setUnauthenticatedHandler = (fn: () => void) => {
  onUnauthenticated = fn;
};

/** Plain-language text for the error codes the API can return (never shows raw codes to users when avoidable). */
export function describeError(status: number, body: Record<string, any>): string {
  const code: string = body.error ?? 'ERROR';
  // Senior-staff errors (SENIOR_WRONG_STATE, SENIOR_INCOMPLETE ...) carry a sentence written for the user.
  if (code.startsWith('SENIOR_') && typeof body.message === 'string') return body.message;
  switch (code) {
    case 'BAD_REQUEST':
      return body.message ?? 'The request was not valid.';
    case 'INVALID_CREDENTIALS':
      return 'Employee code or password is incorrect.';
    case 'ACCOUNT_LOCKED':
      return 'This account is temporarily locked after too many failed attempts. Try again later.';
    case 'MFA_UNAVAILABLE':
      return 'This role needs a second login factor, which is not available yet.';
    case 'UNAUTHENTICATED':
      return 'Your session has ended. Please sign in again.';
    case 'FORBIDDEN':
      return 'You do not have permission to do this for this unit.';
    case 'NOT_FOUND':
      return 'That record was not found, or it is outside your scope.';
    case 'DUPLICATE':
      return 'That already exists.';
    case 'OVERLAP':
      return 'That overlaps an existing record.';
    case 'BAD_REFERENCE':
      return 'A selected item no longer exists.';
    case 'CONSTRAINT_VIOLATION':
      return 'A value is outside what is allowed.';
    case 'NO_SCORECARD':
      return 'This unit has no scorecard for that fiscal year yet. Create the scorecard first.';
    case 'NO_ACTIVE_TEMPLATE':
      return 'There is no active KRA template for this plant type. Activate a template first.';
    case 'NOT_EDITABLE':
      return `This month can no longer be edited (it is ${String(body.state ?? '').toLowerCase()}).`;
    case 'WRONG_STATE':
      return `That step is not available while the month is ${String(body.state ?? '').toLowerCase()}.`;
    case 'STALE_REVISION':
    case 'STALE_STATE':
      return 'Someone else changed this month while you were working. Reload and try again.';
    case 'NOT_DRAFT':
      return 'Only a draft template can be changed or approved.';
    case 'NOT_MAKER':
      return 'Only the author of a draft can edit it.';
    case 'ALREADY_DRAFT':
      return 'A draft of this template already exists.';
    case 'ALREADY_DECIDED':
      return 'This request has already been decided.';
    case 'STALE_BASE':
      return 'The scorecard changed after this proposal was made. Propose it again.';
    case 'NOTHING_TO_DO':
      return 'No units are left to process after the exclusions.';
    case 'COMPANY_EXISTS':
      return 'The company already exists.';
    case 'HAS_ACTIVE_CHILDREN':
      return 'Deactivate the units below this one first.';
    case 'UNKNOWN_ROLE':
      return 'Unknown role.';
    case 'INTERNAL':
      return 'Something went wrong on the server. Please try again.';
    case 'SUBMISSION_INVALID':
      return `The month cannot be submitted yet: ${(body.issues ?? []).map((i: { message: string }) => i.message).join('; ')}`;
    case 'TEMPLATE_INVALID':
      return `The template cannot be activated yet: ${(body.issues ?? []).map((i: { message: string }) => i.message).join('; ')}`;
    case 'UNITS_NOT_READY':
      return `Some units are not ready: ${(body.units ?? []).map((u: { unitCode: string; state: string }) => `${u.unitCode} (${u.state.replace(/_/g, ' ').toLowerCase()})`).join(', ')}.`;
    case 'SUBMISSIONS_EXIST':
      return `Months from the effective month already have data: ${(body.periods ?? []).join(', ')}. Choose a later effective month.`;
    default:
      // Guard-trigger messages ("SOD: the same person cannot ...") are already written for people.
      if (/^(SOD|MFA|WEIGHTS|TARGET|LOCKED|WORKFLOW):/.test(code)) return code.replace(/^[A-Z]+:\s*/, '');
      return status >= 500 ? 'Something went wrong on the server.' : `Request failed (${code}).`;
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    // A 401 on a data call means the session ended; the login endpoint's own 401 is just a wrong password.
    if (res.status === 401 && path !== '/auth/login') onUnauthenticated();
    throw new ApiError(res.status, json.error ?? 'ERROR', describeError(res.status, json), json);
  }
  return json as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T,>(path: string, body: unknown) => api<T>('PUT', path, body);
export const patch = <T,>(path: string, body: unknown) => api<T>('PATCH', path, body);

export const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');
