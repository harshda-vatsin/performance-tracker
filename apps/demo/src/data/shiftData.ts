import type {
  DefectType,
  DowntimeReason,
  Machine,
  MachineType,
  MonthlyInput,
  Operator,
  SafetyObsType,
  Shift,
  ShiftRecord,
} from '../types';
import { clamp, mulberry32, normal, pickWeighted } from '../utils/prng';
import { DEFECT_TYPES, HOLIDAYS } from '../config/floor.config';
import { MACHINES, MACHINE_MAP } from './org';
import { OPERATORS, STAR_OPERATOR_ID, WEAK_OPERATOR_ID, skillFactor } from './operators';

const SUPERVISORS = { P1: 'Palaniappan Shanmugam', P2: 'Raghunath Krishnan', P3: 'Selvaraj Manickam' } as const;

const START = '2026-08-01';
const END = '2026-10-21'; // "today" (22 Oct) is left open for live shift entry in the demo

/** Plant shutdowns: Independence Day, Gandhi Jayanti, Ayudha Pooja, Vijayadashami. Sundays are off too. */

type Downtime = ShiftRecord['downtime'][number];

/** The "bad days": breakdowns and a power cut that are NOT the operators' fault. */
const INJECTED: { date: string; machines: string[]; shifts: Shift[]; reason: DowntimeReason; minutes: number }[] = [
  { date: '2026-08-19', machines: ['M01'], shifts: ['A'], reason: 'Breakdown', minutes: 300 }, // clutch failure, 2500 T press
  { date: '2026-08-19', machines: ['M01'], shifts: ['B'], reason: 'Breakdown', minutes: 240 },
  { date: '2026-09-09', machines: ['M05', 'M06', 'M10'], shifts: ['B'], reason: 'Power Cut', minutes: 150 }, // Singampunari grid trip
  { date: '2026-09-23', machines: ['M05'], shifts: ['A'], reason: 'Breakdown', minutes: 420 }, // flywheel clutch, 4000 T press
  { date: '2026-09-23', machines: ['M05'], shifts: ['B'], reason: 'Breakdown', minutes: 240 },
  { date: '2026-10-07', machines: ['M09'], shifts: ['A'], reason: 'Breakdown', minutes: 240 }, // IF-1 coil fault
  { date: '2026-10-07', machines: ['M01', 'M02'], shifts: ['A'], reason: 'Material Shortage', minutes: 170 }, // starved by IF-1
  { date: '2026-10-07', machines: ['M03', 'M04'], shifts: ['A'], reason: 'Material Shortage', minutes: 150 },
  { date: '2026-10-14', machines: ['M03'], shifts: ['A'], reason: 'Breakdown', minutes: 360 }, // hammer piston-rod seal
  { date: '2026-10-14', machines: ['M03'], shifts: ['B'], reason: 'Breakdown', minutes: 120 },
];

const DEFECT_WEIGHTS: Record<MachineType, Record<DefectType, number>> = {
  press: { Underfill: 3, 'Lap / Fold': 3, Mismatch: 2, Crack: 1.5, 'Scale Pit': 2 },
  hammer: { Underfill: 2, 'Lap / Fold': 3, Mismatch: 4, Crack: 1, 'Scale Pit': 2.5 },
  trimmer: { Underfill: 0.5, 'Lap / Fold': 1, Mismatch: 4, Crack: 2, 'Scale Pit': 0.5 },
  furnace: { Underfill: 1, 'Lap / Fold': 0.5, Mismatch: 0.2, Crack: 3, 'Scale Pit': 6 },
};

const BASE_REJECTION_PCT: Record<MachineType, number> = { press: 2.4, hammer: 3.0, trimmer: 1.8, furnace: 1.2 };

/** Time-varying defect pressure so the rejection trend chart tells a story. */
function defectTimeMultiplier(defect: DefectType, date: string): number {
  if (defect === 'Scale Pit' && date <= '2026-08-16') return 1.7; // descaling water-jet issue, fixed mid-Aug
  if (defect === 'Lap / Fold') {
    if (date >= '2026-09-07' && date <= '2026-09-27') return 2.0; // die wear on hammer/press dies
    if (date >= '2026-10-01') return 0.75; // after die refurbishment
  }
  if (defect === 'Underfill' && date >= '2026-09-21' && date <= '2026-09-27') return 1.5; // billet temperature drift
  return 1;
}

const OBS_NOTES: Record<Exclude<SafetyObsType, 'None' | 'Near-miss'>, string[]> = {
  'Good practice': [
    'Operator used tongs rack and cooled billets before handling',
    'Die lubrication spray done only after ram parked and guard closed',
    'Housekeeping around scale pit kept clear throughout shift',
  ],
  'Unsafe act': [
    'Scale blown from die cavity without face shield',
    'Billet picked with tongs while ram not in safe position',
    'Guard interlock bypassed briefly during die touch-up',
  ],
  'Unsafe condition': [
    'Oil leak near press foundation — wiped and reported',
    'Cracked billet-tray handle replaced',
    'Insufficient lighting at trimming station',
  ],
};
const NOTE_PICK = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

function* eachDate(start: string, end: string) {
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

function crewFor(plantId: Operator['plantId'], shift: Shift) {
  const find = (role: Operator['role']) =>
    OPERATORS.find((o) => o.plantId === plantId && o.role === role && o.shift === shift);
  return { dieSetter: find('Die Setter'), helper: find('Helper'), inspector: find('Inspector') };
}

export function generateShiftData(): { records: ShiftRecord[]; monthly: MonthlyInput[] } {
  const rand = mulberry32(20260801);
  const records: ShiftRecord[] = [];
  const machineOps = OPERATORS.filter((o) => o.machineId);
  let seq = 1;

  for (const date of eachDate(START, END)) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || HOLIDAYS.has(date)) continue;
    const monthIdx = Number(date.slice(5, 7)) - 8;

    for (const op of machineOps) {
      const machine: Machine = MACHINE_MAP[op.machineId!];
      const shift = op.shift!;
      let skill = skillFactor(op) + (op.employment === 'Trainee' ? 0.03 * monthIdx : 0);
      skill = clamp(skill, 0.6, 1.25);

      // --- downtime -------------------------------------------------------
      const downtime: Downtime[] = [];
      const careless = skill < 0.85;
      if (machine.type !== 'furnace' && rand() < 0.28) {
        downtime.push({
          reason: 'Die Change',
          minutes: round(clamp(normal(rand, 42, 10), 20, 90)),
          operatorFault: rand() < (careless ? 0.18 : 0.02),
        });
      }
      if (rand() < 0.07) {
        downtime.push({ reason: 'Breakdown', minutes: round(15 + rand() * 55), operatorFault: rand() < (careless ? 0.2 : 0.03) });
      }
      if (rand() < 0.045) downtime.push({ reason: 'Material Shortage', minutes: round(10 + rand() * 35), operatorFault: false });
      if (rand() < 0.015) downtime.push({ reason: 'Power Cut', minutes: round(8 + rand() * 22), operatorFault: false });
      for (const inj of INJECTED) {
        if (inj.date === date && inj.machines.includes(machine.id) && inj.shifts.includes(shift)) {
          downtime.push({ reason: inj.reason, minutes: inj.minutes, operatorFault: false });
        }
      }
      const allDt = Math.min(
        470,
        downtime.reduce((s, d) => s + d.minutes, 0),
      );

      // --- crew & output --------------------------------------------------
      const crew = crewFor(op.plantId, shift);
      const crewSkills = [crew.dieSetter, crew.helper, crew.inspector].filter(Boolean).map((c) => skillFactor(c!));
      const crewAvg = crewSkills.length ? crewSkills.reduce((s, n) => s + n, 0) / crewSkills.length : 1;
      const ratio = clamp(skill * 0.94 + normal(rand, 0, 0.035), 0.55, 1.08) * (1 + 0.15 * (crewAvg - 1));
      const planned = machine.plannedQty;
      const actual = Math.max(0, round((planned * (480 - allDt)) / 480 * ratio));

      // --- rejections -----------------------------------------------------
      const ratePct = (BASE_REJECTION_PCT[machine.type] / Math.pow(skill, 2.2)) * Math.exp(normal(rand, 0, 0.25));
      const rejTotal = Math.min(actual, Math.max(0, round((actual * ratePct) / 100)));
      const weights = DEFECT_TYPES.map((d) => ({
        item: d,
        weight: DEFECT_WEIGHTS[machine.type][d] * defectTimeMultiplier(d, date),
      }));
      const counts = new Map<DefectType, number>();
      for (let i = 0; i < rejTotal; i++) {
        const d = pickWeighted(rand, weights);
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      const rejections = DEFECT_TYPES.filter((d) => counts.has(d)).map((d) => ({ defect: d, qty: counts.get(d)! }));

      // --- cost -----------------------------------------------------------
      const inputKg = actual * machine.pieceWeightKg;
      const scrapPct = (machine.scrapAllowancePct * 1.05) / Math.pow(skill, 1.6) * Math.exp(normal(rand, 0, 0.1));
      const scrapKg = round((inputKg * scrapPct) / 100, 1);
      const hadDieChange = downtime.some((d) => d.reason === 'Die Change');
      const dieChange =
        hadDieChange && machine.standardDieLife
          ? {
              standard: machine.standardDieLife,
              strokes: round(machine.standardDieLife * clamp(normal(rand, 0.92 * Math.pow(skill, 0.7), 0.07), 0.5, 1.15)),
            }
          : undefined;

      // --- safety & 5S ----------------------------------------------------
      const ppeCompliant = rand() < clamp(0.985 - (1 - skill) * 0.9, 0.5, 0.995);
      const fiveS = round(clamp(80 + (skill - 1) * 70 + normal(rand, 0, 5), 30, 100));
      const u = rand();
      let obsType: Exclude<SafetyObsType, 'Near-miss'> = 'None'; // near-miss reports come from the monthly EHS register
      if (u < 0.03) obsType = 'Good practice';
      else if (u < 0.045) obsType = 'Unsafe condition';
      else if (u < 0.045 + (careless ? 0.05 : 0.012)) obsType = 'Unsafe act';
      const note = obsType === 'None' ? '' : NOTE_PICK(rand, OBS_NOTES[obsType]);

      records.push({
        id: `sh-${String(seq++).padStart(5, '0')}`,
        date,
        shift,
        plantId: machine.plantId,
        lineId: machine.lineId,
        machineId: machine.id,
        operatorId: op.id,
        product: machine.products[Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 604800000) % machine.products.length],
        crew: { dieSetterId: crew.dieSetter?.id, helperId: crew.helper?.id, inspectorId: crew.inspector?.id },
        plannedQty: planned,
        actualQty: actual,
        rejections,
        downtime,
        safetyObs: { type: obsType, note },
        ppeCompliant,
        fiveS,
        scrapKg,
        dieChange,
        enteredBy: SUPERVISORS[machine.plantId],
      });
    }
  }

  // --- monthly HR / EHS inputs -----------------------------------------------
  const monthly: MonthlyInput[] = [];
  const mRand = mulberry32(777);
  for (const op of OPERATORS) {
    const skill = skillFactor(op);
    ['2026-08', '2026-09', '2026-10'].forEach((month, mi) => {
      let attendancePct = round(clamp(97.5 + (skill - 1) * 30 + normal(mRand, 0, 1.4), 78, 100), 1);
      let kaizens = Math.max(0, Math.floor((skill - 0.85) * 7 + mRand() * 1.3));
      let incidents = mRand() < 0.03 ? 1 : 0;
      let nearMissReports = Math.floor(mRand() * 1.9 * (skill > 1.05 ? 1.4 : 1));
      if (op.id === STAR_OPERATOR_ID) {
        attendancePct = 100;
        kaizens = [3, 4, 3][mi];
        incidents = 0;
        nearMissReports = 2;
      }
      if (op.id === WEAK_OPERATOR_ID) {
        attendancePct = [86, 82, 88][mi];
        kaizens = 0;
        incidents = mi === 1 ? 1 : 0;
        nearMissReports = 0;
      }
      monthly.push({ operatorId: op.id, month, attendancePct, kaizens, incidents, nearMissReports });
    });
  }

  return { records, monthly };
}

const generated = generateShiftData();
export const SEED_SHIFT_RECORDS: ShiftRecord[] = generated.records;
export const SEED_MONTHLY_INPUTS: MonthlyInput[] = generated.monthly;
export const MACHINE_COUNT = MACHINES.length;
