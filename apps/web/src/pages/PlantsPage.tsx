import { CheckCheck, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Loading, Modal, PageHeader, StateChip, TableWrap, useToast } from '../components/ui';
import { get, post } from '../lib/api';
import { statesFor, useWorkflowSettings, type WorkflowSettings } from '../lib/workflow';
import { defaultPeriod, fmtScore, humanize, isPeriod, monthLabel } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { Management, OrgUnit, PlantBoard } from '../lib/types';

type Bulk = 'approve' | 'lock';

export function PlantsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const settings = useWorkflowSettings();
  const [sp, setSp] = useSearchParams();
  // Roles such as Management can read months and scores but not the org tree, so the plant list falls back to the
  // management dashboard, which already lists the plants in the caller's scope.
  const orgs = useAsync(async (): Promise<{ id: string; name: string }[]> => {
    if (can('org:read')) return (await get<{ units: OrgUnit[] }>('/org/units')).units.filter((u) => u.unitType === 'PLANT');
    if (can('scores:read')) {
      const m = await get<Management>(`/dashboards/management?period=${defaultPeriod()}`);
      return m.plantTypes.flatMap((t) => t.plants.map((p) => ({ id: p.plantId, name: p.code })));
    }
    return [];
  }, []);
  const plants = orgs.data ?? [];
  const plantId = sp.get('plant') ?? plants[0]?.id ?? '';
  const period = sp.get('period') ?? defaultPeriod();
  const setParam = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); n.set(k, v); if (!n.get('plant') && plantId) n.set('plant', plantId); return n; }, { replace: true });
  const [bulk, setBulk] = useState<Bulk>();

  const board = useAsync(() => (plantId && isPeriod(period) ? get<PlantBoard>(`/plants/${plantId}/months/${period}`) : Promise.resolve(undefined)), [plantId, period]);
  const levels = [...new Set((board.data?.units ?? []).flatMap((u) => u.levels.map((l) => l.levelCode)))];

  return (
    <>
      <PageHeader
        title="Plant status"
        subtitle="Every scored unit of a plant for one month, with its workflow state and, once locked, its official scores."
        actions={
          <>
            <select className="input !w-auto" aria-label="Plant" value={plantId} onChange={(e) => setParam('plant', e.target.value)}>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input type="month" className="input !w-auto" aria-label="Month" value={period} onChange={(e) => setParam('period', e.target.value)} />
          </>
        }
      />
      {orgs.error ? (
        <ErrorBox onRetry={orgs.reload}>{orgs.error}</ErrorBox>
      ) : orgs.loading && !orgs.data ? (
        <Loading />
      ) : plants.length === 0 ? (
        <Card>
          <Empty title="No plants in your scope" />
        </Card>
      ) : board.error ? (
        <ErrorBox onRetry={board.reload}>{board.error}</ErrorBox>
      ) : !board.data ? (
        <Loading />
      ) : (
        <Card
          title={`${monthLabel(board.data.period)}`}
          subtitle={
            <span className="inline-flex flex-wrap gap-1.5">
              {Object.entries(board.data.summary).map(([s, n]) => (
                <Chip key={s}>{n} {humanize(s).toLowerCase()}</Chip>
              ))}
            </span>
          }
          action={
            <div className="flex gap-2">
              {can('submissions:approve') && settings.monthly.plantHeadApprove && (
                <button className="btn btn-secondary" onClick={() => setBulk('approve')}>
                  <CheckCheck size={15} /> Approve all
                </button>
              )}
              {can('submissions:lock') && (
                <button className="btn btn-secondary" onClick={() => setBulk('lock')}>
                  <Lock size={15} /> Lock all
                </button>
              )}
            </div>
          }
          pad={false}
        >
          {board.data.units.length === 0 ? (
            <Empty title="This plant has no scored units" />
          ) : (
            <TableWrap>
              <table className="w-full" aria-label="Plant month board">
                <thead>
                  <tr>
                    <th className="th">Unit</th>
                    <th className="th">State</th>
                    {levels.map((l) => (
                      <th className="th" key={l}>
                        {l}
                      </th>
                    ))}
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {board.data.units.map((u) => (
                    <tr key={u.orgUnitId} className="tr-hover" data-testid={`board-${u.unitCode}`}>
                      <td className="td font-medium text-slate-900">{u.unitCode}</td>
                      <td className="td">
                        <StateChip state={u.state} />
                      </td>
                      {levels.map((l) => (
                        <td className="td tabular-nums" key={l}>
                          {fmtScore(u.levels.find((x) => x.levelCode === l)?.score)}
                        </td>
                      ))}
                      <td className="td text-right">
                        {u.submissionId ? (
                          <Link className="text-sm font-medium text-accent-800 hover:underline" to={`/submissions/${u.submissionId}`}>
                            Open {u.unitCode}
                          </Link>
                        ) : (
                          <span className="muted">Not started</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {bulk && board.data && (
        <BulkDialog
          action={bulk}
          settings={settings}
          board={board.data}
          onClose={() => setBulk(undefined)}
          onDone={(n) => {
            setBulk(undefined);
            toast(`${bulk === 'approve' ? 'Approved' : 'Locked'} ${n} unit${n === 1 ? '' : 's'}`);
            board.reload();
          }}
        />
      )}
    </>
  );
}

function BulkDialog({ action, settings, board, onClose, onDone }: { action: Bulk; settings: WorkflowSettings; board: PlantBoard; onClose: () => void; onDone: (count: number) => void }) {
  const readyStates = statesFor(action, settings);
  const ready = board.units.filter((u) => readyStates.includes(u.state));
  const notReady = board.units.filter((u) => !readyStates.includes(u.state));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const { busy, error, run } = useAction();
  const missing = notReady.some((u) => !excluded[u.orgUnitId] || !(reasons[u.orgUnitId] ?? '').trim());
  const verb = action === 'approve' ? 'Approve' : 'Lock';

  return (
    <Modal
      open
      wide
      title={`${verb} ${monthLabel(board.period)} for the whole plant`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || missing || ready.length === 0}
            onClick={() => void run(async () => {
              await post(`/plants/${board.plantId}/months/${board.period}/transitions`, {
                action,
                exclusions: notReady.map((u) => ({ orgUnitId: u.orgUnitId, reason: reasons[u.orgUnitId].trim() })),
              });
              onDone(ready.length);
            })}
          >
            {verb} {ready.length} unit{ready.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <p className="text-sm text-slate-600">
          All-or-nothing: every unit must be <b>{readyStates.map((st) => humanize(st).toLowerCase()).join(' or ')}</b>, or be excluded with a reason. One history entry is written per unit.
        </p>
        <div>
          <h3 className="section-title mb-1">Will be {action === 'approve' ? 'approved' : 'locked'}</h3>
          {ready.length === 0 ? <p className="muted">No unit is {readyStates.map((st) => humanize(st).toLowerCase()).join(' or ')} yet.</p> : <p className="text-sm">{ready.map((u) => u.unitCode).join(', ')}</p>}
        </div>
        {notReady.length > 0 && (
          <div>
            <h3 className="section-title mb-1">Not ready: exclude with a reason</h3>
            <ul className="space-y-2">
              {notReady.map((u) => (
                <li key={u.orgUnitId} className="rounded-md border border-slate-200 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={!!excluded[u.orgUnitId]} onChange={(e) => setExcluded({ ...excluded, [u.orgUnitId]: e.target.checked })} aria-label={`Exclude ${u.unitCode}`} />
                    {u.unitCode} <StateChip state={u.state} />
                  </label>
                  {excluded[u.orgUnitId] && (
                    <input className="input mt-2" aria-label={`Reason for excluding ${u.unitCode}`} placeholder="Reason (required)" value={reasons[u.orgUnitId] ?? ''} onChange={(e) => setReasons({ ...reasons, [u.orgUnitId]: e.target.value })} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
