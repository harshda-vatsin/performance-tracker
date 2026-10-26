export type Json = Record<string, unknown>;

export const asObject = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

/** Trimmed non-empty string within `max` characters, else null. */
export function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t !== '' && t.length <= max ? t : null;
}

export const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A real calendar date in YYYY-MM-DD form, else null. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export const bad = (message: string) => ({ error: 'BAD_REQUEST', message });

/** Unit sanity (doc 05 §1.7 rule 3). Returns a problem or null. */
export function unitProblem(unit: string, value: number): string | null {
  if (unit === '%' && (value < 0 || value > 100)) return 'a percentage must be between 0 and 100';
  if (unit === 'count' && (!Number.isInteger(value) || value < 0)) return 'a count must be a whole number, zero or more';
  return null;
}
