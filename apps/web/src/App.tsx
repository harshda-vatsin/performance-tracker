import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Empty, Loading } from './components/ui';
import { AUDIT_PERMS } from './lib/nav';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AppraisalsPage } from './pages/AppraisalsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { MyResultsPage } from './pages/MyResultsPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { ManagementPage } from './pages/ManagementPage';
import { PlantsPage } from './pages/PlantsPage';
import { ReopenPage } from './pages/ReopenPage';
import { ScorecardDetailPage } from './pages/ScorecardDetailPage';
import { ScorecardsPage } from './pages/ScorecardsPage';
import { AppraisalBoardPage, MyGoalsPage, ReviewQueuePage, TeamGoalsPage } from './pages/SeniorLists';
import { SeniorCyclePage } from './pages/SeniorCyclePage';
import { SubmissionPage } from './pages/SubmissionPage';
import { SubmissionsPage } from './pages/SubmissionsPage';
import { UnitTrendPage } from './pages/UnitTrendPage';
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
  if (state.status === 'anon') return <Navigate to="/login" replace state={state.signedOut ? null : { from: here.pathname + here.search }} />;
  return <>{children}</>;
}

/** Hides a screen the user's role cannot use (the API enforces this too; this just avoids dead links). */
export function Gate({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (![perm].flat().some(can)) return <Empty title="Not available for your role" hint="Your role does not include this screen. If you think it should, ask your administrator." />;
  return <>{children}</>;
}

export function App() {
  const { can } = useAuth();
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
        <Route path="scorecards" element={<Gate perm="scorecards:read"><ScorecardsPage /></Gate>} />
        <Route path="scorecards/:id" element={<Gate perm="scorecards:read"><ScorecardDetailPage /></Gate>} />
        <Route path="submissions" element={<Gate perm="submissions:read"><SubmissionsPage /></Gate>} />
        <Route path="submissions/:id" element={<Gate perm="submissions:read"><SubmissionPage /></Gate>} />
        <Route path="plants" element={<Gate perm="submissions:read"><PlantsPage /></Gate>} />
        <Route path="reopen" element={<Gate perm="submissions:read"><ReopenPage /></Gate>} />
        <Route path="dashboards/unit" element={<Gate perm="scores:read"><UnitTrendPage /></Gate>} />
        <Route path="dashboards/management" element={<Gate perm="scores:read"><ManagementPage /></Gate>} />
        <Route path="admin/users" element={<Gate perm="users:manage"><AdminUsersPage /></Gate>} />
        <Route path="audit" element={<Gate perm={AUDIT_PERMS}><AuditLogPage /></Gate>} />
        <Route path="my-results" element={<Gate perm="myscores:read"><MyResultsPage /></Gate>} />
        <Route path="appraisals" element={<Gate perm="appraisals:read"><AppraisalsPage /></Gate>} />
        <Route path="senior/mine" element={<Gate perm="senior:own"><MyGoalsPage /></Gate>} />
        <Route path="senior/team" element={<Gate perm="senior:manage"><TeamGoalsPage /></Gate>} />
        <Route path="senior/review" element={<Gate perm="senior:review"><ReviewQueuePage /></Gate>} />
        <Route path="senior/board" element={<Gate perm="senior:read_all"><AppraisalBoardPage canCreate={can('senior:hr')} /></Gate>} />
        <Route path="senior/:id" element={<Gate perm={['senior:own', 'senior:manage', 'senior:review', 'senior:read_all']}><SeniorCyclePage /></Gate>} />
        <Route path="*" element={<Empty title="Page not found" hint="Use the menu on the left." />} />
      </Route>
    </Routes>
  );
}
