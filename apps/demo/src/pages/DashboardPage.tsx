import { AlertTriangle, Download } from 'lucide-react';
import { useState } from 'react';
import { KpiTable } from '../components/appraisal/KpiTable';
import {
  CycleTimeline,
  GoalStatusChip,
  PendingWith,
  RatingChip,
  StatusChip,
  pendingWith,
} from '../components/appraisal/parts';
import { HistoryChart, RatingDistributionChart } from '../components/charts/Charts';
import { FloorDashboard } from '../components/floor/FloorDashboard';
import { Avatar, Bar, Card, Chip, PageHeader, Stat, Tabs, TableWrap, type Tone } from '../components/ui';
import { RATING_BANDS } from '../config/scoring.config';
import { DEPARTMENTS } from '../data/kras';
import { plantCity } from '../data/org';
import { STAFF_MAP } from '../data/staff';
import { useStaffRows, useStore } from '../store/AppStore';
import type { AppraisalStatus } from '../types';
import { downloadCsv, downloadXlsx } from '../utils/export';
import { incrementRows } from './ReportsPage';

export function DashboardPage() {
  const { role } = useStore();
  switch (role) {
    case 'employee':
      return <EmployeeDashboard />;
    case 'manager':
      return <ManagerDashboard />;
    case 'hr':
    case 'management':
      return <HrDashboard />;
    case 'supervisor':
      return (
        <>
          <PageHeader title="Floor Dashboard" subtitle="Trichy plant · line and shift performance, rejections and top performers" />
          <FloorDashboard plantScope="P1" />
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------
function EmployeeDashboard() {
  const { employeeId, goalSheets, appraisals, history, scoreFor, setPage } = useStore();
  const emp = STAFF_MAP[employeeId];
  const sheet = goalSheets.find((g) => g.employeeId === employeeId);
  const appraisal = appraisals.find((a) => a.employeeId === employeeId)!;
  const live = scoreFor(employeeId);
  const final = appraisal.status === 'Finalised' && appraisal.finalScore !== undefined;
  const score = final ? appraisal.finalScore! : live.total;
  const hist = history.filter((h) => h.employeeId === employeeId);
  const last = hist[hist.length - 1];
  const points = [...hist.map((h) => ({ cycle: h.cycle, score: h.score })), ...(sheet ? [{ cycle: 'FY 2026-27 (Q2)', score }] : [])];

  return (
    <>
      <PageHeader
        title={`Welcome, ${emp.name.split(' ')[0]}`}
        subtitle={`${emp.role} · ${plantCity(emp.plantId)} plant · reports to ${emp.managerName}`}
      />

      {sheet?.status === 'Awaiting acknowledgement' && (
        <Banner tone="amber" action="Review goals" onAction={() => setPage('goals')}>
          Your reporting manager has sent your FY 2026-27 goal sheet — please review and acknowledge it.
        </Banner>
      )}
      {!sheet && (
        <Banner tone="slate">Your KRAs have not been assigned yet. Your reporting manager will assign them from the KRA library.</Banner>
      )}
      {appraisal.status === 'Self-assessment' && (
        <Banner tone="accent" action="Start self-assessment" onAction={() => setPage('appraisals')}>
          Your Q2 self-assessment is due. Check the manual-entry KPIs and add your comments.
        </Banner>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={final ? 'Final score' : 'Live score'}
          value={sheet ? score.toFixed(1) : '—'}
          sub={sheet ? <RatingChip score={score} /> : 'No goals assigned'}
        />
        <Stat
          label="Appraisal status"
          value={<span className="text-base">{appraisal.status}</span>}
          sub={<PendingWith status={appraisal.status} emp={emp} goalStatus={sheet?.status} />}
        />
        <Stat label="Goal sheet" value={<span className="text-base">{sheet?.status ?? 'Not assigned'}</span>} sub={<GoalStatusChip status={sheet?.status} />} />
        <Stat
          label="Vs last cycle"
          value={last && sheet ? `${score - last.score >= 0 ? '+' : ''}${(score - last.score).toFixed(1)}` : '—'}
          sub={last ? `${last.cycle}: ${last.score} (${RATING_BANDS.find((b) => b.key === last.rating)!.label})` : 'First cycle'}
          tone={last && sheet ? (score >= last.score ? 'green' : 'red') : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="KPI actuals vs target" subtitle={`${emp.role} KRAs · ${appraisal.period}`} pad={false}>
          {sheet ? (
            <KpiTable items={sheet.items} actuals={appraisal.actuals} />
          ) : (
            <div className="p-6 text-sm text-slate-500">KPIs will appear here once goals are assigned.</div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Score history">
            {points.length ? <HistoryChart points={points} /> : <p className="text-sm text-slate-500">No history yet.</p>}
          </Card>
          <Card title="Review calendar">
            <CycleTimeline />
          </Card>
        </div>
      </div>
    </>
  );
}

function Banner({
  tone,
  children,
  action,
  onAction,
}: {
  tone: Tone;
  children: React.ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  const cls =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : tone === 'accent'
        ? 'border-accent-200 bg-accent-50 text-accent-900'
        : 'border-slate-200 bg-white text-slate-700';
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <span>{children}</span>
      {action && (
        <button className="btn btn-primary" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reporting manager
// ---------------------------------------------------------------------------
const STAGES: AppraisalStatus[] = ['Not started', 'Self-assessment', 'Manager assessment', 'Reviewer sign-off', 'HR finalisation', 'Finalised'];

function ManagerDashboard() {
  const { managerId, openAppraisal } = useStore();
  const all = useStaffRows();
  const team = all.filter((r) => r.emp.managerId === managerId);
  const scored = team.filter((r) => r.score !== null);
  const avg = scored.length ? scored.reduce((s, r) => s + r.score!, 0) / scored.length : 0;
  const mine = team.filter((r) => r.appraisal.status === 'Manager assessment').length;
  const goalsOpen = team.filter((r) => r.sheet?.status !== 'Acknowledged').length;
  const atRisk = scored.filter((r) => r.score! < 80).length;

  return (
    <>
      <PageHeader title="Team Dashboard" subtitle={`${STAFF_MAP[managerId].name} · ${team.length} direct reports · Q2 review`} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Team average score" value={avg ? avg.toFixed(1) : '—'} sub={avg ? <RatingChip score={avg} /> : undefined} />
        <Stat label="Awaiting your assessment" value={mine} sub="Manager assessment step" tone={mine ? 'amber' : 'green'} />
        <Stat label="Goal sheets open" value={goalsOpen} sub="Not assigned or not acknowledged" tone={goalsOpen ? 'amber' : 'green'} />
        <Stat label="Below 'Meets'" value={atRisk} sub="Score under 80" tone={atRisk ? 'red' : 'green'} />
      </div>

      <Card title="Workflow status" subtitle="Where each team member's appraisal sits" className="mb-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((s) => (
            <div key={s} className="rounded-md border border-slate-200 p-2.5">
              <div className="text-xl font-semibold tabular-nums text-slate-900">{team.filter((r) => r.appraisal.status === s).length}</div>
              <div className="text-[11px] text-slate-500">{s}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="My team" subtitle="Score, rating and workflow status" pad={false}>
        <TableWrap>
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th className="th">Employee</th>
                <th className="th w-48">Score</th>
                <th className="th">Rating</th>
                <th className="th">Workflow status</th>
                <th className="th">Pending with</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {team.map((r) => (
                <tr key={r.emp.id} className="tr-hover cursor-pointer" onClick={() => openAppraisal(r.emp.id)}>
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.emp.name} size="sm" />
                      <div>
                        <div className="font-medium text-slate-900">{r.emp.name}</div>
                        <div className="text-xs text-slate-500">{r.emp.role}</div>
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    {r.score === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="w-12 font-semibold tabular-nums">{r.score.toFixed(1)}</span>
                        <div className="w-24">
                          <Bar value={r.score} max={120} tone={r.score >= 95 ? 'green' : r.score >= 80 ? 'blue' : r.score >= 60 ? 'amber' : 'red'} />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="td">{r.score !== null ? <RatingChip score={r.score} /> : <Chip>—</Chip>}</td>
                  <td className="td">
                    <StatusChip status={r.appraisal.status} />
                  </td>
                  <td className="td">
                    <PendingWith status={r.appraisal.status} emp={r.emp} goalStatus={r.sheet?.status} />
                  </td>
                  <td className="td text-right text-xs font-medium text-accent-700">Open →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// HR admin / Plant Head
// ---------------------------------------------------------------------------
function HrDashboard() {
  const { role, openAppraisal, setPage, notify } = useStore();
  const rows = useStaffRows();
  const [tab, setTab] = useState<'staff' | 'floor'>('staff');

  const total = rows.length;
  const finalised = rows.filter((r) => r.appraisal.status === 'Finalised').length;
  const pending = rows.filter((r) => r.appraisal.status !== 'Finalised');
  const scored = rows.filter((r) => r.score !== null);
  const avg = scored.reduce((s, r) => s + r.score!, 0) / (scored.length || 1);
  const below = scored.filter((r) => r.score! < 80).length;

  const dist = DEPARTMENTS.map((d) => {
    const row: Record<string, number | string> = { name: d };
    RATING_BANDS.forEach((b) => (row[b.label] = 0));
    scored
      .filter((r) => r.emp.department === d)
      .forEach((r) => {
        row[r.rating!.label] = (row[r.rating!.label] as number) + 1;
      });
    return row as { name: string } & Record<string, number | string>;
  });

  const exportRows = () => incrementRows(rows);

  return (
    <>
      <PageHeader
        title={role === 'hr' ? 'HR Dashboard' : 'Dashboard'}
        subtitle="Q2 review · senior staff appraisals and factory-floor performance"
        actions={
          role === 'hr' ? (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  downloadCsv('increment-cycle-FY2026-27', exportRows());
                  notify('Increment sheet exported as CSV.');
                }}
              >
                <Download size={15} /> CSV
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await downloadXlsx('increment-cycle-FY2026-27', 'Increment cycle', exportRows());
                  notify('Increment sheet exported as Excel.');
                }}
              >
                <Download size={15} /> Export to Excel
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" onClick={() => setPage('reports')}>
              Open reports
            </button>
          )
        }
      />
      <Tabs
        tabs={[
          { key: 'staff', label: 'Senior staff appraisals' },
          { key: 'floor', label: 'Factory floor (PQCDSM)' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'floor' ? (
        <FloorDashboard plantScope="all" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Appraisals finalised" value={`${Math.round((finalised / total) * 100)}%`} sub={`${finalised} of ${total} senior staff`} />
            <Stat label="Pending reviews" value={pending.length} sub="Not yet finalised" tone={pending.length > 8 ? 'amber' : 'green'} />
            <Stat label="Average score" value={avg.toFixed(1)} sub={<RatingChip score={avg} />} />
            <Stat label="Below 'Meets'" value={below} sub="Score under 80" tone={below ? 'red' : 'green'} />
          </div>

          <div className="mb-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Card title="Rating distribution by department" subtitle="Live ratings from current KPI actuals">
              <RatingDistributionChart data={dist} />
            </Card>
            <Card title="Pending reviews" subtitle="Click a row to open the appraisal" pad={false}>
              <TableWrap>
                <table className="w-full min-w-[480px] border-collapse">
                  <thead>
                    <tr>
                      <th className="th">Employee</th>
                      <th className="th">Step</th>
                      <th className="th">Pending with</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => {
                      const p = pendingWith(r.appraisal.status, r.emp, r.sheet?.status);
                      return (
                        <tr key={r.emp.id} className="tr-hover cursor-pointer" onClick={() => openAppraisal(r.emp.id)}>
                          <td className="td">
                            <div className="font-medium text-slate-900">{r.emp.name}</div>
                            <div className="text-xs text-slate-500">{r.emp.department}</div>
                          </td>
                          <td className="td">
                            <StatusChip status={r.appraisal.status} />
                          </td>
                          <td className="td text-xs">
                            <span className="font-medium text-slate-700">{p?.role}</span>
                            <div className="text-slate-500">{p?.name}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          </div>

          {below > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                {scored
                  .filter((r) => r.score! < 80)
                  .map((r) => `${r.emp.name} (${r.emp.role}, ${r.score!.toFixed(1)})`)
                  .join(' · ')}{' '}
                — scoring below “Meets”. Consider an improvement plan before the increment cycle.
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
