import type { PlantId, PlantMonthlyKpi } from '../types';

/**
 * Plant-level KPIs that come from ERP rather than the shift sheets (mocked).
 * Tonnage, OEE, rejection and yield on the Overview page are computed from shift data instead.
 */
export const PLANT_MONTHLY_KPIS: PlantMonthlyKpi[] = [
  { plantId: 'P1', month: '2026-08', powerCostPerTonne: 4260, otifPct: 94.1 },
  { plantId: 'P1', month: '2026-09', powerCostPerTonne: 4180, otifPct: 95.3 },
  { plantId: 'P1', month: '2026-10', powerCostPerTonne: 4120, otifPct: 96.0 },
  { plantId: 'P2', month: '2026-08', powerCostPerTonne: 4420, otifPct: 92.8 },
  { plantId: 'P2', month: '2026-09', powerCostPerTonne: 4390, otifPct: 94.4 },
  { plantId: 'P2', month: '2026-10', powerCostPerTonne: 4310, otifPct: 93.9 },
  { plantId: 'P3', month: '2026-08', powerCostPerTonne: 4350, otifPct: 93.5 },
  { plantId: 'P3', month: '2026-09', powerCostPerTonne: 4240, otifPct: 95.0 },
  { plantId: 'P3', month: '2026-10', powerCostPerTonne: 4190, otifPct: 95.6 },
];

export const PLANT_TARGETS: Record<PlantId, { tonnage: number; oee: number; yield: number; power: number; otif: number; rejection: number }> = {
  P1: { tonnage: 1350, oee: 78, yield: 88, power: 4200, otif: 95, rejection: 2.0 },
  P2: { tonnage: 1150, oee: 78, yield: 88, power: 4200, otif: 95, rejection: 2.0 },
  P3: { tonnage: 280, oee: 78, yield: 88, power: 4200, otif: 95, rejection: 2.0 },
};

/**
 * Performance-review coverage baseline for the last completed cycle (FY 2025-26), from HR records (mocked).
 * "Workers" includes contract workers. Company-wide this works out to ~91% of staff and ~64% of workers.
 * Headcounts cover the whole workforce, not just the operators modelled in the shift data.
 */
export interface ReviewCoverage {
  staffTotal: number;
  staffReviewed: number;
  workersTotal: number;
  workersReviewed: number;
  contractTotal: number;
  contractReviewed: number;
}

export const REVIEW_COVERAGE: Record<PlantId, ReviewCoverage> = {
  P1: { staffTotal: 60, staffReviewed: 55, workersTotal: 150, workersReviewed: 96, contractTotal: 105, contractReviewed: 66 },
  P2: { staffTotal: 36, staffReviewed: 33, workersTotal: 100, workersReviewed: 64, contractTotal: 70, contractReviewed: 41 },
  P3: { staffTotal: 24, staffReviewed: 21, workersTotal: 70, workersReviewed: 45, contractTotal: 49, contractReviewed: 28 },
};

/** Recordable safety injuries, 1 Apr – 31 Jul 2026 (before the shift-data window starts); mocked. */
export const INJURIES_APR_TO_JUL: Record<PlantId, number> = { P1: 2, P2: 1, P3: 1 };
