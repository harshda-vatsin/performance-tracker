import type { DefectType, DowntimeReason, Shift } from '../types';

export const SHIFTS: Shift[] = ['A', 'B', 'C'];

export const SHIFT_TIMINGS: Record<Shift, string> = {
  A: '06:00 – 14:00',
  B: '14:00 – 22:00',
  C: '22:00 – 06:00',
};

export const DEFECT_TYPES: DefectType[] = ['Underfill', 'Lap / Fold', 'Mismatch', 'Crack', 'Scale Pit'];

export const DOWNTIME_REASONS: DowntimeReason[] = ['Breakdown', 'Die Change', 'Material Shortage', 'Power Cut'];

/** "Today" for the demo — the latest day with shift data. */
export const DEMO_TODAY = '2026-10-22';

/** Plant shutdowns: Independence Day, Gandhi Jayanti, Ayudha Pooja, Vijayadashami. Sundays are off too. */
export const HOLIDAYS = new Set(['2026-08-15', '2026-10-02', '2026-10-19', '2026-10-20']);

/** Months of shift data held in the demo. */
export const DATA_MONTHS = ['2026-08', '2026-09', '2026-10'];

export const SAFETY_OBS_TYPES = ['None', 'Near-miss', 'Unsafe act', 'Unsafe condition', 'Good practice'] as const;
