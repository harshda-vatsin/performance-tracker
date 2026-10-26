/** Response shapes of the Fastify API (apps/api/src/routes). Only the fields the portal reads. */

export interface Me {
  user: { userId: string; loginId: string; fullName: string };
  roles: { code: string; scopeType: string; scopePath: string | null }[];
  permissions: string[];
}

export interface OrgUnit {
  id: string;
  code: string;
  name: string;
  unitType: 'COMPANY' | 'PLANT' | 'DEPARTMENT' | 'CELL';
  path: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  mobile: string | null;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  unitCode: string | null;
  unitName: string | null;
  category: string | null;
  designation: string | null;
  grade: string | null;
}

export type Direction = 'HIGHER_BETTER' | 'LOWER_BETTER';

export interface Kpi {
  id: string;
  code: string;
  nameEn: string;
  nameTa: string | null;
  pqcdsm: string;
  direction: Direction;
  unit: string;
  description: string | null;
  active: boolean;
}

export interface TemplateHead {
  id: string;
  plantTypeId: string;
  plantTypeCode: string;
  name: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  makerId: string;
  checkerId: string | null;
  activatedAt: string | null;
}

export interface TemplateRow {
  id: string;
  plantTypeCode: string;
  name: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  kraCount: number;
  activatedAt: string | null;
}

export interface Level {
  id: string;
  code: string;
  nameEn: string;
  rank: number;
}

export interface Kra {
  id?: string;
  kpiId: string | null;
  nameEn: string;
  nameTa: string | null;
  pqcdsm: string;
  direction: Direction;
  unit: string;
  presentLevel: number;
  targets: number[];
  weights: Record<string, number>;
}

export interface Issue {
  code: string;
  message: string;
  level?: string;
  kra?: string;
}

export interface Validation {
  errors: Issue[];
  warnings: Issue[];
}

export interface ScorecardRow {
  id: string;
  orgUnitId: string;
  unitCode: string;
  fiscalYear: number;
  sourceTemplateId: string;
}

export interface ScorecardKra {
  id: string;
  nameEn: string;
  pqcdsm: string;
  direction: Direction;
  unit: string;
  presentLevel: number;
  targets: number[];
  weights: Record<string, number>;
}

export interface ChangeRequest {
  id: string;
  effectivePeriod: string;
  reason: string;
  /** `nameEn` and `before` come from the version the change was proposed against (null if that KRA no longer resolves). */
  changes: { kraId: string; nameEn: string | null; before: { presentLevel: number; targets: number[] } | null; presentLevel?: number; targets?: number[] }[];
  state: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionComment: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export type SubState = 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'LOCKED' | 'REOPENED';

export interface SubmissionRow {
  id: string;
  orgUnitId: string;
  unitCode: string;
  period: string;
  state: SubState;
  revision: number;
}

export interface ResultRow {
  resultId: string;
  kraId: string;
  nameEn: string;
  pqcdsm: string;
  direction: Direction;
  unit: string;
  presentLevel: number;
  target: number;
  result: number | null;
  naReason: string | null;
  remarks: string | null;
}

export interface WorkflowEvent {
  revision: number;
  fromState: string;
  toState: string;
  actor: string;
  comment: string | null;
  at: string;
}

export interface SubmissionDetail {
  submission: SubmissionRow;
  results: ResultRow[];
  levelAssignments: { employeeCode: string; fullName: string; levelCode: string; daysInUnit: number }[];
  events: WorkflowEvent[];
}

export interface Preview {
  official: boolean;
  state: SubState;
  kras: { resultId: string; raw: number | null; final: number | null; flags: string[] }[];
  levels: { levelCode: string; score: number | null; flags: string[] }[];
  employees: { employeeId: string; levelCode: string; days: number; score: number | null }[];
}

export interface OfficialScores {
  official: true;
  run: { id: string; revision: number; engineVersion: string; inputHash: string; ranAt: string };
  kras: { nameEn: string; raw: number | null; final: number | null; flags: string[] }[];
  levels: { levelCode: string; score: number | null; flags: string[] }[];
  employees: { employeeCode: string; fullName: string; levelCode: string; days: number; score: number | null }[];
}

export interface PlantBoard {
  plantId: string;
  period: string;
  units: {
    orgUnitId: string;
    unitCode: string;
    submissionId: string | null;
    state: SubState | 'NOT_STARTED';
    revision: number | null;
    levels: { levelCode: string; score: number | null }[];
  }[];
  summary: Record<string, number>;
}

export interface UnitTrend {
  orgUnitId: string;
  unitCode: string;
  fiscalYear: number;
  levels: {
    levelCode: string;
    months: { period: string; score: number | null }[];
    quarters: { quarter: number; score: number | null; monthsCounted: number }[];
    year: { score: number | null; quartersCounted: number };
  }[];
}

export interface Management {
  period: string;
  plantTypes: {
    code: string;
    plants: { plantId: string; code: string; unitsTotal: number; unitsLocked: number; levels: { levelCode: string; score: number | null }[] }[];
  }[];
}

export interface ReopenRequest {
  id: string;
  submissionId: string;
  unitCode: string;
  period: string;
  reason: string;
  state: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedAt: string;
}

export interface AdminUser {
  id: string;
  loginId: string;
  employeeCode: string;
  fullName: string;
  mobile: string | null;
  status: string;
  authMode: string;
}
