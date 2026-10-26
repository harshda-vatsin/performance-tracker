import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';
import { HistoryChart } from '../components/charts/Charts';
import { KpiTable } from '../components/appraisal/KpiTable';
import {
  CommentThread,
  GoalStatusChip,
  PendingWith,
  RatingChip,
  StatusChip,
  WorkflowStepper,
  pendingWith,
} from '../components/appraisal/parts';
import { Avatar, Card, Chip, Empty, PageHeader, TableWrap } from '../components/ui';
import { CYCLE } from '../data/cycle';
import { plantCity } from '../data/org';
import { FIXED_PERSONAS, STAFF_MAP } from '../data/staff';
import { useStaffRows, useStore } from '../store/AppStore';
import type { AppraisalStatus, StageKey } from '../types';
import { bandRangeLabel, bandByKey } from '../utils/scoring';

const STATUS_FILTERS: ('All' | AppraisalStatus)[] = [
  'All',
  'Self-assessment',
  'Manager assessment',
  'Reviewer sign-off',
  'HR finalisation',
  'Finalised',
];

export function AppraisalsPage() {
  const { role, employeeId, focusEmployeeId, setFocusEmployeeId } = useStore();

  if (role === 'employee') {
    return (
      <>
        <PageHeader title="My Appraisal" subtitle={`${CYCLE.label} · ${CYCLE.currentPeriod}`} />
        <AppraisalDetail employeeId={employeeId} />
      </>
    );
  }

  if (focusEmployeeId) {
    return (
      <>
        <button className="btn btn-ghost mb-3 !px-2" onClick={() => setFocusEmployeeId(null)}>
          <ArrowLeft size={15} /> Back to all appraisals
        </button>
        <AppraisalDetail employeeId={focusEmployeeId} />
      </>
    );
  }
  return <AppraisalList />;
}

function AppraisalList() {
  const { role, managerId, openAppraisal } = useStore();
  const rows = useStaffRows();
  const [filter, setFilter] = useState<'All' | AppraisalStatus>('All');

  const scoped = rows.filter((r) => (role === 'manager' ? r.emp.managerId === managerId : true));
  const shown = scoped.filter((r) => filter === 'All' || r.appraisal.status === filter);

  return (
    <>
      <PageHeader
        title="Appraisals"
        subtitle={`${CYCLE.label} · ${CYCLE.currentPeriod}${role === 'manager' ? ' · your team' : ''}`}
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => {
          const n = f === 'All' ? scoped.length : scoped.filter((r) => r.appraisal.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === f ? 'border-accent-300 bg-accent-50 text-accent-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f} <span className="ml-1 text-slate-400">{n}</span>
            </button>
          );
        })}
      </div>
      <Card pad={false}>
        <TableWrap>
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className="th">Employee</th>
                <th className="th">Plant</th>
                <th className="th text-right">Score</th>
                <th className="th">Rating</th>
                <th className="th">Status</th>
                <th className="th">Pending with</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.emp.id} className="tr-hover cursor-pointer" onClick={() => openAppraisal(r.emp.id)}>
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.emp.name} size="sm" />
                      <div>
                        <div className="font-medium text-slate-900">{r.emp.name}</div>
                        <div className="text-xs text-slate-500">
                          {r.emp.role} · {r.emp.empCode}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="td">{plantCity(r.emp.plantId)}</td>
                  <td className="td text-right font-semibold tabular-nums">{r.score === null ? '—' : r.score.toFixed(1)}</td>
                  <td className="td">{r.rating ? <RatingChip score={r.score!} /> : <Chip>—</Chip>}</td>
                  <td className="td">
                    <StatusChip status={r.appraisal.status} />
                  </td>
                  <td className="td">
                    <PendingWith status={r.appraisal.status} emp={r.emp} goalStatus={r.sheet?.status} />
                  </td>
                  <td className="td text-right">
                    <span className="text-xs font-medium text-accent-700">Open →</span>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Empty title="No appraisals in this status" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}

const NEXT_LABEL: Record<StageKey, string> = {
  self: 'Submit self-assessment',
  manager: 'Submit manager assessment',
  reviewer: 'Sign off as reviewer',
  hr: 'Finalise and lock',
};

const PLACEHOLDER: Record<StageKey, string> = {
  self: 'Summarise your half-year: tonnage vs plan, OEE and yield actions, what slipped and why…',
  manager: 'Your assessment of the KPIs, strengths, development areas and recommendation…',
  reviewer: 'Reviewer remarks — calibration against peers and the plant plan…',
  hr: 'HR remarks — calibration outcome and increment recommendation…',
};

function AppraisalDetail({ employeeId }: { employeeId: string }) {
  const { role, employeeId: meId, managerId, goalSheets, appraisals, history, setActual, submitStage, returnToManager, scoreFor, setPage } =
    useStore();
  const emp = STAFF_MAP[employeeId];
  const appraisal = appraisals.find((a) => a.employeeId === employeeId)!;
  const sheet = goalSheets.find((g) => g.employeeId === employeeId);
  const [text, setText] = useState('');

  const status = appraisal.status;
  const locked = status === 'Finalised';
  const live = scoreFor(employeeId);
  const score = locked && appraisal.finalScore !== undefined ? appraisal.finalScore : live.total;
  const band = locked && appraisal.finalRating ? bandByKey(appraisal.finalRating) : live.rating;

  // Who may act now?
  const isOwnSelf = role === 'employee' && meId === employeeId;
  const isTheirManager = role === 'manager' && managerId === emp.managerId;
  const stage: StageKey | null =
    status === 'Self-assessment' && isOwnSelf
      ? 'self'
      : status === 'Manager assessment' && isTheirManager
        ? 'manager'
        : status === 'Reviewer sign-off' && role === 'management'
          ? 'reviewer'
          : status === 'HR finalisation' && role === 'hr'
            ? 'hr'
            : null;
  const canEditManual = stage === 'self' || stage === 'manager';
  const actor =
    stage === 'self' ? emp.name : stage === 'manager' ? emp.managerName : stage === 'reviewer' ? FIXED_PERSONAS.management.name : FIXED_PERSONAS.hr.name;

  const hist = history.filter((h) => h.employeeId === employeeId);
  const points = [...hist.map((h) => ({ cycle: h.cycle, score: h.score })), ...(sheet ? [{ cycle: 'FY 2026-27 (Q2)', score }] : [])];

  const submit = () => {
    if (!stage || !text.trim()) return;
    submitStage(employeeId, stage, text.trim(), actor);
    setText('');
  };

  const waiting = pendingWith(status, emp, sheet?.status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={emp.name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{emp.name}</h2>
              <StatusChip status={status} />
              {locked && (
                <Chip tone="slate">
                  <Lock size={11} /> Locked
                </Chip>
              )}
            </div>
            <div className="mt-0.5 text-sm text-slate-500">
              {emp.role} · {emp.department} · {plantCity(emp.plantId)} · {emp.empCode}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              Manager: {emp.managerName} · Reviewer: {emp.reviewerName}
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{locked ? 'Final score' : 'Live score'}</div>
              <div className="text-3xl font-semibold tabular-nums text-slate-900">{sheet ? score.toFixed(1) : '—'}</div>
            </div>
            {sheet && (
              <div>
                <RatingChip ratingKey={band.key} />
                <div className="mt-1 text-[11px] text-slate-500">Band {bandRangeLabel(band)}</div>
                {locked && appraisal.incrementPct !== undefined && (
                  <div className="mt-0.5 text-[11px] font-medium text-slate-700">Increment {appraisal.incrementPct}%</div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3">
          <WorkflowStepper status={status} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Pending with:</span>
            {waiting ? (
              <>
                <Chip tone="accent">{waiting.role}</Chip>
                <span className="text-slate-700">{waiting.name}</span>
              </>
            ) : (
              <span className="text-slate-700">Nobody — appraisal is final</span>
            )}
          </div>
        </div>
      </Card>

      {!sheet ? (
        <Card>
          <Empty
            title="Goals not yet assigned"
            hint={
              role === 'manager'
                ? 'Open Goals to assign the KRAs from the library and send them for acknowledgement.'
                : 'The reporting manager needs to assign KRAs before the appraisal can start.'
            }
            action={
              role === 'manager' && (
                <button className="btn btn-primary" onClick={() => setPage('goals')}>
                  Go to Goals
                </button>
              )
            }
          />
          <div className="flex justify-center">
            <GoalStatusChip status={undefined} />
          </div>
        </Card>
      ) : (
        <>
          <Card
            title="KPI actuals vs target"
            subtitle={
              canEditManual
                ? 'Manual-entry KPIs are editable now — the score updates as you type.'
                : 'SAP-synced KPIs are read-only. Manual-entry KPIs unlock for the employee (self-assessment) and the manager (manager assessment).'
            }
            pad={false}
          >
            <KpiTable items={sheet.items} actuals={appraisal.actuals} editableManual={canEditManual} onActualChange={(k, v) => setActual(employeeId, k, v)} />
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <Card title="Assessment trail" subtitle="Comments recorded at each step of the workflow">
                <CommentThread comments={appraisal.comments} />
              </Card>

              {stage ? (
                <Card title={NEXT_LABEL[stage]} subtitle={`Acting as ${actor}`}>
                  <textarea className="input min-h-[96px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER[stage]} />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button className="btn btn-primary" disabled={!text.trim()} onClick={submit}>
                      {NEXT_LABEL[stage]}
                    </button>
                    {(stage === 'reviewer' || stage === 'hr') && (
                      <button
                        className="btn btn-secondary"
                        disabled={!text.trim()}
                        onClick={() => {
                          returnToManager(employeeId, text.trim(), actor);
                          setText('');
                        }}
                      >
                        Return to manager
                      </button>
                    )}
                    {!text.trim() && <span className="text-xs text-slate-400">A comment is required.</span>}
                  </div>
                </Card>
              ) : (
                !locked && (
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                    {waiting
                      ? `This appraisal is waiting on ${waiting.role} (${waiting.name}). Switch role in the top bar to act on it.`
                      : 'No action required.'}
                  </div>
                )
              )}
            </div>

            <Card title="Score history" subtitle="Last 3 annual cycles and this review">
              {points.length > 0 ? (
                <HistoryChart points={points} />
              ) : (
                <Empty title="No history yet" hint="New joiner — first appraisal cycle." />
              )}
              <ul className="mt-2 space-y-1 text-xs">
                {hist.map((h) => (
                  <li key={h.cycle} className="flex items-center justify-between">
                    <span className="text-slate-500">{h.cycle}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-700">{h.score}</span>
                      <RatingChip ratingKey={h.rating} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
