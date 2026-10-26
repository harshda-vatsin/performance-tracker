import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_CAP_PCT, RATING_BANDS } from '../config/scoring.config';
import type { GoalItem } from '../types';
import {
  achievementPct,
  rebalanceWeights,
  ratingFor,
  scoreItems,
  sumWeights,
  weightedTotal,
  weightsValid,
} from './scoring';

const item = (kraId: string, weightage: number, target: number, direction: 'higher' | 'lower'): GoalItem => ({
  kraId,
  area: 'Test',
  kpiKey: kraId,
  kpi: kraId,
  unit: '%',
  direction,
  source: 'Manual',
  weightage,
  target,
});

describe('achievementPct', () => {
  it('higher-is-better uses actual / target', () => {
    expect(achievementPct(90, 100, 'higher')).toBeCloseTo(90);
  });

  it('lower-is-better uses target / actual', () => {
    expect(achievementPct(4, 2, 'lower')).toBeCloseTo(50);
    expect(achievementPct(2.5, 2, 'lower')).toBeCloseTo(80);
  });

  it('is capped at the configured maximum', () => {
    expect(achievementPct(200, 100, 'higher')).toBe(ACHIEVEMENT_CAP_PCT);
    expect(achievementPct(0.5, 2, 'lower')).toBe(ACHIEVEMENT_CAP_PCT);
  });

  it('honours an explicit cap override', () => {
    expect(achievementPct(150, 100, 'higher', 110)).toBe(110);
  });

  it('treats zero actual on a lower-is-better KPI as best case', () => {
    expect(achievementPct(0, 0.8, 'lower')).toBe(ACHIEVEMENT_CAP_PCT);
  });

  it('never goes negative or NaN', () => {
    expect(achievementPct(-5, 100, 'higher')).toBe(0);
    expect(achievementPct(NaN, 100, 'higher')).toBe(0);
  });
});

describe('weighted total', () => {
  it('weights each KPI by its weightage', () => {
    const rows = [
      { weightage: 60, achievement: 100 },
      { weightage: 40, achievement: 50 },
    ];
    expect(weightedTotal(rows)).toBeCloseTo(80);
  });

  it('scoreItems combines achievement, cap and weightage', () => {
    const items = [item('a', 50, 100, 'higher'), item('b', 50, 2, 'lower')];
    const { rows, total } = scoreItems(items, { a: { value: 150 }, b: { value: 4 } });
    expect(rows[0].achievement).toBe(ACHIEVEMENT_CAP_PCT); // 150% capped to 120
    expect(rows[1].achievement).toBeCloseTo(50);
    expect(total).toBeCloseTo(85);
    expect(rows[0].points + rows[1].points).toBeCloseTo(85);
  });

  it('a missing actual scores zero rather than crashing', () => {
    const { rows } = scoreItems([item('a', 100, 100, 'higher')], {});
    expect(rows[0].achievement).toBe(0);
  });
});

describe('rating bands', () => {
  it.each([
    [125, 'outstanding'],
    [110, 'outstanding'],
    [109.9, 'exceeds'],
    [95, 'exceeds'],
    [94.9, 'meets'],
    [80, 'meets'],
    [79.9, 'needs-improvement'],
    [60, 'needs-improvement'],
    [59.9, 'unsatisfactory'],
    [0, 'unsatisfactory'],
  ])('score %s → %s', (score, expected) => {
    expect(ratingFor(score).key).toBe(expected);
  });

  it('bands are sorted high → low', () => {
    const mins = RATING_BANDS.map((b) => b.min);
    expect([...mins].sort((a, b) => b - a)).toEqual(mins);
  });
});

describe('weightage helpers', () => {
  it('validates that weightages total 100', () => {
    expect(weightsValid([{ weightage: 60 }, { weightage: 40 }])).toBe(true);
    expect(weightsValid([{ weightage: 60 }, { weightage: 45 }])).toBe(false);
  });

  it('rebalances the other KRAs to a 100 total, holding the edited one', () => {
    const out = rebalanceWeights([30, 30, 40], 0); // edited KRA is now 30; others scale to 70
    expect(sumWeights(out.map((w) => ({ weightage: w })))).toBe(100);
    expect(out[0]).toBe(30);
  });

  it('rebalances after a deletion (no fixed row)', () => {
    const out = rebalanceWeights([25, 25, 20], null);
    expect(out.reduce((s, n) => s + n, 0)).toBe(100);
  });

  it('survives awkward rounding', () => {
    const out = rebalanceWeights([33, 33, 33, 1], 3);
    expect(out.reduce((s, n) => s + n, 0)).toBe(100);
    expect(out[3]).toBe(1);
  });
});
