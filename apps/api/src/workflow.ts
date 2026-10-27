/**
 * Configurable approval steps (migration 007). Corporate HR switches the optional steps on or off; the state machines
 * keep every step and skip the ones that are off. Pure helpers here, so the routes and the tests share one definition.
 */
import type { Db } from './db.js';

export interface WorkflowSettings {
  /** Shop-floor month: the HOD verifies a submitted month. */
  monthlyHodVerify: boolean;
  /** Shop-floor month: the Plant Head approves before Corporate HR locks. */
  monthlyPlantHeadApprove: boolean;
  /** Senior appraisal: a reviewer signs off between the manager and HR. */
  seniorReviewerStep: boolean;
}

export const SETTING_KEYS: Record<keyof WorkflowSettings, string> = {
  monthlyHodVerify: 'monthly.hod_verify',
  monthlyPlantHeadApprove: 'monthly.plant_head_approve',
  seniorReviewerStep: 'senior.reviewer_step',
};

export const DEFAULT_SETTINGS: WorkflowSettings = { monthlyHodVerify: false, monthlyPlantHeadApprove: false, seniorReviewerStep: false };

export async function loadWorkflowSettings(db: Db): Promise<WorkflowSettings> {
  const { rows } = await db.query('SELECT key, enabled FROM core.workflow_setting');
  const on = new Map(rows.map((r: { key: string; enabled: boolean }) => [r.key, r.enabled]));
  const get = (k: keyof WorkflowSettings) => on.get(SETTING_KEYS[k]) ?? DEFAULT_SETTINGS[k];
  return { monthlyHodVerify: get('monthlyHodVerify'), monthlyPlantHeadApprove: get('monthlyPlantHeadApprove'), seniorReviewerStep: get('seniorReviewerStep') };
}

export type MonthState = 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'LOCKED' | 'REOPENED';
export type ReviewAction = 'verify' | 'approve' | 'lock';

/** Position of each state on the way to LOCKED. A submission only ever moves forward past the steps that are on. */
const STATE_POSITION: Partial<Record<MonthState, number>> = { SUBMITTED: 0, VERIFIED: 1, APPROVED: 2 };

const STEPS: { action: ReviewAction; to: MonthState; position: number; permission: string; on: (s: WorkflowSettings) => boolean }[] = [
  { action: 'verify', to: 'VERIFIED', position: 1, permission: 'submissions:verify', on: (s) => s.monthlyHodVerify },
  { action: 'approve', to: 'APPROVED', position: 2, permission: 'submissions:approve', on: (s) => s.monthlyPlantHeadApprove },
  { action: 'lock', to: 'LOCKED', position: 3, permission: 'submissions:lock', on: () => true },
];

/**
 * The review step a submission in `state` waits for: the first step after it that is switched on (lock is always on).
 * A month already past a step that was later switched off simply moves on, so flipping a setting never strands a month.
 */
export function nextStep(state: MonthState, s: WorkflowSettings) {
  const here = STATE_POSITION[state];
  if (here === undefined) return undefined;
  return STEPS.find((step) => step.position > here && step.on(s));
}

/** States from which `action` may be taken under these settings. */
export function statesFor(action: ReviewAction, s: WorkflowSettings): MonthState[] {
  return (Object.keys(STATE_POSITION) as MonthState[]).filter((st) => nextStep(st, s)?.action === action);
}

export const stepOf = (action: string) => STEPS.find((step) => step.action === action);
