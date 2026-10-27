/**
 * Bonus arithmetic (doc 05 §1.10 and §2). Money is only ever an integer count of paise (bigint here, bigint in the
 * database) and percentages an integer count of basis points; there is no floating-point money anywhere. A score is not
 * money, so it may be a plain number.
 */

export interface Band {
  minScore: number;
  percentBp: number;
  label: string;
}

/** The band with the highest `minScore` that the score reaches; null for no score or a score below every band. */
export function bandFor(score: number | null, bands: Band[]): Band | null {
  if (score === null) return null;
  let best: Band | null = null;
  for (const b of bands) if (score >= b.minScore && (best === null || b.minScore > best.minScore)) best = b;
  return best;
}

/**
 * base x percentage x (days present / days in month), rounded half up exactly once, on the integer paise result:
 *   amount = round(base * bp * days / (10000 * daysInMonth))
 * All in bigint, so the result is exact and reproducible.
 */
export function bonusAmount(basePaise: bigint, percentBp: number, days: number, daysInMonth: number): bigint {
  if (basePaise < 0n || !Number.isInteger(percentBp) || percentBp < 0 || !Number.isInteger(days) || days < 0 || !Number.isInteger(daysInMonth) || daysInMonth < 1) {
    throw new RangeError('bonusAmount needs a non-negative base and integer percentage, days and days in month');
  }
  const counted = BigInt(Math.min(days, daysInMonth));
  const numerator = basePaise * BigInt(percentBp) * counted;
  const denominator = 10000n * BigInt(daysInMonth);
  return (2n * numerator + denominator) / (2n * denominator);
}

/** Day-weighted mean of an employee's unit scores in the month; stints without a score do not count. */
export function dayWeightedScore(stints: { score: number | null; days: number }[]): { score: number | null; days: number } {
  const days = stints.reduce((s, x) => s + x.days, 0);
  const scored = stints.filter((x) => x.score !== null && x.days > 0);
  const weight = scored.reduce((s, x) => s + x.days, 0);
  if (weight === 0) return { score: null, days };
  const mean = scored.reduce((s, x) => s + (x.score as number) * x.days, 0) / weight;
  return { score: Math.round(mean * 100) / 100, days };
}

/** "1234.50" for 123450n; works for negatives (adjustments). Integer arithmetic only. */
export function rupees(paise: bigint | number): string {
  const p = typeof paise === 'bigint' ? paise : BigInt(paise);
  const sign = p < 0n ? '-' : '';
  const abs = p < 0n ? -p : p;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** A zero-or-positive integer number of paise from untrusted input, else null. */
export function parsePaise(v: unknown): bigint | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
}
