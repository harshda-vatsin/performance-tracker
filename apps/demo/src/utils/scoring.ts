/**
 * Track A scoring — pure functions only (no React, no state, no mock data).
 * All tunables (cap, bands, weightage total) live in config/scoring.config.ts.
 */
import {
  ACHIEVEMENT_CAP_PCT,
  INCREMENT_GUIDELINE,
  RATING_BANDS,
  WEIGHTAGE_TOTAL,
  type RatingBand,
  type RatingKey,
} from '../config/scoring.config';
import type { Direction, GoalItem } from '../types';

export const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Achievement % of one KPI.
 *  - higher-is-better: actual / target
 *  - lower-is-better:  target / actual
 * Result is floored at 0 and capped at `cap` (default from config).
 */
export function achievementPct(
  actual: number,
  target: number,
  direction: Direction,
  cap: number = ACHIEVEMENT_CAP_PCT,
): number {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return 0;
  let raw: number;
  if (direction === 'higher') {
    raw = target <= 0 ? cap : (actual / target) * 100;
  } else if (actual <= 0) {
    raw = cap; // nothing lost / zero incidents — best possible outcome
  } else {
    raw = target <= 0 ? 0 : (target / actual) * 100;
  }
  return Math.min(cap, Math.max(0, raw));
}

export interface ScoredRow {
  item: GoalItem;
  actual: number | undefined;
  achievement: number;
  /** Points this KPI contributes to the total score (sums to the weighted total). */
  points: number;
}

export function sumWeights(items: { weightage: number }[]): number {
  return items.reduce((s, i) => s + i.weightage, 0);
}

/** Weighted total of achievement %, normalised by the sum of weightages. */
export function weightedTotal(rows: { weightage: number; achievement: number }[]): number {
  const w = sumWeights(rows);
  if (w <= 0) return 0;
  return rows.reduce((s, r) => s + r.achievement * r.weightage, 0) / w;
}

export function scoreItems(
  items: GoalItem[],
  actuals: Record<string, { value: number }>,
  cap: number = ACHIEVEMENT_CAP_PCT,
): { rows: ScoredRow[]; total: number } {
  const totalWeight = sumWeights(items);
  const rows: ScoredRow[] = items.map((item) => {
    const actual = actuals[item.kraId]?.value;
    const achievement = actual === undefined ? 0 : achievementPct(actual, item.target, item.direction, cap);
    const points = totalWeight > 0 ? (achievement * item.weightage) / totalWeight : 0;
    return { item, actual, achievement, points };
  });
  return { rows, total: round1(weightedTotal(rows.map((r) => ({ weightage: r.item.weightage, achievement: r.achievement })))) };
}

/** Rating band for a score: the first band (high → low) whose `min` the score meets. */
export function ratingFor(score: number, bands: RatingBand[] = RATING_BANDS): RatingBand {
  return bands.find((b) => score >= b.min) ?? bands[bands.length - 1];
}

export function bandByKey(key: RatingKey, bands: RatingBand[] = RATING_BANDS): RatingBand {
  return bands.find((b) => b.key === key) ?? bands[bands.length - 1];
}

/** Human-readable range for a band, e.g. "95 – 109.9", "≥ 110", "< 60". */
export function bandRangeLabel(band: RatingBand, bands: RatingBand[] = RATING_BANDS): string {
  const idx = bands.indexOf(band);
  const upper = idx > 0 ? bands[idx - 1].min : undefined;
  if (!Number.isFinite(band.min)) return `< ${upper}`;
  if (upper === undefined) return `≥ ${band.min}`;
  return `${band.min} – ${upper - 0.1 > band.min ? Math.round((upper - 0.1) * 10) / 10 : upper}`;
}

export function incrementFor(rating: RatingKey): number {
  return INCREMENT_GUIDELINE[rating];
}

export function weightsValid(items: { weightage: number }[], total: number = WEIGHTAGE_TOTAL): boolean {
  return Math.abs(sumWeights(items) - total) < 0.001;
}

/**
 * Rescale weightages to add up to `total` (whole numbers, largest-remainder method).
 * If `fixedIndex` is given, that weightage is held and only the others are scaled.
 */
export function rebalanceWeights(
  weights: number[],
  fixedIndex: number | null = null,
  total: number = WEIGHTAGE_TOTAL,
): number[] {
  if (weights.length === 0) return [];
  const fixedVal = fixedIndex === null ? 0 : Math.min(Math.max(weights[fixedIndex], 0), total);
  const target = total - fixedVal;
  const idxs = weights.map((_, i) => i).filter((i) => i !== fixedIndex);
  const out = weights.slice();
  if (fixedIndex !== null) out[fixedIndex] = fixedVal;
  if (idxs.length === 0) return out;

  const sum = idxs.reduce((s, i) => s + weights[i], 0);
  const raw = idxs.map((i) => (sum > 0 ? (weights[i] * target) / sum : target / idxs.length));
  const floors = raw.map(Math.floor);
  let remainder = target - floors.reduce((s, n) => s + n, 0);
  const order = raw.map((r, k) => ({ k, frac: r - floors[k] })).sort((a, b) => b.frac - a.frac);
  for (let n = 0; remainder > 0 && n < order.length; n++, remainder--) floors[order[n].k] += 1;
  idxs.forEach((i, k) => (out[i] = floors[k]));
  return out;
}
