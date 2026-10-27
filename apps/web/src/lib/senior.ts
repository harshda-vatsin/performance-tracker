/** Response shapes and labels for the senior-staff (Module A) screens; mirrors apps/api/src/senior/service.ts. */

export type CycleState =
  | 'GOALS_DRAFT'
  | 'PENDING_ACK'
  | 'ACKNOWLEDGED'
  | 'SELF_ASSESSMENT'
  | 'MANAGER_ASSESSMENT'
  | 'REVIEWER_REVIEW'
  | 'HR_FINALISATION'
  | 'FINALISED';

export const STATE_LABEL: Record<CycleState, string> = {
  GOALS_DRAFT: 'Goals being drafted',
  PENDING_ACK: 'Awaiting acknowledgement',
  ACKNOWLEDGED: 'In progress',
  SELF_ASSESSMENT: 'Self-assessment',
  MANAGER_ASSESSMENT: 'Manager assessment',
  REVIEWER_REVIEW: 'With reviewer',
  HR_FINALISATION: 'With Corporate HR',
  FINALISED: 'Finalised',
};

/** Lifecycle order, used by the status board. */
export const STATE_ORDER = Object.keys(STATE_LABEL) as CycleState[];

export interface BandRef {
  code: string | null;
  label: string | null;
}

export interface CycleRow {
  id: string;
  fiscalYear: number;
  state: CycleState;
  goalVersion: number;
  employeeCode: string;
  employeeName: string;
  managerName: string;
  reviewerName: string | null;
  plantCode: string | null;
  score: number | null;
  band: BandRef | null;
  provisional: boolean;
  pendingOn: string;
  monthsConfirmed: number;
  lastActionAt: string | null;
}

export interface SeniorKpi {
  id: string;
  nameEn: string;
  unit: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  presentLevel: number;
  targets: number[];
  weight: number;
}
export interface SeniorKra {
  id: string;
  nameEn: string;
  description: string | null;
  weight: number;
  kpis: SeniorKpi[];
}

export interface MonthKpi {
  kpiId: string;
  target: number;
  presentLevel: number;
  result: number | null;
  naReason: string | null;
  remarks: string | null;
  score: number | null;
  flags: string[];
}
export interface MonthView {
  period: string;
  state: 'DRAFT' | 'CONFIRMED';
  confirmedAt: string | null;
  total: number | null;
  kras: { kraId: string; score: number | null }[];
  kpis: MonthKpi[];
}

export interface RollupView {
  quarters: { quarter: 1 | 2 | 3 | 4; score: number | null; monthsCounted: number }[];
  year: { score: number | null; quartersCounted: number };
}

export interface CycleDetail {
  cycle: {
    id: string;
    fiscalYear: number;
    state: CycleState;
    pendingOn: string;
    goalVersion: number;
    acknowledgedAt: string | null;
    acknowledgedVersion: number | null;
    revision: number;
    employee: { code: string; name: string };
    manager: { name: string };
    reviewer: { name: string } | null;
    final: { score: number | null; band: BandRef | null; finalisedAt: string; finalisedBy: string } | null;
  };
  viewer: {
    roles: string[];
    actions: string[];
    canEditGoals: boolean;
    canEnterResults: boolean;
    assessmentStage: 'SELF' | 'MANAGER' | null;
  };
  goals: { kras: SeniorKra[]; issues: string[] };
  months: MonthView[];
  rollup: { total: RollupView; kras: Record<string, RollupView> };
  score: number | null;
  band: BandRef | null;
  provisional: boolean;
  bands: { code: string; label: string; minScore: number }[];
  assessments: { stage: 'SELF' | 'MANAGER'; summary: string; kraComments: Record<string, string>; submittedAt: string | null; author: string }[];
  events: { revision: number; fromState: CycleState; toState: CycleState; actor: string; comment: string | null; at: string }[];
}

export interface Person {
  userId: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
}
export interface People {
  employees: Person[];
  managers: Person[];
  reviewers: Person[];
}

export const quarterOf = (period: string): 1 | 2 | 3 | 4 => {
  const m = Number(period.slice(5));
  return m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
};

export const DIRECTION_LABEL = { HIGHER_BETTER: 'Higher is better', LOWER_BETTER: 'Lower is better' } as const;
