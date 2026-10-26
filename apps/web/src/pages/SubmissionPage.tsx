import { Save, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, StateChip, TableWrap, useToast } from '../components/ui';
import { ApiError, get, post, put } from '../lib/api';
import { daysIn, fmtDateTime, fmtNumber, fmtScore, humanize, monthLabel } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { Employee, OfficialScores, Preview, SubmissionDetail } from '../lib/types';
import { farFromPresentLevel, parseNum, resultProblem } from '../lib/validate';

interface RowEdit {
  result: string;
  na: boolean;
  naReason: string;
  remarks: string;
}

type Step = { action: 'submit' | 'verify' | 'approve' | 'lock' | 'reject' | 'resume'; label: string; perm: string; tone?: 'danger'; comment?: 'required' | 'optional' };

/** What each state offers, and the permission each step needs (apps/api submissions.ts ACTIONS). */
function stepsFor(state: string): Step[] {
  switch (state) {
    case 'DRAFT':
    case 'REOPENED':
      return [{ action: 'submit', label: 'Submit for verification', perm: 'submissions:submit', comment: state === 'REOPENED' ? 'required' : undefined }];
    case 'SUBMITTED':
      return [
        { action: 'verify', label: 'Verify', perm: 'submissions:verify' },
        { action: 'reject', label: 'Reject', perm: 'submissions:verify', tone: 'danger', comment: 'required' },
      ];
    case 'VERIFIED':
      return [
        { action: 'approve', label: 'Approve', perm: 'submissions:approve' },
        { action: 'reject', label: 'Reject', perm: 'submissions:approve', tone: 'danger', comment: 'required' },
      ];
    case 'APPROVED':
      return [
        { action: 'lock', label: 'Lock', perm: 'submissions:lock' },
        { action: 'reject', label: 'Reject', perm: 'submissions:lock', tone: 'danger', comment: 'required' },
      ];
    case 'REJECTED':
      return [{ action: 'resume', label: 'Resume editing', perm: 'submissions:enter' }];
    default:
      return [];
  }
}

export function SubmissionPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const detail = useAsync(() => get<SubmissionDetail>(`/submissions/${id}`), [id]);
  const preview = useAsync(() => get<Preview>(`/submissions/${id}/preview`), [id]);
  const d = detail.data;
  const state = d?.submission.state;
  const locked = state === 'LOCKED';
  const official = useAsync(() => (locked && can('scores:read') ? get<OfficialScores>(`/submissions/${id}/scores`) : Promise.resolve(undefined)), [id, locked]);

  const editable = (state === 'DRAFT' || state === 'REOPENED') && can('submissions:enter');
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [dirty, setDirty] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [step, setStep] = useState<Step>();
  const [reopen, setReopen] = useState(false);
  const act = useAction();
  const saver = useAction();

  // Rebuild the form whenever the server copy changes (first load, after save, after a transition).
  useEffect(() => {
    if (!d) return;
    setEdits(Object.fromEntries(d.results.map((r) => [r.kraId, { result: r.result === null ? '' : String(r.result), na: r.naReason !== null, naReason: r.naReason ?? '', remarks: r.remarks ?? '' }])));
    setDirty(false);
  }, [d]);

  const rawByResult = useMemo(() => new Map((preview.data?.kras ?? []).map((k) => [k.resultId, k])), [preview.data]);

  /** Per-row message: blocking problems and softer hints, using the same rules as the API. */
  const rowIssue = (r: SubmissionDetail['results'][number]): { text: string; blocking: boolean } | null => {
    const e = edits[r.kraId];
    if (!e) return null;
    if (e.na) return e.naReason.trim() ? null : { text: 'Give a reason for N/A', blocking: true };
    const n = parseNum(e.result);
    if (n === null) return attempted ? { text: 'Needs a result or an N/A reason before submitting', blocking: false } : null;
    const problem = resultProblem(r.unit, n);
    if (problem) return { text: problem.charAt(0).toUpperCase() + problem.slice(1), blocking: true };
    if (!e.remarks.trim()) {
      const raw = rawByResult.get(r.resultId)?.raw;
      if (farFromPresentLevel(r.presentLevel, n) || (raw !== null && raw !== undefined && (raw < -100 || raw > 200))) {
        return { text: 'Outlier: add a comment explaining this result', blocking: false };
      }
    }
    return null;
  };

  const blocking = (d?.results ?? []).filter((r) => rowIssue(r)?.blocking);

  async function saveResults(): Promise<boolean> {
    if (!d) return false;
    setAttempted(true);
    if (blocking.length > 0) {
      saver.setError(`Fix ${blocking.length} highlighted row${blocking.length === 1 ? '' : 's'} before saving`);
      return false;
    }
    const ok = await saver.run(async () => {
      await put(`/submissions/${id}/results`, {
        results: d.results.map((r) => {
          const e = edits[r.kraId];
          const remarks = e.remarks.trim() || null;
          return e.na ? { kraId: r.kraId, result: null, naReason: e.naReason.trim(), remarks } : { kraId: r.kraId, result: parseNum(e.result), naReason: null, remarks };
        }),
      });
      return true;
    });
    if (ok) {
      detail.reload();
      preview.reload();
    }
    return !!ok;
  }

  async function runStep(s: Step, comment: string | null) {
    setServerIssues([]);
    if (s.action === 'submit' && editable && (dirty || !attempted)) {
      if (!(await saveResults())) return;
    }
    const res = await act.run(async () => {
      try {
        return await post<{ state: string }>(`/submissions/${id}/transitions`, { action: s.action, revision: d!.submission.revision, ...(comment ? { comment } : {}) });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'SUBMISSION_INVALID') setServerIssues((e.body.issues ?? []).map((i: { message: string }) => i.message));
        throw e;
      }
    });
    if (res) {
      toast(`${s.label}: now ${humanize(res.state).toLowerCase()}`);
      setStep(undefined);
      detail.reload();
      preview.reload();
    }
  }

  if (detail.loading && !d) return <Loading />;
  if (detail.error || !d) return <ErrorBox onRetry={detail.reload}>{detail.error ?? 'Month not found'}</ErrorBox>;
  const sub = d.submission;
  const steps = stepsFor(sub.state).filter((s) => can(s.perm));
  const levelCodes = preview.data?.levels.map((l) => l.levelCode) ?? [];
  const set = (kraId: string, p: Partial<RowEdit>) => {
    setEdits((e) => ({ ...e, [kraId]: { ...e[kraId], ...p } }));
    setDirty(true);
  };

  return (
    <>
      <PageHeader
        title={`${sub.unitCode} · ${monthLabel(sub.period)}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link to="/submissions" className="text-accent-800 hover:underline">
              All months
            </Link>
            <StateChip state={sub.state} />
            <span>Revision {sub.revision}</span>
          </span>
        }
        actions={
          <>
            {editable && (
              <button className="btn btn-secondary" disabled={saver.busy || !dirty} onClick={() => void saveResults().then((ok) => ok && toast('Saved'))}>
                <Save size={15} /> Save
              </button>
            )}
            {steps.map((s) => (
              <button
                key={s.action}
                className={`btn ${s.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                disabled={act.busy || saver.busy}
                onClick={() => (s.comment ? setStep(s) : void runStep(s, null))}
              >
                {s.action === 'submit' && <Send size={15} />} {s.label}
              </button>
            ))}
            {locked && can('reopen:request') && (
              <button className="btn btn-secondary" onClick={() => setReopen(true)}>
                Request reopen
              </button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {act.error && <ErrorBox>{act.error}</ErrorBox>}
        {serverIssues.length > 0 && (
          <ErrorBox>
            <div className="font-medium">Cannot submit yet:</div>
            <ul className="ml-4 list-disc">
              {serverIssues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </ErrorBox>
        )}
        {saver.error && <ErrorBox>{saver.error}</ErrorBox>}
        {sub.state === 'REOPENED' && <Notice tone="amber">This month was reopened. Any changed result needs a new comment before it can be submitted again.</Notice>}
        {!editable && !locked && sub.state !== 'DRAFT' && <Notice>Results are read-only while the month is {humanize(sub.state).toLowerCase()}.</Notice>}
        {locked && <Notice tone="green">Locked: these are the official results. Changes need an approved reopen.</Notice>}

        <Card title="Results" subtitle="Enter this month's result for each KRA, or mark it N/A with a reason." pad={false}>
          <TableWrap>
            <table className="w-full min-w-[900px]" aria-label="Monthly results">
              <thead>
                <tr>
                  <th className="th">Cat</th>
                  <th className="th">KRA</th>
                  <th className="th">Present</th>
                  <th className="th">Target</th>
                  <th className="th">Result</th>
                  <th className="th">N/A</th>
                  <th className="th">Comment</th>
                  <th className="th">{preview.data?.official ? 'Score' : 'Score (preview)'}</th>
                </tr>
              </thead>
              <tbody>
                {d.results.map((r) => {
                  const e = edits[r.kraId];
                  const issue = rowIssue(r);
                  const score = rawByResult.get(r.resultId);
                  if (!e) return null;
                  return (
                    <tr key={r.kraId} className="align-top" data-testid={`row-${r.nameEn}`}>
                      <td className="td">
                        <Chip tone="accent">{r.pqcdsm}</Chip>
                      </td>
                      <td className="td min-w-[180px]">
                        <div className="font-medium text-slate-900">{r.nameEn}</div>
                        <div className="muted">
                          {r.unit} · {r.direction === 'HIGHER_BETTER' ? 'higher' : 'lower'} is better
                        </div>
                      </td>
                      <td className="td tabular-nums">{fmtNumber(r.presentLevel)}</td>
                      <td className="td tabular-nums">{fmtNumber(r.target)}</td>
                      <td className="td">
                        {editable ? (
                          <input
                            className={`input !w-28 text-right tabular-nums ${issue?.blocking ? 'input-invalid' : ''}`}
                            inputMode="decimal"
                            aria-label={`Result for ${r.nameEn}`}
                            aria-invalid={issue?.blocking || undefined}
                            disabled={e.na}
                            value={e.result}
                            onChange={(ev) => set(r.kraId, { result: ev.target.value })}
                          />
                        ) : (
                          <span className="tabular-nums">{e.na ? 'N/A' : e.result || '—'}</span>
                        )}
                        {issue && (
                          <p className={`mt-1 max-w-[16rem] text-xs ${issue.blocking ? 'text-red-700' : 'text-amber-800'}`} data-testid="row-issue">
                            {issue.text}
                          </p>
                        )}
                      </td>
                      <td className="td">
                        {editable ? (
                          <div className="space-y-1">
                            <input type="checkbox" aria-label={`N/A for ${r.nameEn}`} checked={e.na} onChange={(ev) => set(r.kraId, { na: ev.target.checked, ...(ev.target.checked ? { result: '' } : {}) })} />
                            {e.na && <input className="input" aria-label={`N/A reason for ${r.nameEn}`} placeholder="Reason" value={e.naReason} onChange={(ev) => set(r.kraId, { naReason: ev.target.value })} />}
                          </div>
                        ) : e.na ? (
                          <span className="text-sm">{e.naReason}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="td min-w-[180px]">
                        {editable ? <input className="input" aria-label={`Comment for ${r.nameEn}`} value={e.remarks} onChange={(ev) => set(r.kraId, { remarks: ev.target.value })} /> : <span className="text-sm">{e.remarks || '—'}</span>}
                      </td>
                      <td className="td tabular-nums">{score ? fmtScore(score.final) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <ScoresCard preview={preview.data} official={official.data} />
          <PeopleCard detail={d} editable={editable} levelCodes={levelCodes} period={sub.period} subId={id} onSaved={() => { detail.reload(); preview.reload(); }} />
        </div>

        <Card title="History" pad={false}>
          {d.events.length === 0 ? (
            <Empty title="No workflow steps yet" />
          ) : (
            <ol className="divide-y divide-slate-100" aria-label="History">
              {d.events.map((ev, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm md:px-5">
                  <span>
                    <b>{ev.actor}</b> moved it from {humanize(ev.fromState).toLowerCase()} to <b>{humanize(ev.toState).toLowerCase()}</b>
                    {ev.comment && <span className="text-slate-600"> — “{ev.comment}”</span>}
                  </span>
                  <span className="muted">{fmtDateTime(ev.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {step && <CommentDialog step={step} busy={act.busy} error={act.error} onClose={() => setStep(undefined)} onGo={(c) => void runStep(step, c)} />}
      {reopen && <ReopenDialog subId={id} onClose={() => setReopen(false)} onDone={() => { setReopen(false); toast('Reopen requested'); }} />}
    </>
  );
}

function ScoresCard({ preview, official }: { preview?: Preview; official?: OfficialScores }) {
  const levels = official?.levels ?? preview?.levels ?? [];
  return (
    <Card title="Level scores" action={official ? <Chip tone="green">Official</Chip> : <Chip tone="amber">Preview, not official until locked</Chip>}>
      {levels.length === 0 ? (
        <Empty title="No scores yet" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="level-scores">
            {levels.map((l) => (
              <div key={l.levelCode} className="rounded-md border border-slate-200 px-3 py-2" data-testid={`level-${l.levelCode}`}>
                <div className="muted">{l.levelCode}</div>
                <div className="text-xl font-semibold tabular-nums text-slate-900">{fmtScore(l.score)}</div>
              </div>
            ))}
          </div>
          {official && <p className="muted mt-3">Calculated {fmtDateTime(official.run.ranAt)} · engine {official.run.engineVersion}</p>}
        </>
      )}
    </Card>
  );
}

function PeopleCard({ detail, editable, levelCodes, period, subId, onSaved }: { detail: SubmissionDetail; editable: boolean; levelCodes: string[]; period: string; subId: string; onSaved: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const emps = useAsync(() => (editable && can('employees:read') ? get<{ employees: Employee[] }>('/employees') : Promise.resolve({ employees: [] })), [editable]);
  const month = daysIn(period);
  const [rows, setRows] = useState<Record<string, { on: boolean; level: string; days: string }>>({});
  const { busy, error, run } = useAction();
  const people = (emps.data?.employees ?? []).filter((e) => e.unitCode === detail.submission.unitCode && e.status === 'ACTIVE');

  useEffect(() => {
    const next: typeof rows = {};
    for (const e of people) {
      const cur = detail.levelAssignments.find((a) => a.employeeCode === e.employeeCode);
      next[e.id] = { on: !!cur, level: cur?.levelCode ?? levelCodes[0] ?? '', days: String(cur?.daysInUnit ?? month) };
    }
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emps.data, detail, levelCodes.join()]);

  if (!editable) {
    return (
      <Card title="People and levels" pad={false}>
        {detail.levelAssignments.length === 0 ? (
          <Empty title="No employees placed on this month" />
        ) : (
          <TableWrap>
            <table className="w-full" aria-label="People and levels">
              <thead>
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">Level</th>
                  <th className="th">Days</th>
                </tr>
              </thead>
              <tbody>
                {detail.levelAssignments.map((a) => (
                  <tr key={a.employeeCode}>
                    <td className="td">
                      {a.fullName} <span className="muted">{a.employeeCode}</span>
                    </td>
                    <td className="td">{a.levelCode}</td>
                    <td className="td">{a.daysInUnit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    );
  }

  const invalid = people.some((p) => rows[p.id]?.on && (!Number.isInteger(Number(rows[p.id].days)) || Number(rows[p.id].days) < 1 || Number(rows[p.id].days) > month));
  return (
    <Card
      title="People and levels"
      subtitle={`Who worked in this unit, at which level, and for how many days (1 to ${month})`}
      action={
        <button
          className="btn btn-secondary !py-1 text-xs"
          disabled={busy || invalid}
          onClick={() => void run(async () => {
            await put(`/submissions/${subId}/level-assignments`, {
              assignments: people.filter((p) => rows[p.id]?.on).map((p) => ({ employeeId: p.id, levelCode: rows[p.id].level, daysInUnit: Number(rows[p.id].days) })),
            });
            toast('People saved');
            onSaved();
          })}
        >
          Save people
        </button>
      }
      pad={false}
    >
      {error && (
        <div className="p-3">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}
      {people.length === 0 ? (
        <Empty title="No active employees are assigned to this unit" hint="Add or transfer employees on the Employees screen." />
      ) : (
        <TableWrap>
          <table className="w-full" aria-label="People and levels">
            <thead>
              <tr>
                <th className="th" />
                <th className="th">Employee</th>
                <th className="th">Level</th>
                <th className="th">Days</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const r = rows[p.id];
                if (!r) return null;
                const badDays = r.on && (!Number.isInteger(Number(r.days)) || Number(r.days) < 1 || Number(r.days) > month);
                return (
                  <tr key={p.id}>
                    <td className="td">
                      <input type="checkbox" aria-label={`Include ${p.fullName}`} checked={r.on} onChange={(e) => setRows({ ...rows, [p.id]: { ...r, on: e.target.checked } })} />
                    </td>
                    <td className="td">
                      {p.fullName} <span className="muted">{p.employeeCode}</span>
                    </td>
                    <td className="td">
                      <select className="input !w-auto" aria-label={`Level for ${p.fullName}`} value={r.level} disabled={!r.on} onChange={(e) => setRows({ ...rows, [p.id]: { ...r, level: e.target.value } })}>
                        {levelCodes.map((l) => (
                          <option key={l}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td className="td">
                      <input className={`input !w-20 ${badDays ? 'input-invalid' : ''}`} aria-label={`Days for ${p.fullName}`} disabled={!r.on} value={r.days} onChange={(e) => setRows({ ...rows, [p.id]: { ...r, days: e.target.value } })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

function CommentDialog({ step, busy, error, onClose, onGo }: { step: Step; busy: boolean; error?: string; onClose: () => void; onGo: (comment: string) => void }) {
  const [comment, setComment] = useState('');
  return (
    <Modal
      open
      title={step.label}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${step.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !comment.trim()} onClick={() => onGo(comment.trim())}>
            {step.label}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Comment (required)" htmlFor="step-comment">
          <textarea id="step-comment" className="input min-h-24" autoFocus value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ReopenDialog({ subId, onClose, onDone }: { subId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      open
      title="Request reopen"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !reason.trim()}
            onClick={() => void run(async () => {
              await post(`/submissions/${subId}/reopen-requests`, { reason: reason.trim() });
              onDone();
            })}
          >
            Send request
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Why does this month need to change?" htmlFor="reopen-reason">
          <textarea id="reopen-reason" className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
