import { FORGE_PARAMS } from '@mmf/scoring';
import { describe, expect, it } from 'vitest';
import { bandFor, computeSeniorMonth, rollupSenior, seniorParams, type RatingBand, type SeniorKraInput } from '../src/senior/scoring.js';

/**
 * Worked month (Forge-style B = 60, Q1 targets):
 *   Delivery (60):  Productivity PL 82 target 84 result 84 -> 100 (w50);  Rejection PL 5 target 4.5 result 4.75 -> 80 (w50)  => KRA 90
 *   Safety   (40):  Unsafe       PL 4  target 3  result 4  -> 60 (w100)                                                    => KRA 60
 *   Total = 0.6 * 90 + 0.4 * 60 = 78.00
 */
const kpi = (id: string, direction: 'HIGHER_BETTER' | 'LOWER_BETTER', presentLevel: number, target: number, result: number | null, weight: number, naReason: string | null = null) => ({
  kpiId: id,
  nameEn: id,
  direction,
  presentLevel,
  target,
  result,
  naReason,
  weight,
});

const month = (prod: number | null, rej: number | null, unsafe: number | null, rejNa: string | null = null): SeniorKraInput[] => [
  { kraId: 'delivery', weight: 60, kpis: [kpi('prod', 'HIGHER_BETTER', 82, 84, prod, 50), kpi('rej', 'LOWER_BETTER', 5, 4.5, rej, 50, rejNa)] },
  { kraId: 'safety', weight: 40, kpis: [kpi('unsafe', 'LOWER_BETTER', 4, 3, unsafe, 100)] },
];

describe('senior month scoring (KPI -> KRA -> total, same engine as the plant track)', () => {
  it('scores KPIs with the existing formula and weights them up through KRAs', () => {
    const s = computeSeniorMonth(month(84, 4.75, 4), FORGE_PARAMS);
    expect(s.kpis.map((k) => k.final)).toEqual([100, 80, 60]);
    expect(s.kras).toEqual([
      { kraId: 'delivery', score: 90 },
      { kraId: 'safety', score: 60 },
    ]);
    expect(s.total).toBe(78);
  });

  it('caps a KPI at the cap, flags it, and still feeds the weighted total', () => {
    const s = computeSeniorMonth(month(86, 4.5, 3), FORGE_PARAMS); // 86 vs target 84 -> 140 raw -> capped at 120
    expect(s.kpis[0]).toMatchObject({ raw: 140, final: 120, flags: ['CAPPED'] });
    expect(s.kras[0].score).toBe(110); // (120 + 100) / 2
    expect(s.total).toBe(106); // 0.6 * 110 + 0.4 * 100
  });

  it('drops an N/A KPI and renormalises inside its KRA instead of scoring it zero', () => {
    const s = computeSeniorMonth(month(84, null, 4, 'not measured this month'), FORGE_PARAMS);
    expect(s.kpis[1]).toMatchObject({ final: null, flags: ['NA'] });
    expect(s.kras[0].score).toBe(100);
    expect(s.total).toBe(84); // 0.6 * 100 + 0.4 * 60
  });

  it('drops a KRA whose KPIs are all N/A and renormalises the total', () => {
    const s = computeSeniorMonth(
      [
        { kraId: 'a', weight: 70, kpis: [kpi('a1', 'HIGHER_BETTER', 10, 20, 20, 100)] },
        { kraId: 'b', weight: 30, kpis: [kpi('b1', 'HIGHER_BETTER', 10, 20, null, 100, 'n/a')] },
      ],
      FORGE_PARAMS,
    );
    expect(s.kras[1].score).toBeNull();
    expect(s.total).toBe(100);
  });

  it('honours SENIOR-scope parameters from configuration', () => {
    const params = seniorParams({ baseScoreB: 50 });
    expect(params.baseScoreB).toBe(50);
    const s = computeSeniorMonth(month(84, 4.75, 4), params);
    expect(s.kpis[2].final).toBe(50); // result at present level scores B
  });
});

describe('senior roll-up (monthly -> quarterly -> yearly)', () => {
  const m = (period: string, total: number) => ({ period, scores: { kpis: [], kras: [{ kraId: 'k', score: total }], total } });

  it('averages confirmed months into quarters and quarters into the year, excluding unconfirmed months', () => {
    const r = rollupSenior(2026, [m('2026-04', 78), m('2026-05', 106), m('2026-06', 86), m('2026-07', 100)], FORGE_PARAMS);
    expect(r.total.quarters.map((q) => [q.quarter, q.score, q.monthsCounted])).toEqual([
      [1, 90, 3],
      [2, 100, 1],
      [3, null, 0],
      [4, null, 0],
    ]);
    expect(r.total.year).toEqual({ score: 95, quartersCounted: 2 });
    expect(r.kras.k.year.score).toBe(95);
  });

  it('has no year score until a month is confirmed', () => {
    expect(rollupSenior(2026, [], FORGE_PARAMS).total.year.score).toBeNull();
  });
});

describe('rating bands', () => {
  const bands: RatingBand[] = [
    { code: 'LOW', label: 'Low', minScore: 0, rank: 1 },
    { code: 'MID', label: 'Mid', minScore: 80, rank: 2 },
    { code: 'HIGH', label: 'High', minScore: 95, rank: 3 },
  ];

  it('picks the highest band whose minimum the score reaches, inclusive at the boundary', () => {
    expect(bandFor(94.99, bands)?.code).toBe('MID');
    expect(bandFor(95, bands)?.code).toBe('HIGH');
    expect(bandFor(0, bands)?.code).toBe('LOW');
    expect(bandFor(120, bands)?.code).toBe('HIGH');
  });

  it('gives no band without a score or when no band covers it', () => {
    expect(bandFor(null, bands)).toBeNull();
    expect(bandFor(-1, bands)).toBeNull();
  });
});
