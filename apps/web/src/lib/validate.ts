/**
 * Client-side mirrors of the server's validation rules, used only to give instant, specific messages while typing.
 * The API (and the database triggers behind it) remain the authority; a rule that drifts here can only make the
 * form too strict or too lax, never let bad data into the database.
 */
import type { Direction, Issue, Validation } from './types';

export const PQCDSM = ['P', 'Q', 'C', 'D', 'S', 'M'] as const;
export const PQCDSM_LABELS: Record<string, string> = { P: 'Production', Q: 'Quality', C: 'Cost', D: 'Delivery', S: 'Safety', M: 'Morale' };

export interface DraftKra {
  nameEn: string;
  pqcdsm: string;
  direction: Direction;
  presentLevel: number;
  targets: number[];
  weights: Record<string, number>;
}

/** Weights are numeric(5,2): compare in whole hundredths to avoid floating-point drift. */
const hundredths = (n: number) => Math.round(n * 100);

/** Same rules as apps/api/src/templates/validate.ts (doc 05 §1.7). */
export function validateTemplate(levelCodes: string[], kras: DraftKra[]): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (levelCodes.length === 0) errors.push({ code: 'NO_LEVELS', message: 'The plant type has no people levels defined' });
  if (kras.length === 0) errors.push({ code: 'NO_KRAS', message: 'The template has no KRAs' });
  if (errors.length > 0) return { errors, warnings };

  for (const code of levelCodes) {
    const total = kras.reduce((s, k) => s + hundredths(k.weights[code] ?? 0), 0);
    if (total !== 10000) errors.push({ code: 'LEVEL_WEIGHT_TOTAL', message: `Level ${code} weights total ${total / 100} (must be exactly 100)`, level: code });
  }
  for (const k of kras) {
    const improving = k.direction === 'HIGHER_BETTER' ? k.targets.every((t) => t >= k.presentLevel) : k.targets.every((t) => t <= k.presentLevel);
    if (!improving) {
      errors.push({ code: 'TARGET_SIDE', message: `KRA "${k.nameEn}": a target is on the wrong side of present level ${k.presentLevel} for ${k.direction}`, kra: k.nameEn });
    } else if (k.targets.every((t) => t === k.presentLevel)) {
      warnings.push({ code: 'TARGET_EQ_PL', message: `KRA "${k.nameEn}": every target equals the present level`, kra: k.nameEn });
    }
  }
  for (const cat of PQCDSM) {
    if (!kras.some((k) => k.pqcdsm === cat && Object.values(k.weights).some((w) => w > 0))) {
      warnings.push({ code: 'PQCDSM_GAP', message: `No weighted KRA covers category ${cat}` });
    }
  }
  return { errors, warnings };
}

/** Unit sanity for a monthly result (apps/api submissions.ts unitProblem). */
export function resultProblem(unit: string, value: number): string | null {
  if (!Number.isFinite(value)) return 'enter a number';
  if (unit === '%' && (value < 0 || value > 100)) return 'a percentage must be between 0 and 100';
  if (unit === 'count' && (!Number.isInteger(value) || value < 0)) return 'a count must be a whole number, zero or more';
  return null;
}

/** First part of the server's outlier test; the raw-score part comes from the live preview. */
export const farFromPresentLevel = (presentLevel: number, result: number): boolean => presentLevel !== 0 && Math.abs(result) > 3 * Math.abs(presentLevel);

/** A typed field that may be blank while editing: '' -> null, otherwise a finite number or NaN when it is not a number. */
export function parseNum(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}
