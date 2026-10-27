import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileStack,
  Gauge,
  GitPullRequestArrow,
  Goal,
  LineChart,
  Banknote,
  ListChecks,
  Medal,
  ScrollText,
  SlidersHorizontal,
  Target,
  UserCheck,
  UserCog,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { Me } from './types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown only when the user holds this permission in some scope; the server still enforces scope. */
  perm?: string;
  /** Shown when the user holds at least one of these (Admin holds the system audit permission, Corporate HR the business one). */
  anyPerm?: string[];
  group: 'Work' | 'Insight' | 'Master data' | 'Admin';
}

export const AUDIT_PERMS = ['audit:read_system', 'audit:read_business'];

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Gauge, group: 'Work' },
  { to: '/submissions', label: 'Monthly entry', icon: ClipboardList, perm: 'submissions:read', group: 'Work' },
  { to: '/plants', label: 'Plant status', icon: Factory, perm: 'submissions:read', group: 'Work' },
  { to: '/reopen', label: 'Reopen requests', icon: GitPullRequestArrow, perm: 'submissions:read', group: 'Work' },
  { to: '/my-results', label: 'My results', icon: Medal, perm: 'myscores:read', group: 'Work' },
  { to: '/appraisals', label: 'Appraisals', icon: UserCheck, perm: 'appraisals:read', group: 'Work' },
  { to: '/senior/mine', label: 'My goals', icon: Goal, perm: 'senior:own', group: 'Work' },
  { to: '/senior/team', label: 'Team goals', icon: UsersRound, perm: 'senior:manage', group: 'Work' },
  { to: '/senior/review', label: 'Review queue', icon: ClipboardCheck, perm: 'senior:review', group: 'Work' },
  { to: '/senior/board', label: 'Appraisal board', icon: ListChecks, perm: 'senior:read_all', group: 'Work' },
  { to: '/bonus', label: 'Bonus', icon: Banknote, perm: 'bonus:read', group: 'Work' },
  { to: '/dashboards/unit', label: 'Unit trend', icon: LineChart, perm: 'scores:read', group: 'Insight' },
  { to: '/dashboards/management', label: 'Management', icon: BarChart3, perm: 'scores:read', group: 'Insight' },
  { to: '/scorecards', label: 'Scorecards', icon: Target, perm: 'scorecards:read', group: 'Master data' },
  { to: '/templates', label: 'KRA templates', icon: FileStack, perm: 'templates:read', group: 'Master data' },
  { to: '/kpis', label: 'KPI library', icon: BookOpen, perm: 'kpi:read', group: 'Master data' },
  { to: '/employees', label: 'Employees', icon: Users, perm: 'employees:read', group: 'Master data' },
  { to: '/org', label: 'Organisation', icon: Building2, perm: 'org:read', group: 'Master data' },
  { to: '/settings', label: 'Approval steps', icon: SlidersHorizontal, perm: 'settings:write', group: 'Master data' },
  { to: '/admin/users', label: 'Users', icon: UserCog, perm: 'users:manage', group: 'Admin' },
  { to: '/audit', label: 'Audit log', icon: ScrollText, anyPerm: AUDIT_PERMS, group: 'Admin' },
];

export const navFor = (me: Me): NavItem[] =>
  NAV.filter((n) => (!n.perm || me.permissions.includes(n.perm)) && (!n.anyPerm || n.anyPerm.some((p) => me.permissions.includes(p))));

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  MGMT: 'Management',
  CHR: 'Corporate HR',
  PHR: 'Plant HR',
  PH: 'Plant Head',
  HOD: 'HOD / Manager',
  EMP: 'Employee',
};

/** "MMF.TRY.TRY_HAM" -> "TRY-HAM" */
export function scopeLabel(r: { scopeType: string; scopePath: string | null }): string {
  if (r.scopeType === 'COMPANY') return 'Whole company';
  if (r.scopePath) return r.scopePath.split('.').pop()!.replace(/_/g, '-');
  return r.scopeType === 'SELF' ? 'Own records' : 'Assigned items';
}
