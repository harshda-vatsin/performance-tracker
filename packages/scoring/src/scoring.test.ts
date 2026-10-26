import { describe, expect, it } from 'vitest';
import {
  FORGE_PARAMS,
  MACHINE_PARAMS,
  roundHalfUp,
  scoreEmployee,
  scoreKra,
  scoreLevel,
  quarterMean,
  scoreQuarter,
  scoreYear,
  scoreYearFromMonths,
  type KraInput,
} from './index';

const kra = (presentLevel: number, target: number, result: number, direction: KraInput['direction']): KraInput => ({
  presentLevel,
  target,
  result,
  direction,
});

describe('roundHalfUp', () => {
  it('rounds .5 up even where binary floats would round down', () => {
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(-1.005, 2)).toBe(-1.01);
  });
});

describe('scoreKra — worked examples (doc 05 §1.6)', () => {
  it('1. higher-is-better', () => {
    const r = scoreKra(kra(82, 90, 86, 'HIGHER_BETTER'), FORGE_PARAMS);
    expect(r.final).toBe(80);
    expect(r.flags).toEqual([]);
  });

  it('2. lower-is-better, improving', () => {
    expect(scoreKra(kra(5, 3, 4, 'LOWER_BETTER'), FORGE_PARAMS).final).toBe(80);
  });

  it('3. lower-is-better, worse than present level', () => {
    expect(scoreKra(kra(5, 3, 6, 'LOWER_BETTER'), FORGE_PARAMS).final).toBe(40);
  });

  it('4. runaway result is capped', () => {
    const r = scoreKra(kra(10, 12, 40, 'HIGHER_BETTER'), FORGE_PARAMS);
    expect(r.raw).toBe(660);
    expect(r.final).toBe(120);
    expect(r.flags).toContain('CAPPED');
  });

  it('5. collapse is floored', () => {
    // 60 + 40 * (R - 10) / 2 = -224  =>  R = -4.2
    const r = scoreKra(kra(10, 12, -4.2, 'HIGHER_BETTER'), FORGE_PARAMS);
    expect(r.raw).toBe(-224);
    expect(r.final).toBe(0);
    expect(r.flags).toContain('FLOORED');
  });

  it('6. machine shop uses B = 50', () => {
    expect(scoreKra(kra(100, 110, 108, 'HIGHER_BETTER'), MACHINE_PARAMS).final).toBe(90);
  });

  it('7. target = present level, result meets it', () => {
    const r = scoreKra(kra(95, 95, 97, 'HIGHER_BETTER'), FORGE_PARAMS);
    expect(r.final).toBe(100);
    expect(r.flags).toContain('TARGET_EQ_PL');
  });

  it('8. target = present level, result worse', () => {
    const r = scoreKra(kra(95, 95, 93, 'HIGHER_BETTER'), FORGE_PARAMS);
    expect(r.final).toBe(58.74);
    expect(r.flags).toContain('TARGET_EQ_PL');
  });

  it('9. safety: unsafe conditions 4 -> 0, result 1', () => {
    expect(scoreKra(kra(4, 0, 1, 'LOWER_BETTER'), FORGE_PARAMS).final).toBe(90);
  });

  it('10. zero tolerance: meets / breach', () => {
    const ok = scoreKra(kra(0, 0, 0, 'LOWER_BETTER'), FORGE_PARAMS);
    expect(ok.final).toBe(100);
    expect(ok.flags).toContain('ZERO_TOLERANCE');
    const breach = scoreKra(kra(0, 0, 2, 'LOWER_BETTER'), FORGE_PARAMS);
    expect(breach.final).toBe(0);
    expect(breach.flags).toContain('ZERO_TOLERANCE');
  });
});

describe('scoreKra — properties', () => {
  it('a better result never lowers the score (higher-is-better)', () => {
    let prev = -Infinity;
    for (let r = 70; r <= 100; r += 0.5) {
      const s = scoreKra(kra(82, 90, r, 'HIGHER_BETTER'), FORGE_PARAMS).final;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('a better result never lowers the score (lower-is-better)', () => {
    let prev = -Infinity;
    for (let r = 8; r >= 0; r -= 0.25) {
      const s = scoreKra(kra(5, 3, r, 'LOWER_BETTER'), FORGE_PARAMS).final;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('final always lies within [floor, cap]', () => {
    for (const r of [-1000, -5, 0, 5, 50, 1e6]) {
      const s = scoreKra(kra(10, 12, r, 'HIGHER_BETTER'), FORGE_PARAMS).final;
      expect(s).toBeGreaterThanOrEqual(FORGE_PARAMS.floor);
      expect(s).toBeLessThanOrEqual(FORGE_PARAMS.cap);
    }
  });

  it('honours custom cap and floor', () => {
    const p = { ...FORGE_PARAMS, cap: 100, floor: 10 };
    expect(scoreKra(kra(10, 12, 40, 'HIGHER_BETTER'), p).final).toBe(100);
    expect(scoreKra(kra(10, 12, -4.2, 'HIGHER_BETTER'), p).final).toBe(10);
  });
});

describe('scoreKra — validation', () => {
  it('rejects a target on the wrong side of the present level', () => {
    expect(() => scoreKra(kra(82, 70, 80, 'HIGHER_BETTER'), FORGE_PARAMS)).toThrow(/target/i);
    expect(() => scoreKra(kra(5, 8, 6, 'LOWER_BETTER'), FORGE_PARAMS)).toThrow(/target/i);
  });

  it('rejects non-finite inputs', () => {
    expect(() => scoreKra(kra(82, 90, NaN, 'HIGHER_BETTER'), FORGE_PARAMS)).toThrow();
  });
});

describe('scoreLevel', () => {
  it('11. weighted level score', () => {
    const r = scoreLevel(
      [
        { score: 80, weight: 50 },
        { score: 100, weight: 30 },
        { score: 120, weight: 20 },
      ],
      FORGE_PARAMS,
    );
    expect(r.score).toBe(94);
  });

  it('12. N/A rows renormalise the remaining weights', () => {
    const r = scoreLevel(
      [
        { score: 80, weight: 50 },
        { score: 100, weight: 30 },
        { score: null, weight: 20 },
      ],
      FORGE_PARAMS,
    );
    expect(r.score).toBe(87.5);
  });

  it('level with no applicable weight yields null and NO_WEIGHTS', () => {
    const r = scoreLevel([{ score: null, weight: 100 }], FORGE_PARAMS);
    expect(r.score).toBeNull();
    expect(r.flags).toContain('NO_WEIGHTS');
  });

  it('level score stays within [floor, cap]', () => {
    const r = scoreLevel(
      [
        { score: 120, weight: 60 },
        { score: 120, weight: 40 },
      ],
      FORGE_PARAMS,
    );
    expect(r.score).toBeLessThanOrEqual(FORGE_PARAMS.cap);
  });
});

describe('roll-ups', () => {
  it('13. quarter is the average of monthly scores', () => {
    expect(scoreQuarter([94, 88, 100], FORGE_PARAMS)).toBe(94);
  });

  it('quarter excludes months not yet locked', () => {
    expect(scoreQuarter([94, null, 100], FORGE_PARAMS)).toBe(97);
  });

  it('14. year is the average of quarters', () => {
    expect(scoreYear([94, 90, 85, 95], FORGE_PARAMS)).toBe(91);
  });

  it('returns null when nothing is locked', () => {
    expect(scoreQuarter([null, null, null], FORGE_PARAMS)).toBeNull();
    expect(scoreYear([null, null, null, null], FORGE_PARAMS)).toBeNull();
    expect(scoreYearFromMonths([[null, null, null], [null], [], []], FORGE_PARAMS)).toBeNull();
  });

  it('year averages the UNROUNDED quarter scores and rounds only the final result', () => {
    // Q1 = (78 + 106 + 84) / 3 = 89.3333..., Q2 = 100. Averaging the displayed 89.33 would give 94.66 (a half-cent off).
    expect(scoreQuarter([78, 106, 84], FORGE_PARAMS)).toBe(89.33);
    expect(scoreYearFromMonths([[78, 106, 84], [100], [null], [null]], FORGE_PARAMS)).toBe(94.67);
    expect(scoreYear([quarterMean([78, 106, 84]), 100], FORGE_PARAMS)).toBe(94.67);
  });

  it('does not round twice: quarters that round apart do not move the year', () => {
    // Quarters 80.004 and 80.0059 display as 80 and 80.01; the true mean is 80.00495, which rounds to 80.
    expect(scoreYearFromMonths([[80.004], [80.0059]], FORGE_PARAMS)).toBe(80);
  });

  it('leaves quarters that are already exact unchanged', () => {
    expect(scoreYearFromMonths([[94, 94, 94], [90], [85], [95]], FORGE_PARAMS)).toBe(91);
  });

  it('15. mid-month transfer is weighted by days', () => {
    expect(
      scoreEmployee(
        [
          { score: 90, days: 20 },
          { score: 80, days: 10 },
        ],
        FORGE_PARAMS,
      ),
    ).toBe(86.67);
  });
});
