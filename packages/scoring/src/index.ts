/**
 * @mmf/scoring — pure, deterministic scoring (doc 05). No I/O, no clock, no randomness.
 * Every tunable lives in ScoringParams so open client decisions (doc 13, Q2–Q4) are configuration.
 */

export type Direction = 'HIGHER_BETTER' | 'LOWER_BETTER';

export type ScoreFlag = 'CAPPED' | 'FLOORED' | 'TARGET_EQ_PL' | 'ZERO_TOLERANCE' | 'NO_WEIGHTS';

export interface ScoringParams {
  /** Score awarded for matching the present level (B). */
  baseScoreB: number;
  cap: number;
  floor: number;
  /** Score for a breach on a zero-tolerance KRA (present level and target both 0). */
  zeroToleranceBreachScore: number;
  /** Decimal places kept at each stage. */
  rounding: { kra: number; level: number; quarter: number; year: number; employee: number };
}

const ROUNDING = { kra: 2, level: 2, quarter: 2, year: 2, employee: 2 };

export const FORGE_PARAMS: ScoringParams = {
  baseScoreB: 60,
  cap: 120,
  floor: 0,
  zeroToleranceBreachScore: 0,
  rounding: ROUNDING,
};

export const MACHINE_PARAMS: ScoringParams = { ...FORGE_PARAMS, baseScoreB: 50 };

export interface KraInput {
  presentLevel: number;
  target: number;
  result: number;
  direction: Direction;
}

export interface KraScore {
  /** Unclamped formula value. */
  raw: number;
  /** Clamped to [floor, cap] and rounded. */
  final: number;
  flags: ScoreFlag[];
}

/** Round half away from zero, avoiding binary-float artefacts such as 1.005 -> 1.00. */
export function roundHalfUp(value: number, digits: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const text = String(abs);
  if (text.includes('e')) {
    const f = 10 ** digits;
    return (sign * Math.round(abs * f)) / f;
  }
  return sign * Number(`${Math.round(Number(`${text}e${digits}`))}e-${digits}`);
}

function assertFinite(name: string, n: number): void {
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`);
}

export function scoreKra(input: KraInput, params: ScoringParams): KraScore {
  const { presentLevel: pl, target, result, direction } = input;
  assertFinite('presentLevel', pl);
  assertFinite('target', target);
  assertFinite('result', result);

  const improvingSide = direction === 'HIGHER_BETTER' ? target >= pl : target <= pl;
  if (!improvingSide) {
    throw new Error(`target ${target} is on the wrong side of present level ${pl} for ${direction}`);
  }

  const flags: ScoreFlag[] = [];
  let raw: number;

  if (pl === 0 && target === 0) {
    // Zero-tolerance KRA (e.g. fatalities): any result worse than zero is a breach.
    flags.push('ZERO_TOLERANCE');
    const meets = direction === 'LOWER_BETTER' ? result <= 0 : result >= 0;
    raw = meets ? 100 : params.zeroToleranceBreachScore;
  } else if (target === pl) {
    flags.push('TARGET_EQ_PL');
    const meets = direction === 'HIGHER_BETTER' ? result >= pl : result <= pl;
    raw = meets ? 100 : params.baseScoreB * (1 - Math.abs(result - pl) / Math.abs(pl));
  } else {
    const b = params.baseScoreB;
    raw = b + (100 - b) * ((result - pl) / (target - pl));
  }

  raw = roundHalfUp(raw, 6);
  let clamped = raw;
  if (raw > params.cap) {
    clamped = params.cap;
    flags.push('CAPPED');
  } else if (raw < params.floor) {
    clamped = params.floor;
    flags.push('FLOORED');
  }
  return { raw, final: roundHalfUp(clamped, params.rounding.kra), flags };
}

export interface LevelKra {
  /** Final KRA score, or null when the row is marked N/A. */
  score: number | null;
  weight: number;
}

export interface LevelScore {
  score: number | null;
  flags: ScoreFlag[];
}

/** Weighted level score; N/A rows drop out and the remaining weights are renormalised. */
export function scoreLevel(kras: LevelKra[], params: ScoringParams): LevelScore {
  let weightSum = 0;
  let weighted = 0;
  for (const k of kras) {
    if (k.score === null) continue;
    weightSum += k.weight;
    weighted += k.score * k.weight;
  }
  if (weightSum <= 0) return { score: null, flags: ['NO_WEIGHTS'] };
  return { score: roundHalfUp(weighted / weightSum, params.rounding.level), flags: [] };
}

function average(values: (number | null)[], digits: number): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return roundHalfUp(present.reduce((s, v) => s + v, 0) / present.length, digits);
}

/** Average of the monthly level scores; months not yet locked are passed as null and skipped. */
export function scoreQuarter(monthly: (number | null)[], params: ScoringParams): number | null {
  return average(monthly, params.rounding.quarter);
}

export function scoreYear(quarters: (number | null)[], params: ScoringParams): number | null {
  return average(quarters, params.rounding.year);
}

export interface UnitStint {
  score: number;
  days: number;
}

/** Employee score for a month, weighted by days spent in each unit. */
export function scoreEmployee(stints: UnitStint[], params: ScoringParams): number | null {
  const days = stints.reduce((s, x) => s + x.days, 0);
  if (days <= 0) return null;
  const total = stints.reduce((s, x) => s + x.score * x.days, 0);
  return roundHalfUp(total / days, params.rounding.employee);
}
