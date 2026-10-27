import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Notice, PageHeader, Stat, TableWrap, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { fiscalMonths, fmtDate, fmtScore, fyLabel, monthLabel } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import { DIRECTION_LABEL, quarterOf, STATE_LABEL, type CycleDetail, type MonthView, type RollupView, type SeniorKra } from '../lib/senior';
import { CycleChip, ScoreCell } from './SeniorLists';

type Act = (fn: () => Promise<unknown>, done: string) => Promise<boolean>;

const ACTIONS: Record<string, { label: string; kind: 'primary' | 'danger'; needsComment?: boolean; confirm?: boolean }> = {
  issue: { label: 'Issue goal sheet', kind: 'primary' },
  acknowledge: { label: 'Acknowledge goal sheet', kind: 'primary' },
  dispute: { label: 'Raise a concern', kind: 'danger', needsComment: true },
  open_appraisal: { label: 'Open year-end appraisal', kind: 'primary' },
  submit_self: { label: 'Submit self-assessment', kind: 'primary' },
  submit_manager: { label: 'Submit assessment', kind: 'primary' },
  sign_off: { label: 'Sign off', kind: 'primary' },
  finalise: { label: 'Finalise and lock', kind: 'primary', confirm: true },
  send_back: { label: 'Send back', kind: 'danger', needsComment: true },
};

export function SeniorCyclePage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const detail = useAsync(() => get<CycleDetail>(`/senior/cycles/${id}`), [id]);
  const { busy, error, setError, run } = useAction();
  const [goalsDirty, setGoalsDirty] = useState(false);

  // Every write goes through here: run it, say what happened, then refetch so the screen shows what the server now holds.
  const act: Act = async (fn, done) => {
    const ok = await run(async () => {
      await fn();
      return true;
    });
    if (ok) {
      toast(done);
      detail.reload();
    }
    return !!ok;
  };

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error && !detail.data) {
    return (
      <>
        <PageHeader title="Goal sheet" />
        <ErrorBox onRetry={detail.reload}>{detail.error}</ErrorBox>
      </>
    );
  }
  const d = detail.data!;
  const { cycle, viewer } = d;
  const showMonthly = d.months.length > 0 || viewer.canEnterResults || cycle.state !== 'GOALS_DRAFT';
  const showAppraisal = d.assessments.length > 0 || viewer.assessmentStage !== null;
  const blockIssue = goalsDirty ? 'Save your changes to the goal sheet first.' : viewer.actions.includes('issue') && d.goals.issues[0] ? d.goals.issues[0] : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${cycle.employee.name} · ${fyLabel(cycle.fiscalYear)}`}
        subtitle={`${cycle.employee.code} · Manager ${cycle.manager.name}${cycle.reviewer ? ` · Reviewer ${cycle.reviewer.name}` : ''}`}
        actions={<CycleChip state={cycle.state} />}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label={d.provisional ? 'Score so far' : 'Final score'}
          value={<span data-testid="senior-score">{fmtScore(d.score)}</span>}
          sub={d.band?.label ? `${d.band.label}${d.provisional ? ' (provisional)' : ''}` : 'No confirmed month yet'}
        />
        <Stat label="Waiting on" value={cycle.pendingOn || 'Nobody'} sub={cycle.final ? `Finalised ${fmtDate(cycle.final.finalisedAt)} by ${cycle.final.finalisedBy}` : STATE_LABEL[cycle.state]} />
        <Stat
          label="Goal sheet"
          value={cycle.goalVersion ? `v${cycle.goalVersion}` : 'Draft'}
          sub={cycle.acknowledgedAt ? `Acknowledged ${fmtDate(cycle.acknowledgedAt)}` : 'Not acknowledged yet'}
        />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {cycle.state === 'FINALISED' && <Notice tone="green">Finalised and locked. Nothing on this appraisal can change.</Notice>}

      <ActionBar d={d} id={id} act={act} busy={busy} blocked={blockIssue} clearError={() => setError(undefined)} />

      <Card title="Goal sheet" subtitle="KRAs and the KPIs under them. KRA weights total 100; the KPI weights inside each KRA total 100.">
        {viewer.canEditGoals ? <GoalEditor d={d} id={id} act={act} busy={busy} onDirty={setGoalsDirty} /> : <GoalTable kras={d.goals.kras} />}
      </Card>

      {showMonthly && (
        <Card title="Monthly results" subtitle="The manager enters each month's results and confirms the month, which scores it and locks it.">
          <MonthlyPanel d={d} id={id} act={act} busy={busy} />
        </Card>
      )}

      {d.rollup.total.year.quartersCounted > 0 && (
        <Card title="Quarterly and yearly roll-up" subtitle="Only confirmed months count. The year averages the unrounded quarter scores.">
          <RollupTable d={d} />
        </Card>
      )}

      {showAppraisal && (
        <Card title="Year-end appraisal">
          <AppraisalPanel d={d} id={id} act={act} busy={busy} />
        </Card>
      )}

      <Card title="History">
        {d.events.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          <ol className="space-y-3" aria-label="History">
            {d.events.map((e, i) => (
              <li key={i} className="border-l-2 border-slate-200 pl-3 text-sm">
                <div>
                  <strong>{e.actor}</strong> moved it from {STATE_LABEL[e.fromState]} to <strong>{STATE_LABEL[e.toState]}</strong>
                  <span className="muted"> · {fmtDate(e.at)}</span>
                </div>
                {e.comment && <p className="mt-1 whitespace-pre-wrap border-l-2 border-slate-200 pl-3 text-slate-600">{e.comment}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ actions

function ActionBar({ d, id, act, busy, blocked, clearError }: { d: CycleDetail; id: string; act: Act; busy: boolean; blocked: string | null; clearError: () => void }) {
  const [comment, setComment] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const actions = Object.keys(ACTIONS).filter((a) => d.viewer.actions.includes(a));
  if (actions.length === 0) return null;
  const wantsComment = actions.some((a) => ACTIONS[a].needsComment);

  const fire = async (action: string) => {
    clearError();
    const ok = await act(() => post(`/senior/cycles/${id}/transitions`, { action, comment: comment.trim() || undefined }), `${ACTIONS[action].label}: done`);
    if (ok) setComment('');
    setConfirming(null);
  };

  return (
    <Card title="What you can do now">
      <div className="space-y-3">
        {wantsComment && (
          <Field label="Comment" htmlFor="sr-comment" hint="Required to send back or raise a concern; optional otherwise.">
            <textarea id="sr-comment" className="input min-h-[72px]" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
          </Field>
        )}
        {blocked && <Notice tone="amber">{blocked}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((a) => {
            const spec = ACTIONS[a];
            if (spec.confirm && confirming === a) {
              return (
                <span key={a} className="inline-flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-600">This locks the appraisal permanently.</span>
                  <button className="btn btn-primary" disabled={busy} onClick={() => void fire(a)}>
                    Yes, finalise
                  </button>
                  <button className="btn btn-secondary" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </span>
              );
            }
            const disabled = busy || (spec.needsComment && !comment.trim()) || (a === 'issue' && blocked !== null);
            return (
              <button key={a} className={`btn ${spec.kind === 'primary' ? 'btn-primary' : 'btn-danger'}`} disabled={disabled} onClick={() => (spec.confirm ? setConfirming(a) : void fire(a))}>
                {spec.label}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------- goal sheet

function GoalTable({ kras }: { kras: SeniorKra[] }) {
  if (kras.length === 0) return <Empty title="No goals have been set yet" />;
  return (
    <TableWrap>
      <table className="w-full min-w-[720px]" aria-label="Goal sheet">
        <thead>
          <tr>
            <th className="th">KRA / KPI</th>
            <th className="th">Unit</th>
            <th className="th text-right">Present level</th>
            {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
              <th key={q} className="th text-right">
                {q}
              </th>
            ))}
            <th className="th text-right">Weight</th>
          </tr>
        </thead>
        <tbody>
          {kras.flatMap((k) => [
            <tr key={k.id} className="bg-slate-50">
              <td className="td font-semibold text-slate-900" colSpan={7}>
                {k.nameEn}
                {k.description && <div className="muted font-normal">{k.description}</div>}
              </td>
              <td className="td text-right font-semibold tabular-nums">{k.weight}</td>
            </tr>,
            ...k.kpis.map((p) => (
              <tr key={p.id}>
                <td className="td">
                  {p.nameEn}
                  <div className="muted">{DIRECTION_LABEL[p.direction]}</div>
                </td>
                <td className="td">{p.unit}</td>
                <td className="td text-right tabular-nums">{p.presentLevel}</td>
                {p.targets.map((t, i) => (
                  <td key={i} className="td text-right tabular-nums">
                    {t}
                  </td>
                ))}
                <td className="td text-right tabular-nums">{p.weight}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </TableWrap>
  );
}

interface KpiDraft {
  name: string;
  unit: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  presentLevel: string;
  targets: string[];
  weight: string;
}
interface KraDraft {
  name: string;
  description: string;
  weight: string;
  kpis: KpiDraft[];
}

const blankKpi = (): KpiDraft => ({ name: '', unit: '%', direction: 'HIGHER_BETTER', presentLevel: '', targets: ['', '', '', ''], weight: '' });
const blankKra = (): KraDraft => ({ name: '', description: '', weight: '', kpis: [blankKpi()] });
const toDraft = (kras: SeniorKra[]): KraDraft[] =>
  kras.length === 0
    ? [blankKra()]
    : kras.map((k) => ({
        name: k.nameEn,
        description: k.description ?? '',
        weight: String(k.weight),
        kpis: k.kpis.map((p) => ({ name: p.nameEn, unit: p.unit, direction: p.direction, presentLevel: String(p.presentLevel), targets: p.targets.map(String), weight: String(p.weight) })),
      }));

const total = (xs: string[]) => Math.round(xs.reduce((s, x) => s + (Number(x) || 0), 0) * 100) / 100;

function GoalEditor({ d, id, act, busy, onDirty }: { d: CycleDetail; id: string; act: Act; busy: boolean; onDirty: (dirty: boolean) => void }) {
  const [kras, setKras] = useState<KraDraft[]>(() => toDraft(d.goals.kras));
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string>();
  // Pick up the server's version after a save or reload, but never overwrite what the user is typing.
  useEffect(() => {
    if (!dirty) setKras(toDraft(d.goals.kras));
  }, [d, dirty]);

  const edit = (fn: (draft: KraDraft[]) => void) => {
    const next = structuredClone(kras);
    fn(next);
    setKras(next);
    setDirty(true);
    onDirty(true);
  };

  async function save() {
    const num = (v: string, what: string) => {
      if (v.trim() === '' || Number.isNaN(Number(v))) throw new Error(`${what} must be a number.`);
      return Number(v);
    };
    let body;
    try {
      body = {
        kras: kras.map((k, i) => ({
          name: k.name,
          description: k.description || null,
          weight: num(k.weight, `The weight of KRA ${i + 1}`),
          kpis: k.kpis.map((p, j) => ({
            name: p.name,
            unit: p.unit,
            direction: p.direction,
            presentLevel: num(p.presentLevel, `The present level of KPI ${j + 1} in KRA ${i + 1}`),
            targets: p.targets.map((t, q) => num(t, `The Q${q + 1} target of KPI ${j + 1} in KRA ${i + 1}`)),
            weight: num(p.weight, `The weight of KPI ${j + 1} in KRA ${i + 1}`),
          })),
        })),
      };
    } catch (e) {
      setProblem((e as Error).message);
      return;
    }
    setProblem(undefined);
    if (await act(() => put(`/senior/cycles/${id}/goals`, body), 'Goal sheet saved')) {
      setDirty(false);
      onDirty(false);
    }
  }

  const kraTotal = total(kras.map((k) => k.weight));
  return (
    <div className="space-y-4">
      {kras.map((k, i) => {
        const kpiTotal = total(k.kpis.map((p) => p.weight));
        return (
          <fieldset key={i} className="rounded-md border border-slate-200 p-3" aria-label={`KRA ${i + 1}`}>
            <div className="grid gap-3 md:grid-cols-[1fr_8rem_auto] md:items-end">
              <Field label="KRA name" htmlFor={`kra-${i}-name`}>
                <input id={`kra-${i}-name`} className="input" value={k.name} maxLength={200} onChange={(e) => edit((x) => (x[i].name = e.target.value))} />
              </Field>
              <Field label="KRA weight" htmlFor={`kra-${i}-weight`}>
                <input id={`kra-${i}-weight`} className="input" inputMode="decimal" value={k.weight} onChange={(e) => edit((x) => (x[i].weight = e.target.value))} />
              </Field>
              <button className="btn btn-secondary" disabled={kras.length === 1} onClick={() => edit((x) => x.splice(i, 1))}>
                Remove KRA {i + 1}
              </button>
            </div>
            {k.kpis.map((p, j) => (
              <div key={j} className="mt-3 border-t border-dashed border-slate-200 pt-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="lg:col-span-2">
                    <Field label="KPI name" htmlFor={`kra-${i}-kpi-${j}-name`}>
                      <input id={`kra-${i}-kpi-${j}-name`} className="input" value={p.name} maxLength={200} onChange={(e) => edit((x) => (x[i].kpis[j].name = e.target.value))} />
                    </Field>
                  </div>
                  <Field label="Unit" htmlFor={`kra-${i}-kpi-${j}-unit`}>
                    <input id={`kra-${i}-kpi-${j}-unit`} className="input" value={p.unit} maxLength={30} onChange={(e) => edit((x) => (x[i].kpis[j].unit = e.target.value))} />
                  </Field>
                  <Field label="Direction" htmlFor={`kra-${i}-kpi-${j}-dir`}>
                    <select id={`kra-${i}-kpi-${j}-dir`} className="input" value={p.direction} onChange={(e) => edit((x) => (x[i].kpis[j].direction = e.target.value as KpiDraft['direction']))}>
                      <option value="HIGHER_BETTER">{DIRECTION_LABEL.HIGHER_BETTER}</option>
                      <option value="LOWER_BETTER">{DIRECTION_LABEL.LOWER_BETTER}</option>
                    </select>
                  </Field>
                  <Field label="Present level" htmlFor={`kra-${i}-kpi-${j}-pl`}>
                    <input id={`kra-${i}-kpi-${j}-pl`} className="input" inputMode="decimal" value={p.presentLevel} onChange={(e) => edit((x) => (x[i].kpis[j].presentLevel = e.target.value))} />
                  </Field>
                  {p.targets.map((t, q) => (
                    <Field key={q} label={`Q${q + 1} target`} htmlFor={`kra-${i}-kpi-${j}-q${q + 1}`}>
                      <input id={`kra-${i}-kpi-${j}-q${q + 1}`} className="input" inputMode="decimal" value={t} onChange={(e) => edit((x) => (x[i].kpis[j].targets[q] = e.target.value))} />
                    </Field>
                  ))}
                  <Field label="KPI weight" htmlFor={`kra-${i}-kpi-${j}-weight`}>
                    <input id={`kra-${i}-kpi-${j}-weight`} className="input" inputMode="decimal" value={p.weight} onChange={(e) => edit((x) => (x[i].kpis[j].weight = e.target.value))} />
                  </Field>
                  <div className="flex items-end">
                    <button className="btn btn-secondary" disabled={k.kpis.length === 1} onClick={() => edit((x) => x[i].kpis.splice(j, 1))}>
                      Remove KPI {j + 1}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className="btn btn-secondary" onClick={() => edit((x) => x[i].kpis.push(blankKpi()))}>
                Add KPI to KRA {i + 1}
              </button>
              <span className={`text-xs ${kpiTotal === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>KPI weights total {kpiTotal} / 100</span>
            </div>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-secondary" onClick={() => edit((x) => x.push(blankKra()))}>
          Add KRA
        </button>
        <span className={`text-xs ${kraTotal === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>KRA weights total {kraTotal} / 100</span>
        <span className="flex-1" />
        {dirty && <span className="muted">Unsaved changes</span>}
        <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
          Save goal sheet
        </button>
      </div>
      {problem && <ErrorBox>{problem}</ErrorBox>}
    </div>
  );
}

// ------------------------------------------------------------------ monthly

interface Entry {
  result: string;
  na: boolean;
  reason: string;
}

function MonthlyPanel({ d, id, act, busy }: { d: CycleDetail; id: string; act: Act; busy: boolean }) {
  const months = fiscalMonths(d.cycle.fiscalYear);
  const byPeriod = new Map(d.months.map((m) => [m.period, m]));
  const [period, setPeriod] = useState(() => months.find((p) => byPeriod.get(p)?.state !== 'CONFIRMED') ?? months[11]);
  const month: MonthView | undefined = byPeriod.get(period);
  const editable = d.viewer.canEnterResults && month?.state !== 'CONFIRMED';
  const kpis = d.goals.kras.flatMap((k) => k.kpis);
  const [rows, setRows] = useState<Record<string, Entry>>({});
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    const next: Record<string, Entry> = {};
    for (const p of kpis) {
      const m = month?.kpis.find((x) => x.kpiId === p.id);
      next[p.id] = { result: m?.result == null ? '' : String(m.result), na: !!m?.naReason, reason: m?.naReason ?? '' };
    }
    setRows(next);
    setProblem(undefined);
    // Reset the form whenever the server data or the chosen month changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, period]);

  if (kpis.length === 0) return <Empty title="Monthly results can be entered once goals are set" />;
  const set = (kpiId: string, patch: Partial<Entry>) => setRows((r) => ({ ...r, [kpiId]: { ...r[kpiId], ...patch } }));

  const payload = () =>
    kpis.map((p) => {
      const r = rows[p.id];
      if (r.na) {
        if (!r.reason.trim()) throw new Error(`Give a reason for marking "${p.nameEn}" as N/A.`);
        return { kpiId: p.id, result: null, naReason: r.reason.trim() };
      }
      if (r.result.trim() !== '' && Number.isNaN(Number(r.result))) throw new Error(`The result for "${p.nameEn}" must be a number.`);
      return { kpiId: p.id, result: r.result.trim() === '' ? null : Number(r.result), naReason: null };
    });

  const save = async (confirm: boolean) => {
    let results;
    try {
      results = payload();
    } catch (e) {
      setProblem((e as Error).message);
      return;
    }
    setProblem(undefined);
    await act(async () => {
      await put(`/senior/cycles/${id}/results/${period}`, { results });
      if (confirm) await post(`/senior/cycles/${id}/months/${period}/confirm`);
    }, confirm ? `${monthLabel(period)} confirmed and locked` : `${monthLabel(period)} saved as a draft`);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12" role="group" aria-label="Month">
        {months.map((p) => {
          const m = byPeriod.get(p);
          return (
            <button
              key={p}
              aria-pressed={p === period}
              aria-label={`${monthLabel(p)}${m ? (m.state === 'CONFIRMED' ? ', confirmed' : ', draft') : ''}`}
              className={`rounded-md border px-1 py-1.5 text-center text-xs leading-tight ${
                p === period ? 'ring-2 ring-accent-500' : ''
              } ${m?.state === 'CONFIRMED' ? 'border-emerald-200 bg-emerald-50' : m ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}
              onClick={() => setPeriod(p)}
            >
              {monthLabel(p).slice(0, 3)}
              <span className="block text-slate-500">{m ? (m.state === 'CONFIRMED' ? fmtScore(m.total) : 'draft') : '–'}</span>
            </button>
          );
        })}
      </div>
      <p className="muted">
        {monthLabel(period)} · {month?.state === 'CONFIRMED' ? `confirmed ${fmtDate(month.confirmedAt!)}` : month ? 'draft, not yet counted in the roll-up' : 'not started'} · Q{quarterOf(period)} targets apply
      </p>
      <TableWrap>
        <table className="w-full min-w-[640px]" aria-label={`Results for ${monthLabel(period)}`}>
          <thead>
            <tr>
              <th className="th">KPI</th>
              <th className="th text-right">Present level</th>
              <th className="th text-right">Target</th>
              <th className="th">Result</th>
              <th className="th text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {d.goals.kras.flatMap((k) => [
              <tr key={k.id} className="bg-slate-50">
                <td className="td font-semibold text-slate-900" colSpan={4}>
                  {k.nameEn}
                </td>
                <td className="td text-right font-semibold tabular-nums">{fmtScore(month?.kras.find((x) => x.kraId === k.id)?.score)}</td>
              </tr>,
              ...k.kpis.map((p) => {
                const m = month?.kpis.find((x) => x.kpiId === p.id);
                const r = rows[p.id];
                return (
                  <tr key={p.id}>
                    <td className="td">
                      {p.nameEn} <span className="muted">({p.unit})</span>
                    </td>
                    <td className="td text-right tabular-nums">{m?.presentLevel ?? p.presentLevel}</td>
                    <td className="td text-right tabular-nums">{m?.target ?? p.targets[quarterOf(period) - 1]}</td>
                    <td className="td">
                      {editable && r ? (
                        <div className="flex items-center gap-2">
                          {r.na ? (
                            <input className="input" aria-label={`N/A reason for ${p.nameEn}`} placeholder="Reason for N/A" value={r.reason} onChange={(e) => set(p.id, { reason: e.target.value })} />
                          ) : (
                            <input className="input !w-28" aria-label={`Result for ${p.nameEn}`} inputMode="decimal" value={r.result} onChange={(e) => set(p.id, { result: e.target.value })} />
                          )}
                          <label className="flex items-center gap-1 text-xs text-slate-600">
                            <input type="checkbox" checked={r.na} onChange={(e) => set(p.id, { na: e.target.checked })} /> N/A
                          </label>
                        </div>
                      ) : m?.naReason ? (
                        <span className="text-slate-500">N/A — {m.naReason}</span>
                      ) : m?.result != null ? (
                        <span className="tabular-nums">{m.result}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      {m?.flags.includes('CAPPED') && (
                        <span className="ml-2">
                          <Chip tone="blue">capped</Chip>
                        </span>
                      )}
                    </td>
                    <td className="td text-right tabular-nums">{fmtScore(m?.score)}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
          {month && (
            <tfoot>
              <tr>
                <td className="td font-semibold" colSpan={4}>
                  Month total
                </td>
                <td className="td text-right font-semibold tabular-nums" data-testid="month-total">
                  {fmtScore(month.total)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </TableWrap>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-secondary" disabled={busy} onClick={() => void save(false)}>
            Save month draft
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save(true)}>
            Save and confirm month
          </button>
          <span className="muted">Confirming needs every KPI to have a result or an N/A reason, and locks the month.</span>
        </div>
      )}
      {problem && <ErrorBox>{problem}</ErrorBox>}
    </div>
  );
}

// ------------------------------------------------------------------ roll-up

function RollupTable({ d }: { d: CycleDetail }) {
  const row = (label: string, r: RollupView, strong = false) => (
    <tr key={label} className={strong ? 'bg-slate-50 font-semibold' : undefined}>
      <td className="td">{label}</td>
      {r.quarters.map((q) => (
        <td key={q.quarter} className="td text-right tabular-nums">
          {fmtScore(q.score)}
          <div className="muted font-normal">{q.monthsCounted} mo</div>
        </td>
      ))}
      <td className="td text-right tabular-nums">{fmtScore(r.year.score)}</td>
    </tr>
  );
  return (
    <>
      <TableWrap>
        <table className="w-full min-w-[560px]" aria-label="Roll-up">
          <thead>
            <tr>
              <th className="th" />
              <th className="th text-right">Q1 Apr–Jun</th>
              <th className="th text-right">Q2 Jul–Sep</th>
              <th className="th text-right">Q3 Oct–Dec</th>
              <th className="th text-right">Q4 Jan–Mar</th>
              <th className="th text-right">Year</th>
            </tr>
          </thead>
          <tbody>
            {row('Total', d.rollup.total, true)}
            {d.goals.kras.filter((k) => d.rollup.kras[k.id]).map((k) => row(k.nameEn, d.rollup.kras[k.id]))}
          </tbody>
        </table>
      </TableWrap>
      <p className="muted mt-2">
        {d.provisional ? 'Provisional until the appraisal is finalised.' : 'Final and locked.'} Rating bands:{' '}
        {[...d.bands]
          .sort((a, b) => b.minScore - a.minScore)
          .map((b) => `${b.label} ≥ ${b.minScore}`)
          .join(' · ')}
      </p>
    </>
  );
}

// ---------------------------------------------------------------- appraisal

const STAGE_LABEL = { SELF: 'Self-assessment', MANAGER: 'Manager assessment' } as const;

function AppraisalPanel({ d, id, act, busy }: { d: CycleDetail; id: string; act: Act; busy: boolean }) {
  const stage = d.viewer.assessmentStage;
  const mine = d.assessments.find((a) => a.stage === stage);
  const [summary, setSummary] = useState(mine?.summary ?? '');
  const [comments, setComments] = useState<Record<string, string>>(mine?.kraComments ?? {});
  useEffect(() => {
    setSummary(mine?.summary ?? '');
    setComments(mine?.kraComments ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  const others = d.assessments.filter((a) => a.stage !== stage);

  return (
    <div className="space-y-4">
      {stage && (
        <div className="space-y-3">
          <h3 className="section-title">Your {STAGE_LABEL[stage].toLowerCase()}</h3>
          <Field label="Overall summary of the year" htmlFor="sa-summary">
            <textarea id="sa-summary" className="input min-h-[110px]" value={summary} maxLength={4000} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          {d.goals.kras.map((k) => (
            <Field key={k.id} label={`${k.nameEn} (optional)`} htmlFor={`sa-${k.id}`}>
              <textarea id={`sa-${k.id}`} className="input min-h-[56px]" value={comments[k.id] ?? ''} maxLength={2000} onChange={(e) => setComments((c) => ({ ...c, [k.id]: e.target.value }))} />
            </Field>
          ))}
          <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => put(`/senior/cycles/${id}/assessment`, { summary, kraComments: comments }), 'Assessment draft saved. Submit it from “What you can do now”.')}>
            Save assessment draft
          </button>
        </div>
      )}
      {others.map((a) => (
        <div key={a.stage} data-testid={`assessment-${a.stage}`}>
          <h3 className="section-title">
            {STAGE_LABEL[a.stage]}{' '}
            <span className="muted font-normal">
              · {a.author}
              {a.submittedAt ? ` · submitted ${fmtDate(a.submittedAt)}` : ' · draft'}
            </span>
          </h3>
          <p className="mt-1 whitespace-pre-wrap border-l-2 border-slate-200 pl-3 text-sm text-slate-700">{a.summary || '—'}</p>
          {d.goals.kras
            .filter((k) => a.kraComments[k.id])
            .map((k) => (
              <p key={k.id} className="mt-1 text-sm">
                <strong>{k.nameEn}:</strong> {a.kraComments[k.id]}
              </p>
            ))}
        </div>
      ))}
      {d.cycle.final && (
        <Notice tone="green">
          <span data-testid="final-rating">
            Final rating: <strong>{d.cycle.final.band?.label}</strong> ({fmtScore(d.cycle.final.score)})
          </span>
        </Notice>
      )}
      {!stage && others.length === 0 && !d.cycle.final && (
        <p className="muted">
          Nothing to write at this stage. <ScoreCell row={{ score: d.score, band: d.band, provisional: d.provisional }} />
        </p>
      )}
      <p className="muted">
        <Link className="text-accent-700 hover:underline" to="/appraisals">
          Reviewer assignments are on the Appraisals screen.
        </Link>
      </p>
    </div>
  );
}
