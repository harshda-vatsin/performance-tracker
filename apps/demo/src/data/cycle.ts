export interface ReviewQuarter {
  q: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  months: string;
  state: 'Completed' | 'In review' | 'Upcoming';
}

/** One annual cycle (April – March) with quarterly reviews. */
export const CYCLE = {
  id: 'FY2026-27',
  label: 'FY 2026-27',
  range: 'Apr 2026 – Mar 2027',
  currentPeriod: 'Q2 review · Apr – Sep 2026 (YTD)',
  quarters: [
    { q: 'Q1', months: 'Apr – Jun', state: 'Completed' },
    { q: 'Q2', months: 'Jul – Sep', state: 'In review' },
    { q: 'Q3', months: 'Oct – Dec', state: 'Upcoming' },
    { q: 'Q4', months: 'Jan – Mar', state: 'Upcoming' },
  ] as ReviewQuarter[],
};

/** Last SAP sync timestamp shown on "Synced from SAP S/4HANA" badges (mocked). */
export const SAP_LAST_SYNC = '2026-10-22T06:00:00';

export const HISTORY_CYCLES = ['FY 2023-24', 'FY 2024-25', 'FY 2025-26'];
