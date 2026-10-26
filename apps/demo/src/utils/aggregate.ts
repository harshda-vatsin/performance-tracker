/** Floor-level roll-ups over shift records (plain functions, no React). */
import { DEFECT_TYPES } from '../config/floor.config';
import { PQCDSM_PARAMS } from '../config/scoring.config';
import type { DefectType, Machine, MonthlyInput, Operator, PlantId, Shift, ShiftRecord } from '../types';
import { monthOf } from './format';
import {
  adjustedStandardQty,
  computeScorecard,
  rejectedQty,
  totalDowntimeMin,
  type Scorecard,
} from './operatorScoring';

const sum = (xs: number[]) => xs.reduce((s, n) => s + n, 0);

export interface RecordFilter {
  month?: string;
  plantId?: PlantId | 'all';
  lineId?: string;
  shift?: Shift;
}

export function filterRecords(records: ShiftRecord[], f: RecordFilter): ShiftRecord[] {
  return records.filter(
    (r) =>
      (!f.month || monthOf(r.date) === f.month) &&
      (!f.plantId || f.plantId === 'all' || r.plantId === f.plantId) &&
      (!f.lineId || r.lineId === f.lineId) &&
      (!f.shift || r.shift === f.shift),
  );
}

export interface SliceStats {
  shifts: number;
  plannedQty: number;
  actualQty: number;
  rejectedQty: number;
  downtimeMin: number;
  /** Actual vs downtime-adjusted standard. */
  productivityPct: number;
  /** Actual vs raw plan (shows the full cost of stoppages). */
  outputVsPlanPct: number;
  rejectionPct: number;
  /** Good pieces vs downtime-adjusted standard — the leaderboard ranking metric. */
  goodVsStdPct: number;
  ppePct: number;
  /** Press + hammer only (the forging machines). */
  tonnes: number;
  oeePct: number;
  yieldPct: number;
}

export function summarise(records: ShiftRecord[], machines: Record<string, Machine>): SliceStats {
  const n = records.length;
  const planned = sum(records.map((r) => r.plannedQty));
  const actual = sum(records.map((r) => r.actualQty));
  const rejected = sum(records.map(rejectedQty));
  const std = sum(records.map((r) => adjustedStandardQty(r)));
  const down = sum(records.map(totalDowntimeMin));

  const forging = records.filter((r) => {
    const t = machines[r.machineId]?.type;
    return t === 'press' || t === 'hammer';
  });
  let goodKg = 0;
  let scrapKg = 0;
  let rejKg = 0;
  for (const r of forging) {
    const wt = machines[r.machineId].pieceWeightKg;
    goodKg += (r.actualQty - rejectedQty(r)) * wt;
    rejKg += rejectedQty(r) * wt;
    scrapKg += r.scrapKg;
  }
  const fMinutes = forging.length * PQCDSM_PARAMS.shiftMinutes;
  const fDown = sum(forging.map(totalDowntimeMin));
  const fPlanRun = sum(forging.map((r) => (r.plannedQty * (PQCDSM_PARAMS.shiftMinutes - totalDowntimeMin(r))) / PQCDSM_PARAMS.shiftMinutes));
  const fActual = sum(forging.map((r) => r.actualQty));
  const fGood = sum(forging.map((r) => r.actualQty - rejectedQty(r)));
  const availability = fMinutes > 0 ? (fMinutes - fDown) / fMinutes : 0;
  const performance = fPlanRun > 0 ? fActual / fPlanRun : 0;
  const quality = fActual > 0 ? fGood / fActual : 0;

  return {
    shifts: n,
    plannedQty: planned,
    actualQty: actual,
    rejectedQty: rejected,
    downtimeMin: down,
    productivityPct: std > 0 ? (actual / std) * 100 : 0,
    outputVsPlanPct: planned > 0 ? (actual / planned) * 100 : 0,
    rejectionPct: actual > 0 ? (rejected / actual) * 100 : 0,
    goodVsStdPct: std > 0 ? ((actual - rejected) / std) * 100 : 0,
    ppePct: n > 0 ? (records.filter((r) => r.ppeCompliant).length / n) * 100 : 0,
    tonnes: goodKg / 1000,
    oeePct: availability * Math.min(performance, 1.2) * quality * 100,
    yieldPct: goodKg + rejKg + scrapKg > 0 ? (goodKg / (goodKg + rejKg + scrapKg)) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Rejection trend
// ---------------------------------------------------------------------------
export type WeeklyRejection = { week: string; start: string; total: number } & Record<DefectType, number>;

function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weeklyRejections(records: ShiftRecord[]): WeeklyRejection[] {
  const byWeek = new Map<string, WeeklyRejection>();
  for (const r of records) {
    const start = weekStart(r.date);
    let row = byWeek.get(start);
    if (!row) {
      const [, m, d] = start.split('-').map(Number);
      row = { week: `${d} ${SHORT_MONTH[m - 1]}`, start, total: 0 } as WeeklyRejection;
      DEFECT_TYPES.forEach((t) => (row![t] = 0));
      byWeek.set(start, row);
    }
    for (const rej of r.rejections) {
      row[rej.defect] += rej.qty;
      row.total += rej.qty;
    }
  }
  return Array.from(byWeek.values()).sort((a, b) => a.start.localeCompare(b.start));
}

// ---------------------------------------------------------------------------
// Notable stoppages (the "bad days")
// ---------------------------------------------------------------------------
export interface Stoppage {
  date: string;
  machineId: string;
  plantId: PlantId;
  minutes: number;
  reason: string;
}

export function notableStoppages(records: ShiftRecord[], minMinutes = 240, limit = 6): Stoppage[] {
  const byKey = new Map<string, Stoppage & { reasons: Record<string, number> }>();
  for (const r of records) {
    const mins = totalDowntimeMin(r);
    if (mins === 0) continue;
    const key = `${r.date}|${r.machineId}`;
    const cur = byKey.get(key) ?? { date: r.date, machineId: r.machineId, plantId: r.plantId, minutes: 0, reason: '', reasons: {} };
    cur.minutes += mins;
    for (const d of r.downtime) cur.reasons[d.reason] = (cur.reasons[d.reason] ?? 0) + d.minutes;
    byKey.set(key, cur);
  }
  return Array.from(byKey.values())
    .filter((s) => s.minutes >= minMinutes)
    .map((s) => ({
      date: s.date,
      machineId: s.machineId,
      plantId: s.plantId,
      minutes: s.minutes,
      reason: Object.entries(s.reasons).sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.minutes - a.minutes)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------------------
/** Scorecards for every operator for one month. A shift counts for the operator and for each crew member. */
export function buildScorecards(
  month: string,
  records: ShiftRecord[],
  operators: Operator[],
  monthly: MonthlyInput[],
  machines: Record<string, Machine>,
): Scorecard[] {
  const idx = new Map<string, ShiftRecord[]>();
  const push = (id: string | undefined, r: ShiftRecord) => {
    if (!id) return;
    const arr = idx.get(id);
    if (arr) arr.push(r);
    else idx.set(id, [r]);
  };
  for (const r of records) {
    if (monthOf(r.date) !== month) continue;
    push(r.operatorId, r);
    push(r.crew.dieSetterId, r);
    push(r.crew.helperId, r);
    push(r.crew.inspectorId, r);
  }
  return operators.map((op) =>
    computeScorecard({
      operatorId: op.id,
      role: op.role,
      month,
      records: idx.get(op.id) ?? [],
      monthly: monthly.find((m) => m.operatorId === op.id && m.month === month),
      machines,
    }),
  );
}
