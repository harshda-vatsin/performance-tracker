import {
  BookOpen,
  ClipboardCheck,
  FileSpreadsheet,
  Factory,
  Gauge,
  Grid2x2,
  LayoutDashboard,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NAV_ITEMS, ROLE_MAP, pageTitle } from '../../config/roles';
import { useStore } from '../../store/AppStore';
import type { PageKey } from '../../types';

const ICONS: Record<PageKey, LucideIcon> = {
  overview: Gauge,
  dashboard: LayoutDashboard,
  kra: BookOpen,
  goals: Target,
  appraisals: ClipboardCheck,
  shift: Factory,
  scorecards: Users,
  skills: Grid2x2,
  reports: FileSpreadsheet,
};

export function Sidebar() {
  const { role, page, setPage, setFocusEmployeeId } = useStore();
  const allowed = new Set(ROLE_MAP[role].pages);

  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-slate-200 bg-white lg:w-60">
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-3.5 lg:px-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-700 text-[11px] font-bold tracking-tight text-white">
          MMF
        </span>
        <div className="hidden leading-tight lg:block">
          <div className="text-sm font-semibold text-slate-900">Performance Tracker</div>
          <div className="text-[11px] text-slate-500">MM Forgings</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.filter((n) => allowed.has(n.key)).map((n) => {
          const Icon = ICONS[n.key];
          const active = page === n.key;
          return (
            <button
              key={n.key}
              title={pageTitle(role, n.key)}
              onClick={() => {
                setPage(n.key);
                setFocusEmployeeId(null);
              }}
              className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                active ? 'bg-accent-50 text-accent-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              } justify-center lg:justify-start`}
            >
              <Icon size={18} className={active ? 'text-accent-700' : 'text-slate-400'} />
              <span className="hidden lg:inline">{pageTitle(role, n.key) === 'My Dashboard' ? 'Dashboard' : n.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="hidden border-t border-slate-200 p-3 text-[11px] leading-snug text-slate-500 lg:block">
        <div className="font-medium text-slate-600">FY 2026-27 · Q2 review</div>
        Corporate office: Chennai
        <br />
        Demo build · sample data only
      </div>
    </aside>
  );
}
