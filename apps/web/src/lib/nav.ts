import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  Factory,
  FileStack,
  Gauge,
  GitPullRequestArrow,
  LineChart,
  Target,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Me } from './types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown only when the user holds this permission in some scope; the server still enforces scope. */
  perm?: string;
  group: 'Work' | 'Insight' | 'Master data' | 'Admin';
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Gauge, group: 'Work' },
  { to: '/submissions', label: 'Monthly entry', icon: ClipboardList, perm: 'submissions:read', group: 'Work' },
  { to: '/plants', label: 'Plant status', icon: Factory, perm: 'submissions:read', group: 'Work' },
  { to: '/reopen', label: 'Reopen requests', icon: GitPullRequestArrow, perm: 'submissions:read', group: 'Work' },
  { to: '/dashboards/unit', label: 'Unit trend', icon: LineChart, perm: 'scores:read', group: 'Insight' },
  { to: '/dashboards/management', label: 'Management', icon: BarChart3, perm: 'scores:read', group: 'Insight' },
  { to: '/scorecards', label: 'Scorecards', icon: Target, perm: 'scorecards:read', group: 'Master data' },
  { to: '/templates', label: 'KRA templates', icon: FileStack, perm: 'templates:read', group: 'Master data' },
  { to: '/kpis', label: 'KPI library', icon: BookOpen, perm: 'kpi:read', group: 'Master data' },
  { to: '/employees', label: 'Employees', icon: Users, perm: 'employees:read', group: 'Master data' },
  { to: '/org', label: 'Organisation', icon: Building2, perm: 'org:read', group: 'Master data' },
  { to: '/admin/users', label: 'Users', icon: UserCog, perm: 'users:manage', group: 'Admin' },
];

export const navFor = (me: Me): NavItem[] => NAV.filter((n) => !n.perm || me.permissions.includes(n.perm));

export const ROLE_LABELS: Record<string, string> = {
  SA: 'Super Admin',
  MD: 'Managing Director',
  CHR: 'Corporate HR',
  CHR_H: 'Co-HR Head',
  AUD: 'Auditor',
  PHR: 'Plant HR',
  PH: 'Plant Head',
  HOD: 'HOD / Cell Incharge',
  SUP: 'Supervisor',
  SEN: 'Senior Engineer',
  REV: 'Reviewer',
};

/** "MMF.TRY.TRY_HAM" -> "TRY-HAM" */
export function scopeLabel(r: { scopeType: string; scopePath: string | null }): string {
  if (r.scopeType === 'COMPANY') return 'Whole company';
  if (r.scopePath) return r.scopePath.split('.').pop()!.replace(/_/g, '-');
  return r.scopeType === 'SELF' ? 'Own records' : 'Assigned items';
}
