import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Empty, Loading } from './components/ui';
import { EmployeesPage } from './pages/EmployeesPage';
import { HomePage } from './pages/HomePage';
import { KpisPage } from './pages/KpisPage';
import { LoginPage } from './pages/LoginPage';
import { OrgPage } from './pages/OrgPage';
import { TemplateDetailPage } from './pages/TemplateDetailPage';
import { TemplatesPage } from './pages/TemplatesPage';

/** Signed-in only; remembers where the user was heading so login can return there. */
function Protected({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const here = useLocation();
  if (state.status === 'loading') return <Loading label="Checking your session…" />;
  if (state.status === 'anon') return <Navigate to="/login" replace state={{ from: here.pathname + here.search }} />;
  return <>{children}</>;
}

/** Hides a screen the user's role cannot use (the API enforces this too; this just avoids dead links). */
export function Gate({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <Empty title="Not available for your role" hint="Your role does not include this screen. If you think it should, ask your administrator." />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="org" element={<Gate perm="org:read"><OrgPage /></Gate>} />
        <Route path="employees" element={<Gate perm="employees:read"><EmployeesPage /></Gate>} />
        <Route path="kpis" element={<Gate perm="kpi:read"><KpisPage /></Gate>} />
        <Route path="templates" element={<Gate perm="templates:read"><TemplatesPage /></Gate>} />
        <Route path="templates/:id" element={<Gate perm="templates:read"><TemplateDetailPage /></Gate>} />
        <Route path="*" element={<Empty title="Page not found" hint="Use the menu on the left." />} />
      </Route>
    </Routes>
  );
}
