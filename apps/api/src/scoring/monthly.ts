/**
 * Monthly calculation: turns one unit's results and level assignments into KRA, level and employee scores
 * using @mmf/scoring. Pure: no I/O, so the same function serves previews, official runs and tests.
 */
import { createHash } from 'node:crypto';
import { FORGE_PARAMS, scoreEmployee, scoreKra, scoreLevel, type ScoreFlag, type ScoringParams } from '@mmf/scoring';

export interface ResultRow {
  resultId: string;
  nameEn: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  presentLevel: number;
  target: number;
  result: number | null;
  naReason: string | null;
  /** Weight per people-level code. */
  weights: Record<string, number>;
}

export interface Stint {
  employeeId: string;
  levelCode: string;
  days: number;
}

export interface MonthScores {
  kras: { resultId: string; raw: number | null; final: number | null; flags: (ScoreFlag | 'NA' | 'MISSING')[] }[];
  levels: { levelCode: string; score: number | null; flags: ScoreFlag[] }[];
  employees: { employeeId: string; levelCode: string; days: number; score: number | null }[];
}

export const ENGINE_VERSION = '1.0.0';

/** Plant-type settings override the Forge defaults, so Machine shops get B = 50 without code changes. */
export function resolveParams(plantDefaults: unknown): ScoringParams {
  const overrides = (plantDefaults as { scoring?: Partial<ScoringParams> } | null)?.scoring ?? {};
  return { ...FORGE_PARAMS, ...overrides, rounding: { ...FORGE_PARAMS.rounding, ...(overrides.rounding ?? {}) } };
}

export function computeMonth(rows: ResultRow[], levelCodes: string[], stints: Stint[], params: ScoringParams): MonthScores {
  const kras: MonthScores['kras'] = rows.map((r) => {
    if (r.naReason) return { resultId: r.resultId, raw: null, final: null, flags: ['NA'] };
    if (r.result === null) return { resultId: r.resultId, raw: null, final: null, flags: ['MISSING'] };
    const s = scoreKra({ presentLevel: r.presentLevel, target: r.target, result: r.result, direction: r.direction }, params);
    return { resultId: r.resultId, raw: s.raw, final: s.final, flags: s.flags };
  });

  const levels = levelCodes.map((code) => {
    const l = scoreLevel(
      rows.map((r, i) => ({ score: kras[i].final, weight: r.weights[code] ?? 0 })),
      params,
    );
    return { levelCode: code, score: l.score, flags: l.flags };
  });
  const levelScore = new Map(levels.map((l) => [l.levelCode, l.score]));

  const employees = stints.map((s) => ({ employeeId: s.employeeId, levelCode: s.levelCode, days: s.days, score: levelScore.get(s.levelCode) ?? null }));
  return { kras, levels, employees };
}

/** Month score for one employee across several units' stints; stints without a score are skipped. */
export const combineStints = (stints: { score: number | null; days: number }[], params: ScoringParams): number | null =>
  scoreEmployee(
    stints.filter((s): s is { score: number; days: number } => s.score !== null),
    params,
  );

/** Deterministic JSON (sorted keys) so equal inputs always hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const hashInputs = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
