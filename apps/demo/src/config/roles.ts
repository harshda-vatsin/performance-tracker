import type { PageKey, RoleKey } from '../types';

export interface RoleDef {
  key: RoleKey;
  label: string;
  /** Short label for the segmented switcher on small screens. */
  short: string;
  blurb: string;
  /** Sidebar items this role can see (order follows NAV_ITEMS). */
  pages: PageKey[];
  home: PageKey;
}

export const ROLES: RoleDef[] = [
  {
    key: 'employee',
    label: 'Employee (Senior Staff)',
    short: 'Employee',
    blurb: 'Own goals, KPI actuals, self-assessment and rating history.',
    pages: ['dashboard', 'goals', 'appraisals'],
    home: 'dashboard',
  },
  {
    key: 'manager',
    label: 'Reporting Manager',
    short: 'Manager',
    blurb: 'Assign goals, assess the team and track workflow status.',
    pages: ['dashboard', 'kra', 'goals', 'appraisals'],
    home: 'dashboard',
  },
  {
    key: 'hr',
    label: 'HR Admin',
    short: 'HR',
    blurb: 'Maintain the KRA library, finalise appraisals and export the increment cycle.',
    pages: ['dashboard', 'kra', 'goals', 'appraisals', 'scorecards', 'skills', 'reports'],
    home: 'dashboard',
  },
  {
    key: 'management',
    label: 'Plant Head / Management',
    short: 'Plant Head',
    blurb: 'Plant KPIs, appraisal completion and the PQCDSM floor summary.',
    pages: ['overview', 'dashboard', 'kra', 'goals', 'appraisals', 'scorecards', 'skills', 'reports'],
    home: 'overview',
  },
  {
    key: 'supervisor',
    label: 'Shift Supervisor',
    short: 'Supervisor',
    blurb: 'Enter shift data, review the floor and see operator scorecards.',
    pages: ['dashboard', 'shift', 'scorecards', 'skills'],
    home: 'dashboard',
  },
];

export const ROLE_MAP: Record<RoleKey, RoleDef> = Object.fromEntries(ROLES.map((r) => [r.key, r])) as Record<
  RoleKey,
  RoleDef
>;

export const NAV_ITEMS: { key: PageKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'kra', label: 'KRA Library' },
  { key: 'goals', label: 'Goals' },
  { key: 'appraisals', label: 'Appraisals' },
  { key: 'shift', label: 'Shift Entry' },
  { key: 'scorecards', label: 'Operator Scorecards' },
  { key: 'skills', label: 'Skill Matrix' },
  { key: 'reports', label: 'Reports' },
];

/** Page title overrides per role (the same route can mean different things per role). */
export function pageTitle(role: RoleKey, page: PageKey): string {
  if (page === 'dashboard') {
    return { employee: 'My Dashboard', manager: 'Team Dashboard', hr: 'HR Dashboard', management: 'Dashboard', supervisor: 'Floor Dashboard' }[role];
  }
  if (page === 'goals' && role === 'employee') return 'My Goals';
  if (page === 'appraisals' && role === 'employee') return 'My Appraisal';
  return NAV_ITEMS.find((n) => n.key === page)?.label ?? '';
}
