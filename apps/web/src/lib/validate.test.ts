import { describe, expect, it } from 'vitest';
import { farFromPresentLevel, parseNum, resultProblem, validateTemplate, type DraftKra } from './validate';

const kra = (over: Partial<DraftKra> = {}): DraftKra => ({
  nameEn: 'Rejection',
  pqcdsm: 'Q',
  direction: 'LOWER_BETTER',
  presentLevel: 5,
  targets: [4, 3.5, 3, 2.5],
  weights: { HOD: 100 },
  ...over,
});

describe('validateTemplate', () => {
  it('accepts weights that total exactly 100 per level', () => {
    expect(validateTemplate(['HOD'], [kra({ weights: { HOD: 60 } }), kra({ nameEn: 'Output', weights: { HOD: 40 } })]).errors).toEqual([]);
  });

  it('reports the level and the actual total when weights do not add up', () => {
    const { errors } = validateTemplate(['HOD', 'SUPERVISOR'], [kra({ weights: { HOD: 100, SUPERVISOR: 90 } })]);
    expect(errors.map((e) => e.message)).toEqual(['Level SUPERVISOR weights total 90 (must be exactly 100)']);
  });

  it('avoids floating-point drift in weight totals', () => {
    const parts = [33.33, 33.33, 33.34].map((w, i) => kra({ nameEn: `K${i}`, weights: { HOD: w } }));
    expect(validateTemplate(['HOD'], parts).errors).toEqual([]);
  });

  it('flags a target on the wrong side of the present level for the direction', () => {
    const { errors } = validateTemplate(['HOD'], [kra({ targets: [4, 3, 6, 2] })]);
    expect(errors[0]?.code).toBe('TARGET_SIDE');
    const higher = validateTemplate(['HOD'], [kra({ direction: 'HIGHER_BETTER', presentLevel: 80, targets: [85, 90, 70, 95] })]);
    expect(higher.errors[0]?.code).toBe('TARGET_SIDE');
  });

  it('warns, but does not fail, when every target equals the present level', () => {
    const { errors, warnings } = validateTemplate(['HOD'], [kra({ targets: [5, 5, 5, 5] })]);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.code === 'TARGET_EQ_PL')).toBe(true);
  });

  it('warns about PQCDSM categories without a weighted KRA', () => {
    const gaps = validateTemplate(['HOD'], [kra()]).warnings.filter((w) => w.code === 'PQCDSM_GAP');
    expect(gaps).toHaveLength(5);
  });

  it('needs levels and KRAs', () => {
    expect(validateTemplate([], [kra()]).errors[0]?.code).toBe('NO_LEVELS');
    expect(validateTemplate(['HOD'], []).errors[0]?.code).toBe('NO_KRAS');
  });
});

describe('resultProblem', () => {
  it('keeps percentages within 0 to 100', () => {
    expect(resultProblem('%', 101)).toMatch(/between 0 and 100/);
    expect(resultProblem('%', -1)).toMatch(/between 0 and 100/);
    expect(resultProblem('%', 100)).toBeNull();
  });
  it('wants whole, non-negative counts', () => {
    expect(resultProblem('count', 2.5)).toMatch(/whole number/);
    expect(resultProblem('count', -1)).toMatch(/whole number/);
    expect(resultProblem('count', 0)).toBeNull();
  });
  it('leaves other units alone but rejects non-numbers', () => {
    expect(resultProblem('kWh/t', 12345)).toBeNull();
    expect(resultProblem('%', Number.NaN)).toBe('enter a number');
  });
});

describe('helpers', () => {
  it('detects results far from the present level', () => {
    expect(farFromPresentLevel(10, 31)).toBe(true);
    expect(farFromPresentLevel(10, 30)).toBe(false);
    expect(farFromPresentLevel(0, 500)).toBe(false);
  });
  it('parses typed numbers', () => {
    expect(parseNum('')).toBeNull();
    expect(parseNum(' 12.5 ')).toBe(12.5);
    expect(parseNum('abc')).toBeNaN();
  });
});
