import { LogOut } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, useMe } from '../auth/AuthContext';
import { navFor, ROLE_LABELS, scopeLabel } from '../lib/nav';
import { Avatar, Chip } from './ui';

export function Layout() {
  const me = useMe();
  const { logout } = useAuth();
  const items = navFor(me);
  const groups = ['Work', 'Insight', 'Master data', 'Admin'] as const;
  const here = useLocation().pathname;
  const current = items.filter((n) => (n.to === '/' ? here === '/' : here.startsWith(n.to))).sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <div className="flex h-full">
      <aside className="flex w-16 shrink-0 flex-col border-r border-slate-200 bg-white lg:w-60" aria-label="Main navigation">
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-3.5 lg:px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-700 text-[11px] font-bold tracking-tight text-white">MMF</span>
          <div className="hidden leading-tight lg:block">
            <div className="text-sm font-semibold text-slate-900">Performance Portal</div>
            <div className="text-[11px] text-slate-500">MM Forgings</div>
          </div>
        </div>
        <nav className="flex-1 space-y-3 overflow-y-auto p-2">
          {groups.map((g) => {
            const list = items.filter((n) => n.group === g);
            if (list.length === 0) return null;
            return (
              <div key={g} className="space-y-0.5">
                {g !== 'Work' && <div className="hidden px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 lg:block">{g}</div>}
                {list.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === '/'}
                    title={n.label}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors justify-center lg:justify-start ${
                        isActive ? 'bg-accent-50 text-accent-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <n.icon size={18} className="shrink-0" />
                    <span className="hidden lg:inline">{n.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="hidden border-t border-slate-200 p-3 text-[11px] leading-snug text-slate-500 lg:block">
          Corporate office: Chennai
          <br />
          Development build
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2 md:px-6">
          <div className="mr-auto min-w-0 truncate text-sm font-semibold text-slate-900">{current?.label ?? 'Portal'}</div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="role-chips">
            {me.roles.map((r, i) => (
              <Chip key={i} tone="accent" title={`${ROLE_LABELS[r.code] ?? r.code}, scope: ${scopeLabel(r)}`}>
                {ROLE_LABELS[r.code] ?? r.code} · {scopeLabel(r)}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            <Avatar name={me.user.fullName} size="sm" />
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-medium text-slate-900" data-testid="user-name">
                {me.user.fullName}
              </div>
              <div className="text-[11px] text-slate-500">{me.user.loginId}</div>
            </div>
            <button className="btn btn-secondary !px-2.5" onClick={() => void logout()} aria-label="Sign out">
              <LogOut size={15} />
              <span className="hidden md:inline">Sign out</span>
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-4 py-5 md:px-6 md:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
