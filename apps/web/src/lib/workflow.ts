import { get } from './api';
import { useAsync } from './hooks';

/** Approval steps Corporate HR can switch on or off (apps/api/src/workflow.ts); the same shape GET /settings/workflow returns. */
export interface WorkflowSettings {
  monthly: { hodVerify: boolean; plantHeadApprove: boolean };
  senior: { reviewerStep: boolean };
}

export const DEFAULT_WORKFLOW: WorkflowSettings = { monthly: { hodVerify: false, plantHeadApprove: false }, senior: { reviewerStep: false } };

export type ReviewAction = 'verify' | 'approve' | 'lock';

export const STEP_PERMISSION: Record<ReviewAction, string> = { verify: 'submissions:verify', approve: 'submissions:approve', lock: 'submissions:lock' };
export const STEP_LABEL: Record<ReviewAction, string> = { verify: 'Verify', approve: 'Approve', lock: 'Lock' };

const POSITION: Record<string, number> = { SUBMITTED: 0, VERIFIED: 1, APPROVED: 2 };

/** The review step a month in `state` waits for: the first switched-on step after it (lock is always on). */
export function nextStep(state: string, s: WorkflowSettings): ReviewAction | null {
  const here = POSITION[state];
  if (here === undefined) return null;
  if (here < 1 && s.monthly.hodVerify) return 'verify';
  if (here < 2 && s.monthly.plantHeadApprove) return 'approve';
  return 'lock';
}

/** Month states from which `action` can be taken under these settings. */
export const statesFor = (action: ReviewAction, s: WorkflowSettings): string[] => Object.keys(POSITION).filter((st) => nextStep(st, s) === action);

/** The current settings, falling back to the defaults while loading or if the call fails. */
export function useWorkflowSettings(): WorkflowSettings {
  const res = useAsync(() => get<WorkflowSettings>('/settings/workflow'), []);
  return res.data ?? DEFAULT_WORKFLOW;
}
