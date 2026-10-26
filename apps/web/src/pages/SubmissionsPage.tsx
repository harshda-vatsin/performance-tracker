import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StateChip, TableWrap } from '../components/ui';
import { get, post } from '../lib/api';
import { defaultPeriod, fiscalYearOf, humanize, isPeriod, monthLabel } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { ScorecardRow, SubmissionRow } from '../lib/types';

const STATES = ['DRAFT', 'SUBMITTED', 'VERIFIED', 'APPROVED', 'REJECTED', 'LOCKED', 'REOPENED'];

export function SubmissionsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [period, setPeriod] = useState(defaultPeriod());
  const [state, setState] = useState('');
  const list = useAsync(() => {
    const q = new URLSearchParams();
    if (isPeriod(period)) q.set('period', period);
    if (state) q.set('state', state);
    return get<{ submissions: SubmissionRow[] }>(`/submissions?${q}`);
  }, [period, state]);
  const [adding, setAdding] = useState(false);
  const [newPeriod, setNewPeriod] = useState(period);
  const [unitId, setUnitId] = useState('');
  const cards = useAsync(
    () => (adding && isPeriod(newPeriod) ? get<{ scorecards: ScorecardRow[] }>(`/scorecards?fiscalYear=${fiscalYearOf(newPeriod)}`) : Promise.resolve({ scorecards: [] })),
    [adding, newPeriod],
  );
  const { busy, error, run } = useAction();
  const units = cards.data?.scorecards ?? [];
  const unit = units.some((u) => u.orgUnitId === unitId) ? unitId : (units[0]?.orgUnitId ?? '');

  return (
    <>
      <PageHeader
        title="Monthly entry"
        subtitle="Each scored unit's month moves: draft, submitted, verified, approved, locked."
        actions={
          can('submissions:enter') && (
            <button className="btn btn-primary" onClick={() => { setNewPeriod(period); setAdding(true); }}>
              <Plus size={15} /> Start a month
            </button>
          )
        }
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 md:px-5">
          <input type="month" className="input !w-auto" aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <select className="input !w-auto" aria-label="State" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorBox onRetry={list.reload}>{list.error}</ErrorBox>
          </div>
        ) : !list.data?.submissions.length ? (
          <Empty title="No months match" hint="Change the month or state, or start a month for a unit that has a scorecard." />
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Unit</th>
                  <th className="th">Month</th>
                  <th className="th">State</th>
                  <th className="th">Revision</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {list.data.submissions.map((s) => (
                  <tr key={s.id} className="tr-hover">
                    <td className="td font-medium text-slate-900">{s.unitCode}</td>
                    <td className="td">{monthLabel(s.period)}</td>
                    <td className="td">
                      <StateChip state={s.state} />
                    </td>
                    <td className="td">{s.revision}</td>
                    <td className="td text-right">
                      <Link className="text-sm font-medium text-accent-800 hover:underline" to={`/submissions/${s.id}`}>
                        Open {s.unitCode}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={adding}
        title="Start a month"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!unit || !isPeriod(newPeriod) || busy}
              onClick={() => void run(async () => {
                const r = await post<{ id: string }>('/submissions', { orgUnitId: unit, period: newPeriod });
                nav(`/submissions/${r.id}`);
              })}
            >
              Start
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBox>{error}</ErrorBox>}
          <Field label="Month" htmlFor="new-period">
            <input id="new-period" type="month" className="input" value={newPeriod} onChange={(e) => setNewPeriod(e.target.value)} />
          </Field>
          <Field label="Unit" htmlFor="new-unit" hint="Units with a scorecard for that fiscal year">
            <select id="new-unit" className="input" value={unit} onChange={(e) => setUnitId(e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.orgUnitId}>
                  {u.unitCode}
                </option>
              ))}
            </select>
          </Field>
          {!cards.loading && units.length === 0 && <p className="text-sm text-amber-800">No scorecards exist for that fiscal year in your scope. Create the scorecard first.</p>}
        </div>
      </Modal>
    </>
  );
}
