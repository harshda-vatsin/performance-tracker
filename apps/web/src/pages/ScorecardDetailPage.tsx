import { ArrowRight, GitPullRequestCreate } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StateChip, TableWrap, useToast } from '../components/ui';
import { get, post } from '../lib/api';
import { fiscalMonths, fmtDateTime, fyLabel, monthLabel } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { ChangeRequest, ScorecardKra } from '../lib/types';
import { parseNum } from '../lib/validate';

interface Detail {
  scorecard: { id: string; orgUnitId: string; fiscalYear: number; versionId: string; version: number };
  kras: ScorecardKra[];
}

export function ScorecardDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const sc = useAsync(() => get<Detail>(`/scorecards/${id}`), [id]);
  const changes = useAsync(() => get<{ requests: ChangeRequest[] }>(`/scorecards/${id}/change-requests`), [id]);
  const [proposing, setProposing] = useState(false);
  const [deciding, setDeciding] = useState<{ cr: ChangeRequest; approve: boolean }>();

  if (sc.loading && !sc.data) return <Loading />;
  if (sc.error || !sc.data) return <ErrorBox onRetry={sc.reload}>{sc.error ?? 'Scorecard not found'}</ErrorBox>;
  const { scorecard, kras } = sc.data;
  const codes = [...new Set(kras.flatMap((k) => Object.keys(k.weights)))];
  const byId = new Map(kras.map((k) => [k.id, k]));

  return (
    <>
      <PageHeader
        title={`Scorecard · ${fyLabel(scorecard.fiscalYear)}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link to="/scorecards" className="text-accent-800 hover:underline">
              All scorecards
            </Link>
            <Chip tone="slate">Version {scorecard.version}</Chip>
          </span>
        }
        actions={
          can('scorecards:propose') && (
            <button className="btn btn-primary" onClick={() => setProposing(true)}>
              <GitPullRequestCreate size={15} /> Propose adjustment
            </button>
          )
        }
      />
      <div className="space-y-4">
        <Card title="KRAs, present levels and targets" subtitle="Weights are fixed by the template; adjustments change present levels and targets only." pad={false}>
          <TableWrap>
            <table className="w-full min-w-[820px]" aria-label="Scorecard KRAs">
              <thead>
                <tr>
                  <th className="th">Cat</th>
                  <th className="th">KRA</th>
                  <th className="th">Better</th>
                  <th className="th">Unit</th>
                  <th className="th">Present</th>
                  {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                    <th className="th" key={q}>
                      {q}
                    </th>
                  ))}
                  {codes.map((c) => (
                    <th className="th" key={c}>
                      W · {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kras.map((k) => (
                  <tr key={k.id} className="tr-hover">
                    <td className="td">
                      <Chip tone="accent">{k.pqcdsm}</Chip>
                    </td>
                    <td className="td font-medium text-slate-900">{k.nameEn}</td>
                    <td className="td">{k.direction === 'HIGHER_BETTER' ? 'Higher' : 'Lower'}</td>
                    <td className="td">{k.unit}</td>
                    <td className="td tabular-nums">{k.presentLevel}</td>
                    {k.targets.map((t, i) => (
                      <td className="td tabular-nums" key={i}>
                        {t}
                      </td>
                    ))}
                    {codes.map((c) => (
                      <td className="td tabular-nums" key={c}>
                        {k.weights[c] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card title="Adjustment proposals" subtitle="Plant HR proposes, a different person approves. Approval creates a new scorecard version from the effective month." pad={false}>
          {changes.loading && !changes.data ? (
            <Loading />
          ) : changes.error ? (
            <div className="p-4">
              <ErrorBox onRetry={changes.reload}>{changes.error}</ErrorBox>
            </div>
          ) : !changes.data?.requests.length ? (
            <Empty title="No adjustment proposals" />
          ) : (
            <ul className="divide-y divide-slate-100" aria-label="Adjustment proposals">
              {changes.data.requests.map((cr) => (
                <li key={cr.id} className="space-y-2 px-4 py-3 md:px-5" data-testid="change-request">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StateChip state={cr.state} />
                      <span className="text-sm font-medium text-slate-900">From {monthLabel(cr.effectivePeriod)}</span>
                      <span className="muted">proposed {fmtDateTime(cr.createdAt)}</span>
                    </div>
                    {cr.state === 'PENDING' && can('scorecards:approve') && (
                      <div className="flex gap-2">
                        <button className="btn btn-primary !py-1 text-xs" onClick={() => setDeciding({ cr, approve: true })}>
                          Approve
                        </button>
                        <button className="btn btn-danger !py-1 text-xs" onClick={() => setDeciding({ cr, approve: false })}>
                          Refuse
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-slate-700">{cr.reason}</p>
                  <ul className="space-y-1 text-sm text-slate-600">
                    {cr.changes.map((c) => {
                      const k = byId.get(c.kraId);
                      return (
                        <li key={c.kraId} className="flex flex-wrap items-center gap-1.5">
                          <b className="text-slate-800">{k?.nameEn ?? 'KRA'}</b>
                          {c.presentLevel !== undefined && (
                            <span className="inline-flex items-center gap-1">
                              present {k?.presentLevel} <ArrowRight size={12} /> {c.presentLevel}
                            </span>
                          )}
                          {c.targets && (
                            <span className="inline-flex items-center gap-1">
                              targets {k?.targets.join('/')} <ArrowRight size={12} /> {c.targets.join('/')}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {cr.decisionComment && <p className="muted">Decision note: {cr.decisionComment}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {proposing && (
        <Propose
          scorecardId={id}
          fiscalYear={scorecard.fiscalYear}
          kras={kras}
          onClose={() => setProposing(false)}
          onDone={() => {
            setProposing(false);
            toast('Adjustment proposed');
            changes.reload();
          }}
        />
      )}
      {deciding && (
        <Decide
          cr={deciding.cr}
          approve={deciding.approve}
          onClose={() => setDeciding(undefined)}
          onDone={() => {
            setDeciding(undefined);
            toast(deciding.approve ? 'Approved: new scorecard version created' : 'Proposal refused');
            changes.reload();
            sc.reload();
          }}
        />
      )}
    </>
  );
}

function Propose({ scorecardId, fiscalYear, kras, onClose, onDone }: { scorecardId: string; fiscalYear: number; kras: ScorecardKra[]; onClose: () => void; onDone: () => void }) {
  const months = fiscalMonths(fiscalYear);
  const [period, setPeriod] = useState(months[0]);
  const [reason, setReason] = useState('');
  const [edits, setEdits] = useState<Record<string, { present: string; targets: string[] }>>({});
  const { busy, error, run } = useAction();

  const toggle = (k: ScorecardKra, on: boolean) =>
    setEdits((e) => {
      const next = { ...e };
      if (on) next[k.id] = { present: String(k.presentLevel), targets: k.targets.map(String) };
      else delete next[k.id];
      return next;
    });

  // Same rule the API applies: after the change every target stays on the improving side of the present level.
  const problem = (k: ScorecardKra): string | null => {
    const e = edits[k.id];
    if (!e) return null;
    const pl = parseNum(e.present);
    const tg = e.targets.map(parseNum);
    if (pl === null || Number.isNaN(pl) || tg.some((t) => t === null || Number.isNaN(t))) return 'Enter numbers for the present level and all four targets';
    const ok = k.direction === 'HIGHER_BETTER' ? (tg as number[]).every((t) => t >= pl) : (tg as number[]).every((t) => t <= pl);
    return ok ? null : `A target would be on the wrong side of present level ${pl} (${k.direction === 'HIGHER_BETTER' ? 'higher' : 'lower'} is better)`;
  };
  const chosen = kras.filter((k) => edits[k.id]);
  const problems = chosen.map(problem).filter(Boolean);

  return (
    <Modal
      open
      wide
      title="Propose scorecard adjustment"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !reason.trim() || chosen.length === 0 || problems.length > 0}
            onClick={() => void run(async () => {
              await post(`/scorecards/${scorecardId}/change-requests`, {
                effectiveFromPeriod: period,
                reason: reason.trim(),
                changes: chosen.map((k) => ({
                  kraId: k.id,
                  presentLevel: parseNum(edits[k.id].present),
                  targets: edits[k.id].targets.map((t) => parseNum(t)),
                })),
              });
              onDone();
            })}
          >
            Submit proposal
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Effective from" htmlFor="cr-period" hint="Must be before any month with data">
            <select id="cr-period" className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason" htmlFor="cr-reason">
              <input id="cr-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the targets need to change" />
            </Field>
          </div>
        </div>
        <ul className="space-y-2">
          {kras.map((k) => {
            const e = edits[k.id];
            const p = problem(k);
            return (
              <li key={k.id} className="rounded-md border border-slate-200 px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <input type="checkbox" checked={!!e} onChange={(ev) => toggle(k, ev.target.checked)} aria-label={`Change ${k.nameEn}`} />
                  {k.nameEn}
                  <span className="muted font-normal">
                    ({k.unit}, {k.direction === 'HIGHER_BETTER' ? 'higher' : 'lower'} is better)
                  </span>
                </label>
                {e && (
                  <div className="mt-2 grid grid-cols-5 gap-2">
                    <Field label="Present level">
                      <input className="input" aria-label={`${k.nameEn} present level`} value={e.present} onChange={(ev) => setEdits({ ...edits, [k.id]: { ...e, present: ev.target.value } })} />
                    </Field>
                    {e.targets.map((t, i) => (
                      <Field label={`Q${i + 1}`} key={i}>
                        <input
                          className="input"
                          aria-label={`${k.nameEn} Q${i + 1} target`}
                          value={t}
                          onChange={(ev) => setEdits({ ...edits, [k.id]: { ...e, targets: e.targets.map((x, j) => (j === i ? ev.target.value : x)) } })}
                        />
                      </Field>
                    ))}
                    {p && (
                      <p role="alert" className="col-span-5 text-xs text-red-700">
                        {p}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

function Decide({ cr, approve, onClose, onDone }: { cr: ChangeRequest; approve: boolean; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      open
      title={approve ? 'Approve adjustment' : 'Refuse adjustment'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`}
            disabled={busy || (!approve && !comment.trim())}
            onClick={() => void run(async () => {
              await post(`/scorecard-change-requests/${cr.id}/decision`, { approve, ...(comment.trim() ? { comment: comment.trim() } : {}) });
              onDone();
            })}
          >
            {approve ? 'Approve' : 'Refuse'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <p className="text-sm text-slate-700">
          Effective from <b>{monthLabel(cr.effectivePeriod)}</b>: {cr.reason}
        </p>
        <Field label={approve ? 'Comment (optional)' : 'Comment (required)'} htmlFor="dec-comment">
          <textarea id="dec-comment" className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
