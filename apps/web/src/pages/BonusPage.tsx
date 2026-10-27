import { Download, Calculator } from 'lucide-react';
import { useState } from 'react';
import { useAuth, useMe } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, TableWrap, useToast, type Tone } from '../components/ui';
import { get, post, put } from '../lib/api';
import { defaultPeriod, fmtPaise, fmtScore, humanize, isPeriod, monthLabel, rupeesToPaise } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';

interface Batch {
  id: string;
  period: string;
  plantCode: string;
  plantName: string;
  kind: 'REGULAR' | 'ADJUSTMENT';
  state: 'CALCULATED' | 'LOCKED' | 'REJECTED';
  reason: string | null;
  calculatedById: string;
  calculatedBy: string;
  decidedBy: string | null;
  comment: string | null;
  lines: number;
  totalPaise: number;
}
interface Line {
  employeeCode: string;
  fullName: string;
  score: number | null;
  days: number | null;
  basePaise: number;
  percentBp: number;
  amountPaise: number;
  band: string | null;
  note: string | null;
}
interface Band {
  minScore: number;
  percentBp: number;
  label: string;
}

const STATE_TONE: Record<string, Tone> = { CALCULATED: 'amber', LOCKED: 'green', REJECTED: 'red' };
const SKIP_TEXT: Record<string, string> = {
  MONTH_NOT_LOCKED: 'the month is not locked yet',
  ALREADY_LOCKED: 'a bonus batch is already approved and locked',
  NO_SCORING_UNITS: 'it has nothing to score',
};
const NOTE_TEXT: Record<string, string> = { NO_BASE: 'No base amount set', NOT_ELIGIBLE: 'Not eligible', NO_SCORE: 'No score' };
/** 7000 basis points -> "70%" without floating point. */
const pct = (bp: number) => `${Math.floor(bp / 100)}${bp % 100 ? `.${String(bp % 100).padStart(2, '0').replace(/0$/, '')}` : ''}%`;

/**
 * Monthly bonus. Corporate HR calculates a plant-month from locked scores; a different Corporate HR user approves it,
 * which locks it. Management sees batch totals only. Every amount is integer paise.
 */
export function BonusPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(defaultPeriod());
  const [open, setOpen] = useState<string>();
  const [skipped, setSkipped] = useState<{ plantCode: string; reason: string }[]>([]);
  const calc = useAction();
  const valid = isPeriod(period);
  const list = useAsync(() => (valid ? get<{ batches: Batch[] }>(`/bonus/batches?period=${period}`) : Promise.resolve({ batches: [] })), [period]);
  const batches = list.data?.batches ?? [];

  async function calculate() {
    const res = await calc.run(() => post<{ batches: unknown[]; skipped: { plantCode: string; reason: string }[] }>('/bonus/calculate', { period }));
    if (!res) return;
    setSkipped(res.skipped);
    toast(res.batches.length ? `Calculated ${res.batches.length} batch${res.batches.length === 1 ? '' : 'es'} for ${monthLabel(period)}` : 'Nothing to calculate');
    list.reload();
  }

  return (
    <>
      <PageHeader
        title="Bonus"
        subtitle="Monthly bonus from locked scores. Corporate HR calculates; a different Corporate HR user approves, which locks it. Corrections are separate adjustment batches."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="month" className="input !w-40" aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            {can('bonus:calculate') && (
              <button className="btn btn-primary" disabled={!valid || calc.busy} onClick={() => void calculate()}>
                <Calculator size={15} /> Calculate bonus
              </button>
            )}
            {can('bonus:export') && valid && (
              <>
                <a className="btn btn-secondary" href={`/api/bonus/export?period=${period}&format=csv`}>
                  <Download size={15} /> CSV
                </a>
                <a className="btn btn-secondary" href={`/api/bonus/export?period=${period}&format=xlsx`}>
                  <Download size={15} /> Excel
                </a>
              </>
            )}
          </div>
        }
      />
      {calc.error && <ErrorBox>{calc.error}</ErrorBox>}
      {skipped.length > 0 && (
        <Notice tone="amber">
          Not calculated: {skipped.map((s) => `${s.plantCode} (${SKIP_TEXT[s.reason] ?? s.reason.toLowerCase()})`).join('; ')}.
        </Notice>
      )}
      <Card pad={false} title={monthLabel(valid ? period : defaultPeriod())}>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorBox onRetry={list.reload}>{list.error}</ErrorBox>
          </div>
        ) : batches.length === 0 ? (
          <Empty title="No bonus batches for this month" hint={can('bonus:calculate') ? 'Once a plant-month is locked, choose Calculate bonus.' : 'Corporate HR calculates the bonus once the month is locked.'} />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[720px]" aria-label="Bonus batches">
              <thead>
                <tr>
                  <th className="th">Plant</th>
                  <th className="th">Type</th>
                  <th className="th">State</th>
                  <th className="th text-right">Employees</th>
                  <th className="th text-right">Total</th>
                  <th className="th">Calculated by</th>
                  <th className="th">Approved by</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="tr-hover" data-testid="bonus-batch">
                    <td className="td font-medium text-slate-900">{b.plantName}</td>
                    <td className="td">{b.kind === 'REGULAR' ? 'Bonus' : <span title={b.reason ?? ''}>Adjustment</span>}</td>
                    <td className="td">
                      <Chip tone={STATE_TONE[b.state]}>{humanize(b.state)}</Chip>
                    </td>
                    <td className="td text-right tabular-nums">{b.lines}</td>
                    <td className="td text-right tabular-nums">{fmtPaise(b.totalPaise)}</td>
                    <td className="td">{b.calculatedBy}</td>
                    <td className="td">{b.decidedBy ?? <span className="muted">—</span>}</td>
                    <td className="td text-right">
                      {can('bonus:lines') && (
                        <button className="text-sm font-medium text-accent-800 hover:underline" onClick={() => setOpen(b.id)} aria-label={`Open ${b.plantName} ${b.kind === 'REGULAR' ? 'bonus' : 'adjustment'}`}>
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {!can('bonus:lines') && batches.length > 0 && <p className="mt-2 text-xs text-slate-500">You see batch totals only. Per-employee amounts are visible to Corporate HR.</p>}
      {can('bonus:calculate') && <SetupCards />}
      {open && (
        <BatchDialog
          id={open}
          onClose={() => setOpen(undefined)}
          onChanged={() => {
            list.reload();
          }}
        />
      )}
    </>
  );
}

function BatchDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const me = useMe();
  const toast = useToast();
  const res = useAsync(() => get<{ batch: Batch; lines: Line[] }>(`/bonus/batches/${id}`), [id]);
  const { busy, error, run } = useAction();
  const [comment, setComment] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const b = res.data?.batch;
  const mine = b?.calculatedById === me.user.userId;

  async function decide(kind: 'approve' | 'reject') {
    const ok = await run(() => post(`/bonus/batches/${id}/${kind}`, { comment: comment.trim() || undefined }));
    if (ok) {
      toast(kind === 'approve' ? 'Approved and locked' : 'Rejected');
      onChanged();
      res.reload();
    }
  }

  return (
    <Modal open wide title={b ? `${b.plantName} · ${monthLabel(b.period)} · ${b.kind === 'REGULAR' ? 'Bonus' : 'Adjustment'}` : 'Bonus batch'} onClose={onClose}>
      {!res.data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Chip tone={STATE_TONE[b!.state]}>{humanize(b!.state)}</Chip>
            <span>Total <b data-testid="batch-total">{fmtPaise(b!.totalPaise)}</b> for {b!.lines} employees</span>
            {b!.reason && <span className="muted">Reason: {b!.reason}</span>}
          </div>
          <TableWrap>
            <table className="w-full min-w-[640px]" aria-label="Bonus lines">
              <thead>
                <tr>
                  <th className="th">Employee</th>
                  <th className="th text-right">Score</th>
                  <th className="th text-right">Days</th>
                  <th className="th text-right">Base</th>
                  <th className="th text-right">Percent</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Note</th>
                </tr>
              </thead>
              <tbody>
                {res.data.lines.map((l) => (
                  <tr key={l.employeeCode}>
                    <td className="td">{l.fullName} <span className="muted">{l.employeeCode}</span></td>
                    <td className="td text-right tabular-nums">{fmtScore(l.score)}</td>
                    <td className="td text-right tabular-nums">{l.days ?? '—'}</td>
                    <td className="td text-right tabular-nums">{b!.kind === 'REGULAR' ? fmtPaise(l.basePaise) : '—'}</td>
                    <td className="td text-right tabular-nums">{b!.kind === 'REGULAR' ? pct(l.percentBp) : '—'}</td>
                    <td className="td text-right font-medium tabular-nums">{fmtPaise(l.amountPaise)}</td>
                    <td className="td text-xs text-slate-600">{l.note ? (NOTE_TEXT[l.note] ?? l.note) : l.band}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>

          {b!.state === 'CALCULATED' && can('bonus:approve') && (
            mine ? (
              <Notice tone="amber">You calculated this batch, so a different Corporate HR user has to approve it.</Notice>
            ) : (
              <div className="space-y-2">
                <Field label="Comment (required to reject)" htmlFor="bonus-comment">
                  <input id="bonus-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <button className="btn btn-primary" disabled={busy} onClick={() => void decide('approve')}>
                    Approve and lock
                  </button>
                  <button className="btn btn-secondary" disabled={busy || !comment.trim()} onClick={() => void decide('reject')}>
                    Reject
                  </button>
                </div>
              </div>
            )
          )}
          {b!.state === 'LOCKED' && b!.kind === 'REGULAR' && can('bonus:calculate') && (
            <div>
              <button className="btn btn-secondary" onClick={() => setAdjusting(true)}>
                Create adjustment batch
              </button>
              <p className="mt-1 text-xs text-slate-500">A locked batch never changes. A correction is a separate batch that a different Corporate HR user approves.</p>
            </div>
          )}
        </div>
      )}
      {adjusting && res.data && (
        <AdjustDialog
          batchId={id}
          lines={res.data.lines}
          onClose={() => setAdjusting(false)}
          onDone={() => {
            setAdjusting(false);
            toast('Adjustment batch created; it needs approval');
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

function AdjustDialog({ batchId, lines, onClose, onDone }: { batchId: string; lines: Line[]; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(lines[0]?.employeeCode ?? '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const paise = rupeesToPaise(amount, true);
  return (
    <Modal
      open
      title="Adjustment batch"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !paise || !reason.trim()}
            onClick={() => void run(async () => {
              await post(`/bonus/batches/${batchId}/adjustments`, { reason: reason.trim(), lines: [{ employeeCode: code, deltaPaise: paise }] });
              onDone();
            })}
          >
            Create adjustment
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Employee" htmlFor="adj-emp">
          <select id="adj-emp" className="input" value={code} onChange={(e) => setCode(e.target.value)}>
            {lines.map((l) => (
              <option key={l.employeeCode} value={l.employeeCode}>
                {l.fullName} ({l.employeeCode})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount in rupees (negative to take back)" htmlFor="adj-amt" hint="For example 500 or -250.50">
          <input id="adj-amt" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="adj-reason">
          <input id="adj-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Corporate HR's setup: the example band rules, and the base amount each employee's bonus is a percentage of. */
function SetupCards() {
  const toast = useToast();
  const rules = useAsync(() => get<{ bands: Band[] }>('/bonus/rules'), []);
  const bases = useAsync(() => get<{ bases: { employeeCode: string; fullName: string; basePaise: number }[] }>('/bonus/bases'), []);
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();

  const parsed = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [code, amount] = l.split(',').map((x) => x.trim());
      const basePaise = amount === undefined ? null : rupeesToPaise(amount);
      return { employeeCode: code, basePaise };
    });
  const invalid = parsed.some((p) => !p.employeeCode || p.basePaise === null);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Bonus rules" subtitle="Example bands: a monthly score band pays a percentage of the employee's base amount.">
        {rules.data ? (
          <table className="w-full" aria-label="Bonus bands">
            <thead>
              <tr>
                <th className="th">From score</th>
                <th className="th text-right">Pays</th>
              </tr>
            </thead>
            <tbody>
              {rules.data.bands.map((b) => (
                <tr key={b.minScore}>
                  <td className="td tabular-nums">{b.minScore}</td>
                  <td className="td text-right tabular-nums">{pct(b.percentBp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Loading />
        )}
      </Card>
      <Card title="Base amounts" subtitle={`${bases.data?.bases.length ?? 0} employees have a monthly base amount.`}>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Add or change base amounts" htmlFor="bases-text" hint="One per line: EMPLOYEE_CODE,AMOUNT_IN_RUPEES  (for example E0105,3000)">
          <textarea id="bases-text" className="input h-24 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <button
          className="btn btn-secondary mt-2"
          disabled={busy || parsed.length === 0 || invalid}
          onClick={() => void run(async () => {
            const res = await put<{ saved: number }>('/bonus/bases', { bases: parsed });
            toast(`Saved ${res.saved} base amount${res.saved === 1 ? '' : 's'}`);
            setText('');
            bases.reload();
          })}
        >
          Save base amounts
        </button>
        {invalid && <p className="mt-1 text-xs text-red-700">Each line needs an employee code and a rupee amount.</p>}
      </Card>
    </div>
  );
}
