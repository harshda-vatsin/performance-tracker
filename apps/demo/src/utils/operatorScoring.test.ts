import { describe, expect, it } from 'vitest';
import { PQCDSM_WEIGHTS } from '../config/scoring.config';
import {
  adjustedStandardQty,
  gradeFor,
  overallScore,
  qualityScore,
  safetyScore,
  scrapScore,
  shiftProductivityPct,
} from './operatorScoring';

const rec = (planned: number, actual: number, downtime: { reason: any; minutes: number; operatorFault: boolean }[]) => ({
  plannedQty: planned,
  actualQty: actual,
  downtime,
});

describe('downtime exclusion (the key Track B rule)', () => {
  it('a breakdown that is not the operator’s fault is removed from the standard', () => {
    // 480-min shift, 240 min breakdown → only half the plan was achievable.
    const r = rec(400, 200, [{ reason: 'Breakdown', minutes: 240, operatorFault: false }]);
    expect(adjustedStandardQty(r)).toBeCloseTo(200);
    expect(shiftProductivityPct(r)).toBeCloseTo(100);
  });

  it('the same downtime flagged as operator fault is NOT excluded', () => {
    const r = rec(400, 200, [{ reason: 'Breakdown', minutes: 240, operatorFault: true }]);
    expect(adjustedStandardQty(r)).toBeCloseTo(400);
    expect(shiftProductivityPct(r)).toBeCloseTo(50);
  });

  it('only the non-fault part of mixed downtime is excluded', () => {
    const r = rec(480, 400, [
      { reason: 'Power Cut', minutes: 60, operatorFault: false },
      { reason: 'Die Change', minutes: 60, operatorFault: true },
    ]);
    expect(adjustedStandardQty(r)).toBeCloseTo(420);
  });

  it('never returns a negative standard', () => {
    const r = rec(400, 0, [{ reason: 'Power Cut', minutes: 900, operatorFault: false }]);
    expect(adjustedStandardQty(r)).toBe(0);
    expect(shiftProductivityPct(r)).toBe(0);
  });
});

describe('dimension scores', () => {
  it('quality is 100 at/below target rejection and 0 at/above the zero point', () => {
    expect(qualityScore(1.0)).toBe(100);
    expect(qualityScore(8)).toBe(0);
    expect(qualityScore(12)).toBe(0);
    expect(qualityScore(4.75)).toBeCloseTo(50);
  });

  it('scrap within allowance scores 100; twice the allowance scores 0', () => {
    expect(scrapScore(8, 9)).toBe(100);
    expect(scrapScore(18, 9)).toBe(0);
    expect(scrapScore(13.5, 9)).toBeCloseTo(50);
  });

  it('safety blends PPE, incidents and near-miss reporting', () => {
    expect(safetyScore(100, 0, 1)).toBeCloseTo(100);
    expect(safetyScore(100, 1, 1)).toBeCloseTo(100 * 0.5 + 40 * 0.3 + 100 * 0.2);
    expect(safetyScore(80, 2, 0)).toBeCloseTo(40);
  });
});

describe('overall score and grade', () => {
  it('every role’s PQCDSM weightages total 100', () => {
    for (const [role, w] of Object.entries(PQCDSM_WEIGHTS)) {
      expect(Object.values(w).reduce((s, n) => s + n, 0), role).toBe(100);
    }
  });

  it('applies role-specific weights', () => {
    const scores = { P: 100, Q: 50, C: 100, D: 100, S: 100, M: 100 };
    // Inspector weights quality at 40%, press operator at 25%.
    expect(overallScore(scores, 'Inspector')).toBeLessThan(overallScore(scores, 'Press Operator'));
    expect(overallScore(scores, 'Press Operator')).toBeCloseTo(87.5);
  });

  it('maps overall score to grade', () => {
    expect(gradeFor(95).key).toBe('A');
    expect(gradeFor(85).key).toBe('B');
    expect(gradeFor(72).key).toBe('C');
    expect(gradeFor(60).key).toBe('D');
    expect(gradeFor(40).key).toBe('E');
  });
});
