/**
 * Pure template validation (doc 05 §1.7). The same rules are enforced again by the database
 * activation trigger, so a bug here can never activate an invalid template.
 */
export type Direction = 'HIGHER_BETTER' | 'LOWER_BETTER';

export const PQCDSM = ['P', 'Q', 'C', 'D', 'S', 'M'] as const;

export interface DraftKra {
  nameEn: string;
  pqcdsm: string;
  direction: Direction;
  presentLevel: number;
  /** Quarterly targets Q1..Q4. */
  targets: [number, number, number, number];
  /** Weight per people-level code; a missing level counts as 0. */
  weights: Record<string, number>;
}

export type IssueCode =
  | 'NO_LEVELS'
  | 'NO_KRAS'
  | 'UNKNOWN_LEVEL'
  | 'LEVEL_WEIGHT_TOTAL'
  | 'TARGET_SIDE'
  | 'TARGET_EQ_PL'
  | 'PQCDSM_GAP';

export interface Issue {
  code: IssueCode;
  message: string;
  level?: string;
  kra?: string;
}

export interface Validation {
  errors: Issue[];
  warnings: Issue[];
}

/** Weights are numeric(5,2), so compare in whole hundredths to avoid floating-point drift. */
const hundredths = (n: number) => Math.round(n * 100);

export function validateTemplate(levelCodes: string[], kras: DraftKra[]): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  if (levelCodes.length === 0) errors.push({ code: 'NO_LEVELS', message: 'The plant type has no people levels defined' });
  if (kras.length === 0) errors.push({ code: 'NO_KRAS', message: 'The template has no KRAs' });
  if (errors.length > 0) return { errors, warnings };

  const known = new Set(levelCodes);
  for (const k of kras) {
    for (const code of Object.keys(k.weights)) {
      if (!known.has(code)) {
        errors.push({ code: 'UNKNOWN_LEVEL', message: `KRA "${k.nameEn}" has a weight for unknown level ${code}`, level: code, kra: k.nameEn });
      }
    }
  }

  for (const code of levelCodes) {
    const total = kras.reduce((s, k) => s + hundredths(k.weights[code] ?? 0), 0);
    if (total !== 10000) {
      errors.push({
        code: 'LEVEL_WEIGHT_TOTAL',
        message: `Level ${code} weights total ${total / 100} (must be exactly 100)`,
        level: code,
      });
    }
  }

  for (const k of kras) {
    const improving = k.direction === 'HIGHER_BETTER' ? k.targets.every((t) => t >= k.presentLevel) : k.targets.every((t) => t <= k.presentLevel);
    if (!improving) {
      errors.push({
        code: 'TARGET_SIDE',
        message: `KRA "${k.nameEn}": a target is on the wrong side of present level ${k.presentLevel} for ${k.direction}`,
        kra: k.nameEn,
      });
    } else if (k.targets.every((t) => t === k.presentLevel)) {
      warnings.push({ code: 'TARGET_EQ_PL', message: `KRA "${k.nameEn}": every target equals the present level`, kra: k.nameEn });
    }
  }

  // A PQCDSM category with no weighted KRA is allowed but surfaced (doc 05 §1.4 "GAP_<CAT>").
  for (const cat of PQCDSM) {
    const covered = kras.some((k) => k.pqcdsm === cat && Object.values(k.weights).some((w) => w > 0));
    if (!covered) warnings.push({ code: 'PQCDSM_GAP', message: `No weighted KRA covers category ${cat}` });
  }

  return { errors, warnings };
}
