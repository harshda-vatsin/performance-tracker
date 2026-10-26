/** Indian fiscal year (April-March). `period` is always YYYY-MM; fiscal year is the start year (2026 = FY 2026-27). */
export const isPeriod = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

const parts = (period: string): [number, number] => {
  const [y, m] = period.split('-').map(Number);
  return [y, m];
};

export function fiscalYearOf(period: string): number {
  const [y, m] = parts(period);
  return m >= 4 ? y : y - 1;
}

/** Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar. */
export function quarterOf(period: string): 1 | 2 | 3 | 4 {
  const [, m] = parts(period);
  if (m >= 4 && m <= 6) return 1;
  if (m >= 7 && m <= 9) return 2;
  if (m >= 10) return 3;
  return 4;
}

export function daysInMonth(period: string): number {
  const [y, m] = parts(period);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
