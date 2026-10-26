import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, Card, Chip, Field, PageHeader, TableWrap } from '../components/ui';
import { DEFECT_TYPES, DEMO_TODAY, DOWNTIME_REASONS, SAFETY_OBS_TYPES, SHIFTS, SHIFT_TIMINGS } from '../config/floor.config';
import { PQCDSM_PARAMS } from '../config/scoring.config';
import { OPERATORS, OPERATOR_MAP } from '../data/operators';
import { LINES, MACHINES, MACHINE_MAP, lineById } from '../data/org';
import { useStore } from '../store/AppStore';
import type { DefectType, DowntimeReason, MachineType, OperatorRole, SafetyObsType, Shift, ShiftRecord } from '../types';
import { fmtDate } from '../utils/format';
import { adjustedStandardQty, excludedDowntimeMin, faultDowntimeMin, rejectedQty, totalDowntimeMin } from '../utils/operatorScoring';

const ROLE_FOR_TYPE: Record<MachineType, OperatorRole> = {
  press: 'Press Operator',
  hammer: 'Hammer Operator',
  trimmer: 'Trimmer',
  furnace: 'Furnace Operator',
};

const SUPERVISOR = { name: 'Palaniappan Shanmugam', plantId: 'P1' as const };

interface RejRow {
  defect: DefectType;
  qty: number;
}
interface DtRow {
  reason: DowntimeReason;
  minutes: number;
  operatorFault: boolean;
}

export function ShiftEntryPage() {
  const { shiftRecords, addShiftRecord } = useStore();

  const lines = LINES.filter((l) => l.plantId === SUPERVISOR.plantId);
  const [date, setDate] = useState(DEMO_TODAY);
  const [shift, setShift] = useState<Shift>('A');
  const [lineId, setLineId] = useState(lines[0].id);
  const machinesOnLine = MACHINES.filter((m) => m.lineId === lineId && m.shifts.includes(shift));
  const [machineIdRaw, setMachineId] = useState('M01');
  const machine = machinesOnLine.find((m) => m.id === machineIdRaw) ?? machinesOnLine[0];

  const rostered = OPERATORS.find((o) => o.machineId === machine?.id && o.shift === shift);
  const [operatorOverride, setOperatorOverride] = useState<string | null>(null);
  const eligible = OPERATORS.filter((o) => machine && o.plantId === machine.plantId && o.role === ROLE_FOR_TYPE[machine.type]);
  const operatorId = operatorOverride && eligible.some((o) => o.id === operatorOverride) ? operatorOverride : (rostered?.id ?? eligible[0]?.id ?? '');

  const [productOverride, setProductOverride] = useState<string | null>(null);
  const product = machine && productOverride && machine.products.includes(productOverride) ? productOverride : (machine?.products[0] ?? '');
  const [planned, setPlanned] = useState<number | null>(null);
  const plannedQty = planned ?? machine?.plannedQty ?? 0;
  const [actual, setActual] = useState(0);
  const [rejs, setRejs] = useState<RejRow[]>([]);
  const [dts, setDts] = useState<DtRow[]>([]);
  const [obsType, setObsType] = useState<SafetyObsType>('None');
  const [obsNote, setObsNote] = useState('');
  const [ppe, setPpe] = useState(true);
  const [fiveS, setFiveS] = useState(80);
  const [scrap, setScrap] = useState('');
  const [strokes, setStrokes] = useState('');

  const recent = useMemo(
    () => shiftRecords.filter((r) => r.enteredBy === SUPERVISOR.name).slice(-6).reverse(),
    [shiftRecords],
  );

  if (!machine) return null;

  const draft = { plannedQty, actualQty: actual, downtime: dts, rejections: rejs };
  const stdQty = adjustedStandardQty(draft);
  const prodPct = stdQty > 0 ? (actual / stdQty) * 100 : 0;
  const excluded = excludedDowntimeMin(draft);
  const fault = faultDowntimeMin(draft);
  const rejTotal = rejectedQty(draft);
  const rejPct = actual > 0 ? (rejTotal / actual) * 100 : 0;
  const stdScrapKg = Math.round(actual * machine.pieceWeightKg * (machine.scrapAllowancePct / 100) * 10) / 10;

  const errors: string[] = [];
  if (!operatorId) errors.push('Select the operator.');
  if (plannedQty <= 0) errors.push('Planned quantity must be above zero.');
  if (actual < 0) errors.push('Actual quantity cannot be negative.');
  if (rejTotal > actual) errors.push('Rejections cannot exceed the actual quantity.');
  if (totalDowntimeMin(draft) > PQCDSM_PARAMS.shiftMinutes) errors.push('Downtime cannot exceed the 480-minute shift.');
  if (shiftRecords.some((r) => r.date === date && r.shift === shift && r.machineId === machine.id)) {
    errors.push('A record already exists for this date, shift and machine.');
  }

  const reset = () => {
    setActual(0);
    setRejs([]);
    setDts([]);
    setObsType('None');
    setObsNote('');
    setPpe(true);
    setFiveS(80);
    setScrap('');
    setStrokes('');
    setPlanned(null);
    setOperatorOverride(null);
    setProductOverride(null);
  };

  const fillExample = () => {
    const base = machine.plannedQty;
    setPlanned(null);
    setDts([{ reason: 'Breakdown', minutes: 90, operatorFault: false }]);
    setActual(Math.round(base * ((480 - 90) / 480) * 0.96));
    setRejs([
      { defect: 'Lap / Fold', qty: Math.max(1, Math.round(base * 0.012)) },
      { defect: 'Underfill', qty: Math.max(1, Math.round(base * 0.006)) },
    ]);
    setPpe(true);
    setFiveS(84);
    setObsType('Good practice');
    setObsNote('Die lubrication done only after ram parked and guard closed');
  };

  const save = () => {
    if (errors.length) return;
    const crewOf = (role: OperatorRole) =>
      OPERATORS.find((o) => o.plantId === machine.plantId && o.role === role && o.shift === shift)?.id;
    const rec: Omit<ShiftRecord, 'id'> = {
      date,
      shift,
      plantId: machine.plantId,
      lineId: machine.lineId,
      machineId: machine.id,
      operatorId,
      product,
      crew: { dieSetterId: crewOf('Die Setter'), helperId: crewOf('Helper'), inspectorId: crewOf('Inspector') },
      plannedQty,
      actualQty: actual,
      rejections: rejs.filter((r) => r.qty > 0),
      downtime: dts.filter((d) => d.minutes > 0),
      safetyObs: { type: obsType, note: obsNote.trim() },
      ppeCompliant: ppe,
      fiveS,
      scrapKg: scrap === '' ? stdScrapKg : parseFloat(scrap) || 0,
      dieChange: strokes !== '' && machine.standardDieLife ? { strokes: parseInt(strokes, 10) || 0, standard: machine.standardDieLife } : undefined,
      enteredBy: SUPERVISOR.name,
    };
    addShiftRecord(rec);
    reset();
  };

  return (
    <>
      <PageHeader
        title="Shift Data Entry"
        subtitle="Trichy plant · record output, rejections, downtime and safety for each machine-shift"
        actions={
          <button className="btn btn-secondary" onClick={fillExample}>
            <Sparkles size={15} className="text-accent-700" /> Fill example shift
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card title="Shift details">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Date">
                <input className="input" type="date" value={date} max={DEMO_TODAY} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Shift" hint={SHIFT_TIMINGS[shift]}>
                <select className="input" value={shift} onChange={(e) => { setShift(e.target.value as Shift); setOperatorOverride(null); }}>
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      Shift {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Line">
                <select
                  className="input"
                  value={lineId}
                  onChange={(e) => {
                    setLineId(e.target.value);
                    const first = MACHINES.find((m) => m.lineId === e.target.value && m.shifts.includes(shift));
                    if (first) setMachineId(first.id);
                    setOperatorOverride(null);
                    setPlanned(null);
                  }}
                >
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Machine" hint={`Line makes: ${lineById(machine.lineId).products.join(', ').toLowerCase()}`}>
                <select
                  className="input"
                  value={machine.id}
                  onChange={(e) => {
                    setMachineId(e.target.value);
                    setOperatorOverride(null);
                    setPlanned(null);
                  }}
                >
                  {machinesOnLine.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Product">
                <select className="input" value={product} onChange={(e) => setProductOverride(e.target.value)}>
                  {machine.products.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Operator" hint={rostered && operatorId === rostered.id ? 'Rostered operator' : 'Relief / swapped operator'}>
                <select className="input" value={operatorId} onChange={(e) => setOperatorOverride(e.target.value)}>
                  {eligible.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.employment.slice(0, 4)}.)
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <Card title="Output" subtitle={`Standard plan for this machine: ${machine.plannedQty} pcs per 8-hour shift`}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Planned quantity (pcs)">
                <input className="input" type="number" min={0} value={plannedQty} onChange={(e) => setPlanned(parseInt(e.target.value, 10) || 0)} />
              </Field>
              <Field label="Actual quantity (pcs)">
                <input className="input" type="number" min={0} value={actual} onChange={(e) => setActual(parseInt(e.target.value, 10) || 0)} />
              </Field>
            </div>
          </Card>

          <Card
            title="Rejections by defect type"
            action={
              <button className="btn btn-secondary !py-1" onClick={() => setRejs([...rejs, { defect: 'Underfill', qty: 1 }])}>
                <Plus size={14} /> Add defect
              </button>
            }
          >
            {rejs.length === 0 ? (
              <p className="text-sm text-slate-500">No rejections recorded.</p>
            ) : (
              <ul className="space-y-2">
                {rejs.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <select className="input !w-44" value={r.defect} onChange={(e) => setRejs(rejs.map((x, j) => (j === i ? { ...x, defect: e.target.value as DefectType } : x)))}>
                      {DEFECT_TYPES.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                    <input className="input !w-24" type="number" min={0} value={r.qty} onChange={(e) => setRejs(rejs.map((x, j) => (j === i ? { ...x, qty: parseInt(e.target.value, 10) || 0 } : x)))} />
                    <span className="text-xs text-slate-500">pcs</span>
                    <button className="btn btn-ghost !p-1.5 text-red-600" onClick={() => setRejs(rejs.filter((_, j) => j !== i))} aria-label="Remove">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Downtime"
            subtitle="Downtime that is not the operator's fault is excluded from the operator's productivity score."
            action={
              <button className="btn btn-secondary !py-1" onClick={() => setDts([...dts, { reason: 'Breakdown', minutes: 30, operatorFault: false }])}>
                <Plus size={14} /> Add downtime
              </button>
            }
          >
            {dts.length === 0 ? (
              <p className="text-sm text-slate-500">No downtime recorded.</p>
            ) : (
              <ul className="space-y-2">
                {dts.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <select className="input !w-48" value={d.reason} onChange={(e) => setDts(dts.map((x, j) => (j === i ? { ...x, reason: e.target.value as DowntimeReason } : x)))}>
                      {DOWNTIME_REASONS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                    <input className="input !w-24" type="number" min={0} value={d.minutes} onChange={(e) => setDts(dts.map((x, j) => (j === i ? { ...x, minutes: parseInt(e.target.value, 10) || 0 } : x)))} />
                    <span className="text-xs text-slate-500">min</span>
                    <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 accent-accent-700"
                        checked={d.operatorFault}
                        onChange={(e) => setDts(dts.map((x, j) => (j === i ? { ...x, operatorFault: e.target.checked } : x)))}
                      />
                      Operator’s fault
                    </label>
                    <button className="btn btn-ghost !p-1.5 text-red-600" onClick={() => setDts(dts.filter((_, j) => j !== i))} aria-label="Remove">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Safety, 5S and cost inputs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="PPE compliance (whole shift)">
                <div className="flex gap-2">
                  {[true, false].map((v) => (
                    <button
                      key={String(v)}
                      onClick={() => setPpe(v)}
                      className={`btn flex-1 ${ppe === v ? (v ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-700') : 'btn-secondary'}`}
                    >
                      {v ? 'Y · Compliant' : 'N · Lapse noted'}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={`5S audit score: ${fiveS}`}>
                <input type="range" min={0} max={100} value={fiveS} onChange={(e) => setFiveS(parseInt(e.target.value, 10))} className="w-full accent-accent-700" />
              </Field>
              <Field label="Safety observation">
                <select className="input" value={obsType} onChange={(e) => setObsType(e.target.value as SafetyObsType)}>
                  {SAFETY_OBS_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Observation note">
                <input className="input" value={obsNote} disabled={obsType === 'None'} onChange={(e) => setObsNote(e.target.value)} placeholder="e.g. Scale blown from die cavity without face shield" />
              </Field>
              <Field label="Scrap generated (kg)" hint={`Leave blank to use the standard (${stdScrapKg} kg, ${machine.scrapAllowancePct}% allowance)`}>
                <input className="input" type="number" min={0} step="0.1" value={scrap} onChange={(e) => setScrap(e.target.value)} placeholder={String(stdScrapKg)} />
              </Field>
              {machine.standardDieLife && (
                <Field label="Die change: strokes achieved (optional)" hint={`Standard die life ${machine.standardDieLife.toLocaleString('en-IN')} strokes`}>
                  <input className="input" type="number" min={0} value={strokes} onChange={(e) => setStrokes(e.target.value)} />
                </Field>
              )}
            </div>
          </Card>
        </div>

        {/* Live preview */}
        <div className="space-y-4 xl:sticky xl:top-0 xl:self-start">
          <Card title="Live productivity preview" subtitle={`${OPERATOR_MAP[operatorId]?.name ?? '—'} · ${machine.name}`}>
            <dl className="space-y-2 text-sm">
              <Row label="Planned for 8 h" value={`${plannedQty} pcs`} />
              <Row label="Downtime — not operator's fault" value={`− ${excluded} min`} tone="blue" hint="Removed from the operator's standard" />
              <Row label="Downtime — operator's fault" value={`${fault} min`} tone={fault ? 'red' : undefined} hint="Counts against the operator" />
              <Row label="Adjusted standard" value={`${Math.round(stdQty)} pcs`} strong />
              <Row label="Actual" value={`${actual} pcs`} />
            </dl>
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Shift productivity</span>
                <span className={`text-2xl font-semibold tabular-nums ${prodPct >= 95 ? 'text-emerald-700' : prodPct >= 85 ? 'text-slate-900' : 'text-red-600'}`}>{prodPct.toFixed(1)}%</span>
              </div>
              <div className="mt-2">
                <Bar value={prodPct} max={110} tone={prodPct >= 95 ? 'green' : prodPct >= 85 ? 'blue' : 'amber'} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
                <span>Rejection</span>
                <span className="font-medium tabular-nums">
                  {rejTotal} pcs · {rejPct.toFixed(2)}%
                </span>
              </div>
            </div>
            {errors.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-red-600">
                {errors.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            )}
            <button className="btn btn-primary mt-4 w-full" disabled={errors.length > 0} onClick={save}>
              Save shift record
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">Updates the operator scorecard and floor dashboards immediately.</p>
          </Card>

          <Card title="Recent entries" pad={false}>
            <TableWrap>
              <table className="w-full border-collapse">
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td className="td">
                        <div className="text-sm font-medium text-slate-900">{MACHINE_MAP[r.machineId].name.replace(/\s*\(.*\)/, '')}</div>
                        <div className="text-[11px] text-slate-500">
                          {fmtDate(r.date)} · Shift {r.shift} · {r.product} · {OPERATOR_MAP[r.operatorId]?.name}
                        </div>
                      </td>
                      <td className="td text-right">
                        <Chip tone="slate">{r.actualQty} / {r.plannedQty}</Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong, tone, hint }: { label: string; value: string; strong?: boolean; tone?: 'blue' | 'red'; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3" title={hint}>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'} ${tone === 'blue' ? 'text-sky-700' : tone === 'red' ? 'font-medium text-red-600' : ''}`}>{value}</dd>
    </div>
  );
}
