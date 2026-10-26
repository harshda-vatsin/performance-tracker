/**
 * ============================================================================
 *  SCORING CONFIG — the one place to change caps, rating bands and weightages.
 * ============================================================================
 *  Track A (senior staff, KRA/KPI):   ACHIEVEMENT_CAP_PCT, RATING_BANDS,
 *                                     WEIGHTAGE_TOTAL, INCREMENT_GUIDELINE
 *  Track B (operators, PQCDSM):       PQCDSM_WEIGHTS, PQCDSM_PARAMS, OPERATOR_GRADES
 * ============================================================================
 */

import type { OperatorRole, PqcdsmKey } from '../types';

// ---------------------------------------------------------------------------
// Track A — KRA / KPI scoring
// ---------------------------------------------------------------------------

/** Achievement % for any single KPI is capped here (so one KPI cannot mask the rest). */
export const ACHIEVEMENT_CAP_PCT = 120;

/** Weightages of all KRAs for one role must add up to this. */
export const WEIGHTAGE_TOTAL = 100;

export type RatingKey = 'outstanding' | 'exceeds' | 'meets' | 'needs-improvement' | 'unsatisfactory';

export interface RatingBand {
  key: RatingKey;
  label: string;
  /** Inclusive lower bound of the weighted total score. Must be sorted high → low. */
  min: number;
  /** Chip colour family used in the UI. */
  tone: 'green' | 'teal' | 'blue' | 'amber' | 'red';
}

/** Rating bands, highest first. A score takes the first band whose `min` it meets. */
export const RATING_BANDS: RatingBand[] = [
  { key: 'outstanding', label: 'Outstanding', min: 110, tone: 'green' },
  { key: 'exceeds', label: 'Exceeds', min: 95, tone: 'teal' },
  { key: 'meets', label: 'Meets', min: 80, tone: 'blue' },
  { key: 'needs-improvement', label: 'Needs Improvement', min: 60, tone: 'amber' },
  { key: 'unsatisfactory', label: 'Unsatisfactory', min: -Infinity, tone: 'red' },
];

/** Recommended annual increment (% of fixed pay) per rating band — feeds the HR increment export. */
export const INCREMENT_GUIDELINE: Record<RatingKey, number> = {
  outstanding: 14,
  exceeds: 10,
  meets: 7,
  'needs-improvement': 3,
  unsatisfactory: 0,
};

// ---------------------------------------------------------------------------
// Track B — PQCDSM (operators & factory staff)
// ---------------------------------------------------------------------------

export const PQCDSM_LABELS: Record<PqcdsmKey, string> = {
  P: 'Productivity',
  Q: 'Quality',
  C: 'Cost',
  D: 'Delivery',
  S: 'Safety',
  M: 'Morale',
};

/** Role-based PQCDSM weightages. Each row must add up to 100. */
export const PQCDSM_WEIGHTS: Record<OperatorRole, Record<PqcdsmKey, number>> = {
  'Hammer Operator': { P: 25, Q: 25, C: 15, D: 10, S: 15, M: 10 },
  'Press Operator': { P: 25, Q: 25, C: 15, D: 10, S: 15, M: 10 },
  'Die Setter': { P: 15, Q: 20, C: 25, D: 10, S: 15, M: 15 },
  'Furnace Operator': { P: 15, Q: 20, C: 25, D: 10, S: 20, M: 10 },
  Trimmer: { P: 25, Q: 25, C: 10, D: 15, S: 15, M: 10 },
  Helper: { P: 20, Q: 15, C: 10, D: 10, S: 25, M: 20 },
  Inspector: { P: 10, Q: 40, C: 10, D: 15, S: 15, M: 10 },
};

/** Tunable parameters behind each PQCDSM dimension score (all scores are 0–100). */
export const PQCDSM_PARAMS = {
  shiftMinutes: 480,
  quality: {
    /** Rejection % at or below this scores 100. */
    targetRejectionPct: 1.5,
    /** Rejection % at or above this scores 0 (linear in between). */
    zeroScoreRejectionPct: 8,
  },
  cost: {
    /** Scrap at or below the machine allowance scores 100; at allowance × this multiple scores 0. */
    scrapZeroMultiple: 2,
    /** Blend of scrap score vs die-life score when die changes were recorded. */
    scrapShare: 0.6,
    dieLifeShare: 0.4,
  },
  delivery: {
    /** A shift "meets schedule" when output ≥ this % of the downtime-adjusted plan. */
    shiftMeetsPlanPct: 90,
  },
  safety: {
    ppeShare: 0.5,
    incidentShare: 0.3,
    nearMissShare: 0.2,
    /** Score for 0 / 1 / 2+ recordable incidents in the month. */
    incidentScores: [100, 40, 0],
    /** Near-miss reports expected per operator per month (proactive reporting is rewarded). */
    nearMissTargetPerMonth: 1,
  },
  morale: {
    attendanceShare: 0.4,
    kaizenShare: 0.3,
    fiveSShare: 0.3,
    kaizenTargetPerMonth: 1,
    /** Attendance below this scores 0; scales linearly up to 100% attendance. */
    attendanceFloorPct: 80,
  },
};

export interface OperatorGrade {
  key: string;
  label: string;
  min: number;
  tone: 'green' | 'teal' | 'blue' | 'amber' | 'red';
}

/** Overall PQCDSM score → grade, highest first. */
export const OPERATOR_GRADES: OperatorGrade[] = [
  { key: 'A', label: 'A · Star', min: 90, tone: 'green' },
  { key: 'B', label: 'B · Strong', min: 80, tone: 'teal' },
  { key: 'C', label: 'C · Steady', min: 70, tone: 'blue' },
  { key: 'D', label: 'D · Coach', min: 55, tone: 'amber' },
  { key: 'E', label: 'E · Intervene', min: -Infinity, tone: 'red' },
];
