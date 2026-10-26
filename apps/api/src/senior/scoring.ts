/**
 * Senior-staff (Module A) scoring. Pure: the same engine as the plant track, applied one level up.
 *   KPI score  = scoreKra   (via computeMonth)
 *   KRA score  = scoreLevel over the KRA's KPIs (weights total 100 inside the KRA)
 *   Total      = scoreLevel over the KRAs (weights total 100)
 * Quarter and year roll-ups are the existing rollupFiscalYear, so N/A and unconfirmed months behave identically.
 */
import { scoreLevel, type ScoringParams } from '@mmf/scoring';
import { computeMonth, resolveParams, type ResultRow } from '../scoring/monthly.js';
import { rollupFiscalYear, type Rollup } from '../scoring/rollup.js';

export interface SeniorKpiInput {
  kpiId: string;
  nameEn: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  presentLevel: number;
  target: number;
  result: number | null;
  naReason: string | null;
  /** Weight inside its KRA (the KRA's KPIs total 100). */
  weight: number;
}

export interface SeniorKraInput {
  kraId: string;
  weight: number;
  kpis: SeniorKpiInput[];
}

export interface SeniorMonthScores {
  kpis: { kpiId: string; raw: number | null; final: number | null; flags: string[] }[];
  kras: { kraId: string; score: number | null }[];
  total: number | null;
}

/** SENIOR-scope parameters: the Forge defaults overridden by `core.senior_setting` 'scoring' (doc 12 Q27). */
export const seniorParams = (setting: unknown): ScoringParams => resolveParams({ scoring: setting });

export function computeSeniorMonth(kras: SeniorKraInput[], params: ScoringParams): SeniorMonthScores {
  const kpis: SeniorMonthScores['kpis'] = [];
  const kraScores = kras.map((kra) => {
    const rows: ResultRow[] = kra.kpis.map((k) => ({
      resultId: k.kpiId,
      nameEn: k.nameEn,
      direction: k.direction,
      presentLevel: k.presentLevel,
      target: k.target,
      result: k.result,
      naReason: k.naReason,
      weights: { KRA: k.weight },
    }));
    const month = computeMonth(rows, ['KRA'], [], params);
    for (const s of month.kras) kpis.push({ kpiId: s.resultId, raw: s.raw, final: s.final, flags: s.flags });
    return { kraId: kra.kraId, score: month.levels[0].score };
  });
  const total = scoreLevel(
    kraScores.map((s, i) => ({ score: s.score, weight: kras[i].weight })),
    params,
  ).score;
  return { kpis, kras: kraScores, total };
}

export interface SeniorRollup {
  total: Rollup;
  /** The same roll-up for each KRA, keyed by KRA id. */
  kras: Record<string, Rollup>;
}

/** `months` holds the CONFIRMED months only; anything else is excluded, not zeroed. */
export function rollupSenior(fy: number, months: { period: string; scores: SeniorMonthScores }[], params: ScoringParams): SeniorRollup {
  const total = rollupFiscalYear(fy, new Map(months.map((m) => [m.period, m.scores.total])), params);
  const kraIds = [...new Set(months.flatMap((m) => m.scores.kras.map((k) => k.kraId)))];
  const kras = Object.fromEntries(
    kraIds.map((id) => [
      id,
      rollupFiscalYear(fy, new Map(months.map((m) => [m.period, m.scores.kras.find((k) => k.kraId === id)?.score ?? null])), params),
    ]),
  );
  return { total, kras };
}

export interface RatingBand {
  code: string;
  label: string;
  minScore: number;
  rank: number;
}

/** The band with the highest minimum the score reaches; null when there is no score or no band applies. */
export function bandFor(score: number | null, bands: RatingBand[]): RatingBand | null {
  if (score === null) return null;
  return [...bands].sort((a, b) => b.minScore - a.minScore).find((b) => score >= b.minScore) ?? null;
}
