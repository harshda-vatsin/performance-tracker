import { Lightbulb } from 'lucide-react';
import { ROLES, pageTitle } from '../../config/roles';
import { plantCity } from '../../data/org';
import { FIXED_PERSONAS, MANAGER_IDS, STAFF, STAFF_MAP } from '../../data/staff';
import { useStore } from '../../store/AppStore';
import { Avatar } from '../ui';

export function TopBar({ onGuide }: { onGuide: () => void }) {
  const { role, setRole, page, employeeId, setEmployeeId, managerId, setManagerId } = useStore();

  let personaName: string;
  let personaTitle: string;
  if (role === 'employee') {
    personaName = STAFF_MAP[employeeId].name;
    personaTitle = `${STAFF_MAP[employeeId].role} · ${plantCity(STAFF_MAP[employeeId].plantId)}`;
  } else if (role === 'manager') {
    personaName = STAFF_MAP[managerId].name;
    personaTitle = `${STAFF_MAP[managerId].role} · ${plantCity(STAFF_MAP[managerId].plantId)}`;
  } else {
    personaName = FIXED_PERSONAS[role].name;
    personaTitle = FIXED_PERSONAS[role].title;
  }

  return (
    <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2 md:px-6">
      <div className="mr-auto min-w-0">
        <div className="truncate text-sm font-semibold text-slate-900">{pageTitle(role, page)}</div>
        <div className="truncate text-[11px] text-slate-500">FY 2026-27 · Q2 review in progress</div>
      </div>

      {/* Role switcher */}
      <div className="flex items-center gap-2">
        <span className="hidden text-xs font-medium uppercase tracking-wide text-slate-400 md:inline">View as</span>
        <div className="hidden rounded-lg border border-slate-200 bg-slate-100 p-0.5 xl:flex">
          {ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRole(r.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                role === r.key ? 'bg-white text-accent-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
              title={r.blurb}
            >
              {r.short}
            </button>
          ))}
        </div>
        <select
          className="input !w-auto xl:hidden"
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          aria-label="Switch role"
        >
          {ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {/* Persona */}
      <div className="flex items-center gap-2.5">
        <Avatar name={personaName} size="sm" />
        <div className="hidden leading-tight sm:block">
          {role === 'employee' || role === 'manager' ? (
            <select
              className="-ml-1 cursor-pointer rounded bg-transparent py-0 pr-5 text-sm font-medium text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-200"
              value={role === 'employee' ? employeeId : managerId}
              onChange={(e) => (role === 'employee' ? setEmployeeId(e.target.value) : setManagerId(e.target.value))}
              aria-label="Switch person"
            >
              {(role === 'employee' ? STAFF : STAFF.filter((s) => MANAGER_IDS.includes(s.id))).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-sm font-medium text-slate-900">{personaName}</div>
          )}
          <div className="text-[11px] text-slate-500">{personaTitle}</div>
        </div>
      </div>

      <button className="btn btn-secondary !px-2.5" onClick={onGuide} title="Suggested demo walkthrough">
        <Lightbulb size={15} className="text-accent-700" />
        <span className="hidden md:inline">Demo guide</span>
      </button>
    </header>
  );
}
