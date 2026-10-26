import { ROLE_MAP } from './config/roles';
import { AppShell } from './components/layout/AppShell';
import { AppraisalsPage } from './pages/AppraisalsPage';
import { DashboardPage } from './pages/DashboardPage';
import { GoalsPage } from './pages/GoalsPage';
import { KraLibraryPage } from './pages/KraLibraryPage';
import { OperatorScorecardsPage } from './pages/OperatorScorecardsPage';
import { OverviewPage } from './pages/OverviewPage';
import { ReportsPage } from './pages/ReportsPage';
import { ShiftEntryPage } from './pages/ShiftEntryPage';
import { SkillMatrixPage } from './pages/SkillMatrixPage';
import { useStore } from './store/AppStore';

export default function App() {
  const { role, page } = useStore();
  // Guard: a role can only reach pages in its menu.
  const effective = ROLE_MAP[role].pages.includes(page) ? page : ROLE_MAP[role].home;

  return (
    <AppShell>
      {effective === 'overview' && <OverviewPage />}
      {effective === 'dashboard' && <DashboardPage />}
      {effective === 'kra' && <KraLibraryPage />}
      {effective === 'goals' && <GoalsPage />}
      {effective === 'appraisals' && <AppraisalsPage />}
      {effective === 'shift' && <ShiftEntryPage />}
      {effective === 'scorecards' && <OperatorScorecardsPage />}
      {effective === 'skills' && <SkillMatrixPage />}
      {effective === 'reports' && <ReportsPage />}
    </AppShell>
  );
}
