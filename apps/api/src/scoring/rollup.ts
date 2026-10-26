/**
 * Quarter and year roll-ups (doc 05 §1.5) over locked monthly level scores. Pure: dashboards compute these at read
 * time from official runs, so a reopened month is reflected immediately and nothing can drift out of sync.
 */
import { scoreQuarter, scoreYear, type ScoringParams } from '@mmf/scoring';
import { quarterOf } from '../fiscal.js';

/** The 12 periods of fiscal year `fy`, April first (2026 = FY 2026-27). */
export function fiscalMonths(fy: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? fy : fy + 1;
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

export interface Rollup {
  /** Locked months only, in fiscal order. */
  months: { period: string; score: number | null }[];
  quarters: { quarter: 1 | 2 | 3 | 4; score: number | null; monthsCounted: number }[];
  year: { score: number | null; quartersCounted: number };
}

/** `monthly` maps a period to its official level score; absent periods are not yet locked and are excluded, not zeroed. */
export function rollupFiscalYear(fy: number, monthly: Map<string, number | null>, params: ScoringParams): Rollup {
  const periods = fiscalMonths(fy);
  const quarters = ([1, 2, 3, 4] as const).map((quarter) => {
    const values = periods.filter((p) => quarterOf(p) === quarter).map((p) => monthly.get(p) ?? null);
    return { quarter, score: scoreQuarter(values, params), monthsCounted: values.filter((v) => v !== null).length };
  });
  const yearScore = scoreYear(
    quarters.map((q) => q.score),
    params,
  );
  return {
    months: periods.filter((p) => monthly.has(p)).map((period) => ({ period, score: monthly.get(period) ?? null })),
    quarters,
    year: { score: yearScore, quartersCounted: quarters.filter((q) => q.score !== null).length },
  };
}
