import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { CycleTimeline, DirectionTag, GoalStatusChip, SourceBadge } from '../components/appraisal/parts';
import { Avatar, Card, Chip, Empty, PageHeader, TableWrap } from '../components/ui';
import { KPI_MAP } from '../data/kpiCatalog';
import { CYCLE } from '../data/cycle';
import { STAFF } from '../data/staff';
import { useStore } from '../store/AppStore';
import type { GoalSheet } from '../types';
import { fmtDate, fmtNumber } from '../utils/format';
import { sumWeights } from '../utils/scoring';

export function GoalsPage() {
  const { role, employeeId, managerId } = useStore();

  if (role === 'employee') {
    return (
      <>
        <PageHeader title="My Goals" subtitle={`${CYCLE.label} · KRAs and targets assigned by your reporting manager`} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <SheetPanel employeeId={employeeId} mode="employee" />
          <Card title="Review calendar" subtitle="Annual cycle, April – March, with quarterly reviews">
            <CycleTimeline />
          </Card>
        </div>
      </>
    );
  }

  return <TeamGoals scopeManagerId={role === 'manager' ? managerId : null} canEdit={role === 'manager'} />;
}

function TeamGoals({ scopeManagerId, canEdit }: { scopeManagerId: string | null; canEdit: boolean }) {
  const { goalSheets } = useStore();
  const people = STAFF.filter((s) => (scopeManagerId ? s.managerId === scopeManagerId : true));
  const [selected, setSelected] = useState<string>(people[0]?.id);
  const sel = people.some((p) => p.id === selected) ? selected : people[0]?.id;

  return (
    <>
      <PageHeader
        title="Goals"
        subtitle={
          canEdit
            ? `${CYCLE.label} · assign KRAs with targets to your team and track acknowledgement`
            : `${CYCLE.label} · goal-setting status across all senior staff (view only)`
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card pad={false} className="self-start">
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {people.map((p) => {
              const sheet = goalSheets.find((g) => g.employeeId === p.id);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setSelected(p.id)}
                    className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors ${
                      sel === p.id ? 'bg-accent-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <Avatar name={p.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{p.name}</div>
                      <div className="truncate text-xs text-slate-500">{p.role}</div>
                      <div className="mt-1">
                        <GoalStatusChip status={sheet?.status} />
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        {sel ? <SheetPanel employeeId={sel} mode={canEdit ? 'manager' : 'readonly'} /> : <Card><Empty title="No team members" /></Card>}
      </div>
    </>
  );
}

function SheetPanel({ employeeId, mode }: { employeeId: string; mode: 'employee' | 'manager' | 'readonly' }) {
  const { goalSheets, appraisals, assignGoals, updateGoalTarget, sendGoalsForAck, acknowledgeGoals, reopenGoals } = useStore();
  const emp = STAFF.find((s) => s.id === employeeId)!;
  const sheet: GoalSheet | undefined = goalSheets.find((g) => g.employeeId === employeeId);
  const appraisal = appraisals.find((a) => a.employeeId === employeeId);
  const [note, setNote] = useState('');

  if (!sheet) {
    return (
      <Card>
        <Empty
          title={mode === 'employee' ? 'Your KRAs have not been assigned yet' : `No goal sheet for ${emp.name} yet`}
          hint={
            mode === 'manager'
              ? `Assign the ${emp.role} KRAs from the library, adjust the targets, then send the sheet for acknowledgement.`
              : 'Goals are assigned by the reporting manager at the start of the cycle.'
          }
          action={
            mode === 'manager' && (
              <button className="btn btn-primary" onClick={() => assignGoals(emp.id, emp.managerName)}>
                Assign {emp.role} KRAs from library
              </button>
            )
          }
        />
      </Card>
    );
  }

  const editable = mode === 'manager' && sheet.status !== 'Acknowledged';
  const total = sumWeights(sheet.items);

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {emp.name} · {emp.role} <GoalStatusChip status={sheet.status} />
        </span>
      }
      subtitle={`Assigned by ${sheet.assignedBy} on ${fmtDate(sheet.assignedOn)}${sheet.acknowledgedOn ? ` · acknowledged ${fmtDate(sheet.acknowledgedOn)}` : ''}`}
      pad={false}
      action={
        mode === 'manager' && (
          <div className="flex gap-2">
            {sheet.status === 'Draft' && (
              <button className="btn btn-primary" onClick={() => sendGoalsForAck(emp.id)}>
                Send for acknowledgement
              </button>
            )}
            {sheet.status === 'Acknowledged' && appraisal?.status !== 'Finalised' && (
              <button className="btn btn-secondary" onClick={() => reopenGoals(emp.id)}>
                Revise targets
              </button>
            )}
          </div>
        )
      }
    >
      <TableWrap>
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th className="th">KRA</th>
              <th className="th">KPI</th>
              <th className="th">Direction</th>
              <th className="th">Data source</th>
              <th className="th text-right">Target</th>
              <th className="th text-right">Weightage</th>
            </tr>
          </thead>
          <tbody>
            {sheet.items.map((i) => (
              <tr key={i.kraId} className="tr-hover">
                <td className="td font-medium text-slate-900">{i.area}</td>
                <td className="td">{i.kpi}</td>
                <td className="td">
                  <DirectionTag direction={i.direction} />
                </td>
                <td className="td">
                  <SourceBadge source={i.source} />
                </td>
                <td className="td text-right">
                  {editable ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <input
                        className="input !w-28 text-right tabular-nums"
                        type="number"
                        step="any"
                        value={i.target}
                        onChange={(e) => updateGoalTarget(emp.id, i.kraId, parseFloat(e.target.value) || 0)}
                      />
                      <span className="w-14 text-left text-xs text-slate-400">{i.unit}</span>
                    </div>
                  ) : (
                    <span className="whitespace-nowrap tabular-nums">
                      {fmtNumber(i.target, KPI_MAP[i.kpiKey]?.decimals ?? 1)} <span className="text-xs text-slate-400">{i.unit}</span>
                    </span>
                  )}
                </td>
                <td className="td text-right font-medium tabular-nums">{i.weightage}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="td font-semibold" colSpan={5}>
                Total weightage
              </td>
              <td className="td text-right font-semibold tabular-nums">{total}%</td>
            </tr>
          </tfoot>
        </table>
      </TableWrap>

      {mode === 'employee' && sheet.status === 'Awaiting acknowledgement' && (
        <div className="border-t border-slate-100 p-4 md:p-5">
          <label className="label">Acknowledgement note (optional)</label>
          <textarea
            className="input min-h-[72px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Agreed. Tonnage target assumes both presses stay available through the festival season."
          />
          <div className="mt-3">
            <button className="btn btn-primary" onClick={() => acknowledgeGoals(emp.id, note)}>
              <CheckCircle2 size={15} /> Acknowledge goals
            </button>
          </div>
        </div>
      )}

      {sheet.status === 'Acknowledged' && (
        <div className="flex items-start gap-2 border-t border-slate-100 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-900 md:px-5">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <div>
            Acknowledged by {emp.name} on {sheet.acknowledgedOn && fmtDate(sheet.acknowledgedOn)}.
            {sheet.acknowledgementNote && <div className="mt-0.5 italic text-emerald-800">“{sheet.acknowledgementNote}”</div>}
          </div>
        </div>
      )}
      {mode === 'manager' && sheet.status === 'Awaiting acknowledgement' && (
        <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600 md:px-5">
          Waiting for <Chip tone="amber">{emp.name}</Chip> to acknowledge. Switch to <b>Employee</b> in the top bar to try the acknowledgement.
        </div>
      )}
    </Card>
  );
}
