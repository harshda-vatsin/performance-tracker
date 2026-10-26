import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, TableWrap } from '../components/ui';
import { get, post } from '../lib/api';
import { defaultPeriod, fiscalYearOf, fyLabel } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { OrgUnit, ScorecardRow } from '../lib/types';

export function ScorecardsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [fy, setFy] = useState(fiscalYearOf(defaultPeriod()));
  const list = useAsync(() => get<{ scorecards: ScorecardRow[] }>(`/scorecards?fiscalYear=${fy}`), [fy]);
  const units = useAsync(() => (can('scorecards:create') ? get<{ units: OrgUnit[] }>('/org/units') : Promise.resolve({ units: [] })), []);
  const [adding, setAdding] = useState(false);
  const [unitId, setUnitId] = useState('');
  const { busy, error, run } = useAction();

  const years = [fy - 1, fy, fy + 1];
  const scorable = (units.data?.units ?? []).filter((u) => u.unitType === 'DEPARTMENT' || u.unitType === 'CELL');
  const unit = unitId || scorable[0]?.id || '';

  return (
    <>
      <PageHeader
        title="Scorecards"
        subtitle="One scorecard per scored unit per fiscal year, copied from the active template. Targets can be adjusted by approved change."
        actions={
          <>
            <select className="input !w-auto" aria-label="Fiscal year" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {fyLabel(y)}
                </option>
              ))}
            </select>
            {can('scorecards:create') && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus size={15} /> Create scorecard
              </button>
            )}
          </>
        }
      />
      <Card pad={false}>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorBox onRetry={list.reload}>{list.error}</ErrorBox>
          </div>
        ) : !list.data?.scorecards.length ? (
          <Empty title={`No scorecards for ${fyLabel(fy)}`} hint={can('scorecards:create') ? 'Create one for each scored unit before its months can be entered.' : 'Plant HR creates the scorecards for a fiscal year.'} />
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Unit</th>
                  <th className="th">Fiscal year</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {list.data.scorecards.map((s) => (
                  <tr key={s.id} className="tr-hover">
                    <td className="td font-medium text-slate-900">{s.unitCode}</td>
                    <td className="td">{fyLabel(s.fiscalYear)}</td>
                    <td className="td text-right">
                      <Link className="text-sm font-medium text-accent-800 hover:underline" to={`/scorecards/${s.id}`}>
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
        title="Create scorecard"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!unit || busy}
              onClick={() => void run(async () => {
                const r = await post<{ id: string }>('/scorecards', { orgUnitId: unit, fiscalYear: fy });
                nav(`/scorecards/${r.id}`);
              })}
            >
              Create
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBox>{error}</ErrorBox>}
          <Field label="Unit" htmlFor="sc-unit" hint="Only the plant type's scored level (department or cell) can have a scorecard">
            <select id="sc-unit" className="input" value={unit} onChange={(e) => setUnitId(e.target.value)}>
              {scorable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </select>
          </Field>
          <p className="text-sm text-slate-600">For {fyLabel(fy)}, copied from the plant type's active template.</p>
        </div>
      </Modal>
    </>
  );
}
