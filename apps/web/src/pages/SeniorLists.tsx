import { useWorkflowSettings } from '../lib/workflow';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, TableWrap, useToast, type Tone } from '../components/ui';
import { fmtDate, fmtScore, fyLabel } from '../lib/format';
import { get, post } from '../lib/api';
import { useAction, useAsync } from '../lib/hooks';
import { STATE_LABEL, STATE_ORDER, type CycleRow, type CycleState, type People } from '../lib/senior';

const TONE: Record<CycleState, Tone> = {
  GOALS_DRAFT: 'slate',
  PENDING_ACK: 'amber',
  ACKNOWLEDGED: 'blue',
  SELF_ASSESSMENT: 'amber',
  MANAGER_ASSESSMENT: 'amber',
  REVIEWER_REVIEW: 'amber',
  HR_FINALISATION: 'amber',
  FINALISED: 'green',
};

/** Same test id as the monthly workflow's chip, so e2e helpers read both the same way. */
export function CycleChip({ state }: { state: CycleState }) {
  return (
    <span data-testid="state-chip">
      <Chip tone={TONE[state]}>{STATE_LABEL[state]}</Chip>
    </span>
  );
}

export function ScoreCell({ row }: { row: Pick<CycleRow, 'score' | 'band' | 'provisional'> }) {
  if (row.score === null) return <span className="muted">No score yet</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-semibold tabular-nums text-slate-900">{fmtScore(row.score)}</span>
      {row.band?.label && <Chip tone={row.provisional ? 'slate' : 'green'}>{row.band.label}</Chip>}
      {row.provisional && <span className="muted">provisional</span>}
    </span>
  );
}

type Col = 'employee' | 'plant' | 'manager' | 'reviewer' | 'pending' | 'months' | 'last';

function CycleTable({ rows, cols, label }: { rows: CycleRow[]; cols: Col[]; label: string }) {
  if (rows.length === 0) return <Empty title="Nothing here" />;
  const has = (c: Col) => cols.includes(c);
  return (
    <TableWrap>
      <table className="w-full min-w-[720px]" aria-label={label}>
        <thead>
          <tr>
            <th className="th">Employee</th>
            <th className="th">Year</th>
            {has('plant') && <th className="th">Plant</th>}
            {has('manager') && <th className="th">Manager</th>}
            {has('reviewer') && <th className="th">Reviewer</th>}
            <th className="th">Status</th>
            {has('pending') && <th className="th">Waiting on</th>}
            {has('months') && <th className="th text-right">Months confirmed</th>}
            <th className="th">Score</th>
            {has('last') && <th className="th">Last action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="tr-hover" data-testid={`senior-${r.employeeCode}-${r.fiscalYear}`}>
              <td className="td font-medium text-slate-900">
                <Link className="text-accent-700 hover:underline" to={`/senior/${r.id}`} aria-label={`Open goal sheet for ${r.employeeCode} ${r.fiscalYear}`}>
                  {r.employeeName}
                </Link>{' '}
                <span className="muted">{r.employeeCode}</span>
              </td>
              <td className="td">{fyLabel(r.fiscalYear)}</td>
              {has('plant') && <td className="td">{r.plantCode ?? '—'}</td>}
              {has('manager') && <td className="td">{r.managerName}</td>}
              {has('reviewer') && <td className="td">{r.reviewerName ?? <span className="muted">—</span>}</td>}
              <td className="td">
                <CycleChip state={r.state} />
              </td>
              {has('pending') && <td className="td">{r.pendingOn || '—'}</td>}
              {has('months') && <td className="td text-right tabular-nums">{r.monthsConfirmed} / 12</td>}
              <td className="td">
                <ScoreCell row={r} />
              </td>
              {has('last') && <td className="td">{r.lastActionAt ? fmtDate(r.lastActionAt) : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

const useCycles = (view: string) => useAsync(() => get<{ cycles: CycleRow[] }>(`/senior/cycles?view=${view}`), [view]);

function Body({ state, children }: { state: ReturnType<typeof useCycles>; children: (rows: CycleRow[]) => React.ReactNode }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorBox onRetry={state.reload}>{state.error}</ErrorBox>;
  return <>{children(state.data?.cycles ?? [])}</>;
}

/** Employee: my goal sheets, with whatever is waiting on me called out. */
export function MyGoalsPage() {
  const state = useCycles('mine');
  return (
    <>
      <PageHeader title="My goals" subtitle="Your KRAs and KPIs for each year: acknowledge them, follow your monthly results, and write your year-end self-assessment." />
      <Body state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Card>
              <Empty title="No goal sheet yet" hint="Corporate HR or your manager will assign your goals for the year." />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => {
                const mine = r.pendingOn === 'Employee';
                return (
                  <section key={r.id} className={`card card-pad space-y-3 ${mine ? 'border-accent-600' : ''}`} data-testid={`senior-${r.employeeCode}-${r.fiscalYear}`}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="section-title">{fyLabel(r.fiscalYear)}</h2>
                      <CycleChip state={r.state} />
                    </div>
                    <p className="muted">
                      Manager {r.managerName}{r.reviewerName ? ` · Reviewer ${r.reviewerName}` : ''}
                    </p>
                    {mine && <Notice tone="amber">{r.state === 'PENDING_ACK' ? 'Your goal sheet is ready for you to acknowledge.' : 'Your self-assessment is due.'}</Notice>}
                    <ScoreCell row={r} />
                    <div>
                      <Link className="btn btn-primary" to={`/senior/${r.id}`} aria-label={`Open goal sheet for ${r.employeeCode} ${r.fiscalYear}`}>
                        {mine ? 'Open and respond' : 'Open'}
                      </Link>
                    </div>
                  </section>
                );
              })}
            </div>
          )
        }
      </Body>
    </>
  );
}

/** HOD / Manager: the people they manage, with the ones waiting on them first. */
export function TeamGoalsPage() {
  const state = useCycles('team');
  return (
    <>
      <PageHeader title="Team goals" subtitle="Senior staff you manage. Open a person to set goals, enter monthly results or write the manager assessment." />
      <Body state={state}>
        {(rows) => {
          const waiting = (r: CycleRow) => r.pendingOn.startsWith('Manager');
          const sorted = [...rows].sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || b.fiscalYear - a.fiscalYear);
          return (
            <>
              <p className="mb-3 text-sm text-slate-600">{rows.filter(waiting).length > 0 ? `${rows.filter(waiting).length} waiting on you.` : 'Nothing is waiting on you.'}</p>
              <Card pad={false}>
                <CycleTable rows={sorted} cols={['reviewer', 'pending', 'months']} label="Team goals" />
              </Card>
            </>
          );
        }}
      </Body>
    </>
  );
}

/** Reviewer (an assignment on the appraisal): what is waiting for my sign-off, then the rest. */
export function ReviewQueuePage() {
  const state = useCycles('review');
  return (
    <>
      <PageHeader title="Review queue" subtitle="Appraisals you are assigned to review. You sign off once the manager has submitted." />
      <Body state={state}>
        {(rows) => {
          const waiting = rows.filter((r) => r.state === 'REVIEWER_REVIEW');
          return (
            <>
              <h2 className="section-title mb-2">Awaiting your sign-off ({waiting.length})</h2>
              <Card pad={false} className="mb-5">
                <CycleTable rows={waiting} cols={['manager', 'months']} label="Awaiting your sign-off" />
              </Card>
              <h2 className="section-title mb-2">Other appraisals assigned to you</h2>
              <Card pad={false}>
                <CycleTable rows={rows.filter((r) => r.state !== 'REVIEWER_REVIEW')} cols={['manager', 'pending']} label="Other appraisals" />
              </Card>
            </>
          );
        }}
      </Body>
    </>
  );
}

const currentFy = (): number => {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
};

function NewGoalSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const people = useAsync(() => get<People>('/senior/people'), []);
  const [employeeId, setEmployeeId] = useState('');
  const [fy, setFy] = useState(String(currentFy()));
  const [managerUserId, setManager] = useState('');
  const [reviewerUserId, setReviewer] = useState('');
  const reviewerStep = useWorkflowSettings().senior.reviewerStep;
  const { busy, error, run } = useAction();
  const opts = (list: { userId: string; employeeId: string; employeeCode: string; fullName: string }[], key: 'userId' | 'employeeId') =>
    list.map((p) => (
      <option key={p.userId} value={p[key]}>
        {p.fullName} ({p.employeeCode})
      </option>
    ));
  return (
    <Modal
      open
      title="Start a goal sheet"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !employeeId || !managerUserId || (reviewerStep && !reviewerUserId) || !/^\d{4}$/.test(fy)}
            onClick={() =>
              void run(async () => {
                const { id } = await post<{ id: string }>('/senior/cycles', { employeeId, fiscalYear: Number(fy), managerUserId, ...(reviewerUserId ? { reviewerUserId } : {}) });
                toast('Goal sheet started');
                navigate(`/senior/${id}`);
              })
            }
          >
            Start goal sheet
          </button>
        </>
      }
    >
      {people.loading && !people.data ? (
        <Loading />
      ) : people.error ? (
        <ErrorBox onRetry={people.reload}>{people.error}</ErrorBox>
      ) : (
        <div className="space-y-3">
          {error && <ErrorBox>{error}</ErrorBox>}
          <Field label="Employee" htmlFor="ns-emp">
            <select id="ns-emp" className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose…</option>
              {opts(people.data!.employees, 'employeeId')}
            </select>
          </Field>
          <Field label="Fiscal year" htmlFor="ns-fy" hint="Start year of the Apr–Mar year">
            <input id="ns-fy" className="input" inputMode="numeric" value={fy} onChange={(e) => setFy(e.target.value)} />
          </Field>
          <Field label="Manager" htmlFor="ns-mgr" hint="An HOD / Manager. They enter the monthly results.">
            <select id="ns-mgr" className="input" value={managerUserId} onChange={(e) => setManager(e.target.value)}>
              <option value="">Choose…</option>
              {opts(people.data!.managers, 'userId')}
            </select>
          </Field>
          <Field label={reviewerStep ? 'Reviewer' : 'Reviewer (optional)'} htmlFor="ns-rev" hint={reviewerStep ? 'An HOD / Manager, Plant Head or Management user. Also set on the Appraisals screen.' : 'The reviewer step is off, so a reviewer is not needed. You can still assign one.'}>
            <select id="ns-rev" className="input" value={reviewerUserId} onChange={(e) => setReviewer(e.target.value)}>
              <option value="">{reviewerStep ? 'Choose…' : 'None'}</option>
              {opts(people.data!.reviewers, 'userId')}
            </select>
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Corporate HR (and Management, read-only): every cycle in the company, by status. */
export function AppraisalBoardPage({ canCreate }: { canCreate: boolean }) {
  const state = useCycles('all');
  const [fy, setFy] = useState<number | null>(null);
  const [filter, setFilter] = useState<CycleState | null>(null);
  const [adding, setAdding] = useState(false);
  const all = state.data?.cycles ?? [];
  const years = useMemo(() => [...new Set(all.map((r) => r.fiscalYear))].sort((a, b) => b - a), [all]);
  const inYear = all.filter((r) => fy === null || r.fiscalYear === fy);
  const shown = inYear.filter((r) => filter === null || r.state === filter);
  return (
    <>
      <PageHeader
        title="Appraisal board"
        subtitle="Where every senior-staff appraisal stands, and who it is waiting on."
        actions={
          <>
            {years.length > 1 && (
              <select className="input !w-auto" aria-label="Fiscal year" value={fy ?? ''} onChange={(e) => setFy(e.target.value ? Number(e.target.value) : null)}>
                <option value="">All years</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {fyLabel(y)}
                  </option>
                ))}
              </select>
            )}
            {canCreate && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus size={15} /> New goal sheet
              </button>
            )}
          </>
        }
      />
      <Body state={state}>
        {() => (
          <>
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              <button className={`chip ring-slate-300 ${filter === null ? 'bg-accent-50 text-accent-800' : 'bg-white text-slate-600'}`} aria-pressed={filter === null} onClick={() => setFilter(null)}>
                All <b>{inYear.length}</b>
              </button>
              {STATE_ORDER.map((s) => (
                <button
                  key={s}
                  className={`chip ring-slate-300 ${filter === s ? 'bg-accent-50 text-accent-800' : 'bg-white text-slate-600'}`}
                  aria-pressed={filter === s}
                  onClick={() => setFilter(filter === s ? null : s)}
                >
                  {STATE_LABEL[s]} <b>{inYear.filter((r) => r.state === s).length}</b>
                </button>
              ))}
            </div>
            <Card pad={false}>
              <CycleTable rows={shown} cols={['plant', 'manager', 'reviewer', 'pending', 'months', 'last']} label="Appraisal board" />
            </Card>
          </>
        )}
      </Body>
      {adding && <NewGoalSheet onClose={() => setAdding(false)} />}
    </>
  );
}
