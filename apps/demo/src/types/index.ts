import type { RatingKey } from '../config/scoring.config';

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------
export type RoleKey = 'employee' | 'manager' | 'hr' | 'management' | 'supervisor';
export type PageKey =
  | 'overview'
  | 'dashboard'
  | 'kra'
  | 'goals'
  | 'appraisals'
  | 'shift'
  | 'scorecards'
  | 'skills'
  | 'reports';

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------
export type PlantId = 'P1' | 'P2' | 'P3';
export type Shift = 'A' | 'B' | 'C';
export type MachineType = 'press' | 'hammer' | 'trimmer' | 'furnace';

export interface Plant {
  id: PlantId;
  name: string;
  city: string;
  /** Multiplier applied to volume-type KPI targets (tonnage) for this plant. */
  volumeScale: number;
}

export interface Line {
  id: string;
  plantId: PlantId;
  name: string;
  /** Product types forged on this line. */
  products: string[];
}

export interface Machine {
  id: string;
  lineId: string;
  plantId: PlantId;
  name: string;
  type: MachineType;
  tonnage?: number;
  /** Product types run on this machine (alternate week by week). */
  products: string[];
  shifts: Shift[];
  /** Planned pieces per 8-hour shift. */
  plannedQty: number;
  pieceWeightKg: number;
  /** Standard scrap allowance as % of input weight (flash, end-cut, scale). */
  scrapAllowancePct: number;
  /** Standard die life in strokes (null for furnaces). */
  standardDieLife: number | null;
}

// ---------------------------------------------------------------------------
// Track A
// ---------------------------------------------------------------------------
export type Direction = 'higher' | 'lower';
export type KpiSource = 'SAP' | 'Manual';
export type Department = 'Management' | 'Production' | 'Quality' | 'Maintenance' | 'Die Shop' | 'HR';
export type SeniorRole =
  | 'Plant Head'
  | 'Production Manager'
  | 'Quality Manager'
  | 'Maintenance Manager'
  | 'Die Shop Manager'
  | 'HR Manager';

export interface KpiDef {
  key: string;
  name: string;
  unit: string;
  direction: Direction;
  source: KpiSource;
  sapModule?: string;
  decimals: number;
}

export interface Kra {
  id: string;
  department: Department;
  role: SeniorRole;
  /** Key result area heading, e.g. "Production Volume". */
  area: string;
  kpiKey: string;
  kpi: string;
  unit: string;
  weightage: number;
  target: number;
  direction: Direction;
  source: KpiSource;
}

export interface Employee {
  id: string;
  empCode: string;
  name: string;
  role: SeniorRole;
  department: Department;
  plantId: PlantId;
  managerId: string | null;
  managerName: string;
  reviewerName: string;
  joined: string;
}

export interface GoalItem {
  kraId: string;
  area: string;
  kpiKey: string;
  kpi: string;
  unit: string;
  direction: Direction;
  source: KpiSource;
  weightage: number;
  target: number;
}

export type GoalStatus = 'Draft' | 'Awaiting acknowledgement' | 'Acknowledged';

export interface GoalSheet {
  employeeId: string;
  cycleId: string;
  status: GoalStatus;
  items: GoalItem[];
  assignedBy: string;
  assignedOn: string;
  acknowledgedOn?: string;
  acknowledgementNote?: string;
}

export type AppraisalStatus =
  | 'Not started'
  | 'Self-assessment'
  | 'Manager assessment'
  | 'Reviewer sign-off'
  | 'HR finalisation'
  | 'Finalised';

export type StageKey = 'self' | 'manager' | 'reviewer' | 'hr';

export interface Actual {
  value: number;
  source: KpiSource;
  /** ISO timestamp of last SAP sync (SAP-sourced KPIs only). */
  lastSynced?: string;
}

export interface StageComment {
  stage: StageKey | 'returned';
  author: string;
  at: string;
  text: string;
}

export interface Appraisal {
  employeeId: string;
  cycleId: string;
  period: string;
  status: AppraisalStatus;
  actuals: Record<string, Actual>;
  comments: StageComment[];
  finalScore?: number;
  finalRating?: RatingKey;
  incrementPct?: number;
}

export interface HistoryEntry {
  employeeId: string;
  cycle: string;
  score: number;
  rating: RatingKey;
}

// ---------------------------------------------------------------------------
// Track B
// ---------------------------------------------------------------------------
export type PqcdsmKey = 'P' | 'Q' | 'C' | 'D' | 'S' | 'M';
export type EmploymentType = 'Permanent' | 'Contract' | 'Trainee';
export type OperatorRole =
  | 'Hammer Operator'
  | 'Press Operator'
  | 'Die Setter'
  | 'Furnace Operator'
  | 'Trimmer'
  | 'Helper'
  | 'Inspector';

export type DefectType = 'Underfill' | 'Lap / Fold' | 'Mismatch' | 'Crack' | 'Scale Pit';
export type DowntimeReason = 'Breakdown' | 'Die Change' | 'Material Shortage' | 'Power Cut';
export type SafetyObsType = 'None' | 'Near-miss' | 'Unsafe act' | 'Unsafe condition' | 'Good practice';

export interface Operator {
  id: string;
  empCode: string;
  name: string;
  role: OperatorRole;
  employment: EmploymentType;
  plantId: PlantId;
  /** Rostered machine (machine operators only). */
  machineId?: string;
  shift?: Shift;
  tenureYears: number;
}

export interface ShiftRecord {
  id: string;
  date: string;
  shift: Shift;
  plantId: PlantId;
  lineId: string;
  machineId: string;
  operatorId: string;
  /** Product type forged / processed in this shift. */
  product: string;
  crew: { dieSetterId?: string; helperId?: string; inspectorId?: string };
  plannedQty: number;
  actualQty: number;
  rejections: { defect: DefectType; qty: number }[];
  downtime: { reason: DowntimeReason; minutes: number; operatorFault: boolean }[];
  safetyObs: { type: SafetyObsType; note: string };
  ppeCompliant: boolean;
  fiveS: number;
  scrapKg: number;
  dieChange?: { strokes: number; standard: number };
  enteredBy: string;
}

export interface MonthlyInput {
  operatorId: string;
  month: string;
  attendancePct: number;
  kaizens: number;
  incidents: number;
  nearMissReports: number;
}

/** 0 = not assessed, 1 = in training … 4 = can train others. */
export type SkillLevel = 0 | 1 | 2 | 3 | 4;
export type SkillMap = Record<string, Record<string, SkillLevel>>;

export interface PlantMonthlyKpi {
  plantId: PlantId;
  month: string;
  powerCostPerTonne: number;
  otifPct: number;
}
