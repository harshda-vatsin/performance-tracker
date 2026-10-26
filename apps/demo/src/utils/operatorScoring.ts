/**
 * Track B scoring (PQCDSM) — pure functions only.
 * Parameters and role weightages live in config/scoring.config.ts.
 *
 * Key rule: downtime that is NOT the operator's fault (breakdown, die change,
 * material shortage, power cut — unless the entry is flagged "operator fault")
 * is removed from the productivity standard, so operators are not penalised for it.
 */
import {
  OPERATOR_GRADES,
  PQCDSM_PARAMS,
  PQCDSM_WEIGHTS,
  type OperatorGrade,
} from '../config/scoring.config';
import type { Machine, MonthlyInput, OperatorRole, PqcdsmKey, ShiftRecord } from '../types';

type Params = typeof PQCDSM_PARAMS;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sum = (xs: number[]) => xs.reduce((s, n) => s + n, 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

export type DimensionScores = Record<PqcdsmKey, number>;

// ---------------------------------------------------------------------------
// Per-shift helpers
// ---------------------------------------------------------------------------

/** Minutes of downtime that do NOT count against the operator. */
export function excludedDowntimeMin(rec: Pick<ShiftRecord, 'downtime'>): number {
  return sum(rec.downtime.filter((d) => !d.operatorFault).map((d) => d.minutes));
}

/** Minutes of downtime the operator is accountable for. */
export function faultDowntimeMin(rec: Pick<ShiftRecord, 'downtime'>): number {
  return sum(rec.downtime.filter((d) => d.operatorFault).map((d) => d.minutes));
}

export function totalDowntimeMin(rec: Pick<ShiftRecord, 'downtime'>): number {
  return sum(rec.downtime.map((d) => d.minutes));
}

/** Planned quantity scaled down to the time the operator could actually run. */
export function adjustedStandardQty(
  rec: Pick<ShiftRecord, 'plannedQty' | 'downtime'>,
  shiftMinutes: number = PQCDSM_PARAMS.shiftMinutes,
): number {
  const available = clamp(shiftMinutes - excludedDowntimeMin(rec), 0, shiftMinutes);
  return (rec.plannedQty * available) / shiftMinutes;
}

/** Productivity % of one shift: actual vs downtime-adjusted standard. */
export function shiftProductivityPct(
  rec: Pick<ShiftRecord, 'plannedQty' | 'actualQty' | 'downtime'>,
  shiftMinutes: number = PQCDSM_PARAMS.shiftMinutes,
): number {
  const std = adjustedStandardQty(rec, shiftMinutes);
  return std > 0 ? (rec.actualQty / std) * 100 : 0;
}

export const rejectedQty = (rec: Pick<ShiftRecord, 'rejections'>) => sum(rec.rejections.map((r) => r.qty));

// ---------------------------------------------------------------------------
// Dimension scores (each 0–100)
// ---------------------------------------------------------------------------

export function productivityScore(productivityPct: number): number {
  return clamp(productivityPct, 0, 100);
}

export function qualityScore(rejectionPct: number, p: Params['quality'] = PQCDSM_PARAMS.quality): number {
  const span = p.zeroScoreRejectionPct - p.targetRejectionPct;
  return clamp(100 * (1 - (rejectionPct - p.targetRejectionPct) / span), 0, 100);
}

export function scrapScore(scrapPct: number, allowancePct: number, p: Params['cost'] = PQCDSM_PARAMS.cost): number {
  if (allowancePct <= 0) return 100;
  const over = (scrapPct - allowancePct) / (allowancePct * (p.scrapZeroMultiple - 1));
  return clamp(100 * (1 - over), 0, 100);
}

export function costScore(scrapPts: number, dieLifePts: number | null, p: Params['cost'] = PQCDSM_PARAMS.cost): number {
  return dieLifePts === null ? scrapPts : p.scrapShare * scrapPts + p.dieLifeShare * dieLifePts;
}

export function safetyScore(
  ppePct: number,
  incidents: number,
  nearMissReports: number,
  p: Params['safety'] = PQCDSM_PARAMS.safety,
): number {
  const incidentPts = p.incidentScores[Math.min(incidents, p.incidentScores.length - 1)];
  const nearMissPts = clamp((nearMissReports / p.nearMissTargetPerMonth) * 100, 0, 100);
  return p.ppeShare * ppePct + p.incidentShare * incidentPts + p.nearMissShare * nearMissPts;
}

export function moraleScore(
  attendancePct: number,
  kaizens: number,
  fiveSAvg: number,
  p: Params['morale'] = PQCDSM_PARAMS.morale,
): number {
  const attendancePts = clamp(((attendancePct - p.attendanceFloorPct) / (100 - p.attendanceFloorPct)) * 100, 0, 100);
  const kaizenPts = clamp((kaizens / p.kaizenTargetPerMonth) * 100, 0, 100);
  return p.attendanceShare * attendancePts + p.kaizenShare * kaizenPts + p.fiveSShare * clamp(fiveSAvg, 0, 100);
}

/** Overall score = role-weighted average of the six dimension scores. */
export function overallScore(
  scores: DimensionScores,
  role: OperatorRole,
  weights: Record<OperatorRole, Record<PqcdsmKey, number>> = PQCDSM_WEIGHTS,
): number {
  const w = weights[role];
  const total = sum(Object.values(w));
  if (total <= 0) return 0;
  return (Object.keys(w) as PqcdsmKey[]).reduce((s, k) => s + scores[k] * w[k], 0) / total;
}

export function gradeFor(overall: number, grades: OperatorGrade[] = OPERATOR_GRADES): OperatorGrade {
  return grades.find((g) => overall >= g.min) ?? grades[grades.length - 1];
}

// ---------------------------------------------------------------------------
// Monthly scorecard
// ---------------------------------------------------------------------------

export interface ScorecardDetail {
  shifts: number;
  plannedQty: number;
  actualQty: number;
  adjustedStandardQty: number;
  productivityPct: number;
  rejectedQty: number;
  rejectionPct: number;
  scrapPct: number;
  scrapAllowancePct: number;
  dieLifePct: number | null;
  shiftsMeetingPlan: number;
  adherencePct: number;
  ppePct: number;
  incidents: number;
  nearMissReports: number;
  attendancePct: number;
  kaizens: number;
  fiveSAvg: number;
  excludedDowntimeMin: number;
  faultDowntimeMin: number;
}

export interface Scorecard {
  operatorId: string;
  month: string;
  scores: DimensionScores;
  overall: number;
  grade: OperatorGrade;
  detail: ScorecardDetail;
}

const EMPTY_INPUT = { attendancePct: 0, kaizens: 0, incidents: 0, nearMissReports: 0 };

/**
 * @param records  every shift record in the month that involves the operator (as operator or crew)
 * @param monthly  HR/EHS inputs for the month (attendance, kaizens, incidents, near-miss register)
 */
export function computeScorecard(args: {
  operatorId: string;
  role: OperatorRole;
  month: string;
  records: ShiftRecord[];
  monthly: Pick<MonthlyInput, 'attendancePct' | 'kaizens' | 'incidents' | 'nearMissReports'> | undefined;
  machines: Record<string, Machine>;
  params?: Params;
}): Scorecard {
  const { operatorId, role, month, records, machines } = args;
  const params = args.params ?? PQCDSM_PARAMS;
  const monthly = args.monthly ?? EMPTY_INPUT;
  const n = records.length;

  const plannedQty = sum(records.map((r) => r.plannedQty));
  const actualQty = sum(records.map((r) => r.actualQty));
  const stdQty = sum(records.map((r) => adjustedStandardQty(r, params.shiftMinutes)));
  const rejQty = sum(records.map(rejectedQty));
  const productivityPct = stdQty > 0 ? (actualQty / stdQty) * 100 : 0;
  const rejectionPct = actualQty > 0 ? (rejQty / actualQty) * 100 : 0;

  // Cost — scrap vs machine allowance, plus die life where a die change was logged.
  let inputKg = 0;
  let scrapKg = 0;
  let allowanceKg = 0;
  for (const r of records) {
    const m = machines[r.machineId];
    const kg = r.actualQty * (m?.pieceWeightKg ?? 0);
    inputKg += kg;
    scrapKg += r.scrapKg;
    allowanceKg += (kg * (m?.scrapAllowancePct ?? 0)) / 100;
  }
  const scrapPct = inputKg > 0 ? (scrapKg / inputKg) * 100 : 0;
  const allowancePct = inputKg > 0 ? (allowanceKg / inputKg) * 100 : 0;
  const dieChanges = records.filter((r) => r.dieChange).map((r) => r.dieChange!);
  const dieLifePct = dieChanges.length
    ? (sum(dieChanges.map((d) => d.strokes)) / sum(dieChanges.map((d) => d.standard))) * 100
    : null;

  // Delivery — share of shifts that met the (downtime-adjusted) plan.
  const meeting = records.filter((r) => {
    const std = adjustedStandardQty(r, params.shiftMinutes);
    return std > 0 && (r.actualQty / std) * 100 >= params.delivery.shiftMeetsPlanPct;
  }).length;
  const adherencePct = n > 0 ? (meeting / n) * 100 : 0;

  // Safety — PPE from shifts; near-miss = EHS register + any logged on shifts the operator ran.
  const ppePct = n > 0 ? (records.filter((r) => r.ppeCompliant).length / n) * 100 : 0;
  const nearMiss =
    monthly.nearMissReports +
    records.filter((r) => r.operatorId === operatorId && r.safetyObs.type === 'Near-miss').length;

  // Morale
  const fiveSAvg = n > 0 ? sum(records.map((r) => r.fiveS)) / n : 0;

  const scores: DimensionScores = {
    P: n ? productivityScore(productivityPct) : 0,
    Q: n ? qualityScore(rejectionPct, params.quality) : 0,
    C: n ? costScore(scrapScore(scrapPct, allowancePct, params.cost), dieLifePct === null ? null : clamp(dieLifePct, 0, 100), params.cost) : 0,
    D: adherencePct,
    S: n ? safetyScore(ppePct, monthly.incidents, nearMiss, params.safety) : 0,
    M: n ? moraleScore(monthly.attendancePct, monthly.kaizens, fiveSAvg, params.morale) : 0,
  };
  (Object.keys(scores) as PqcdsmKey[]).forEach((k) => (scores[k] = r1(scores[k])));
  const overall = r1(overallScore(scores, role));

  return {
    operatorId,
    month,
    scores,
    overall,
    grade: gradeFor(overall),
    detail: {
      shifts: n,
      plannedQty,
      actualQty,
      adjustedStandardQty: Math.round(stdQty),
      productivityPct: r1(productivityPct),
      rejectedQty: rejQty,
      rejectionPct: Math.round(rejectionPct * 100) / 100,
      scrapPct: Math.round(scrapPct * 100) / 100,
      scrapAllowancePct: Math.round(allowancePct * 100) / 100,
      dieLifePct: dieLifePct === null ? null : r1(dieLifePct),
      shiftsMeetingPlan: meeting,
      adherencePct: r1(adherencePct),
      ppePct: r1(ppePct),
      incidents: monthly.incidents,
      nearMissReports: nearMiss,
      attendancePct: monthly.attendancePct,
      kaizens: monthly.kaizens,
      fiveSAvg: r1(fiveSAvg),
      excludedDowntimeMin: sum(records.map(excludedDowntimeMin)),
      faultDowntimeMin: sum(records.map(faultDowntimeMin)),
    },
  };
}
