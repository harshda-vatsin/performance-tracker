import { useMemo, useState } from 'react';
import { PqcdsmRadar } from '../components/charts/Charts';
import { StatusChip } from '../components/appraisal/parts';
import { Bar, Card, PageHeader, Stat, TableWrap, type Tone } from '../components/ui';
import { DATA_MONTHS, DEMO_TODAY, HOLIDAYS } from '../config/floor.config';
import { PQCDSM_LABELS } from '../config/scoring.config';
import { MACHINE_MAP, PLANTS } from '../data/org';
import { OPERATOR_MAP } from '../data/operators';
import { INJURIES_APR_TO_JUL, PLANT_MONTHLY_KPIS, PLANT_TARGETS, REVIEW_COVERAGE } from '../data/plantKpis';
import { useScorecards, useStaffRows, useStore } from '../store/AppStore';
import type { AppraisalStatus, PlantId, PqcdsmKey } from '../types';
import { filterRecords, notableStoppages, summarise } from '../utils/aggregate';
import { fmtDate, fmtNumber, monthLabel } from '../utils/format';

const DIMS: PqcdsmKey[] = ['P', 'Q', 'C', 'D', 'S', 'M'];
const STAGES: AppraisalStatus[] = ['Not started', 'Self-assessment', 'Manager assessment', 'Reviewer sign-off', 'HR finalisation', 'Finalised'];
const PLANT_NAME: Record<PlantId, string> = Object.fromEntries(PLANTS.map((p) => [p.id, p.city])) as Record<PlantId, string>;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0);

export function OverviewPage() {
  const { shiftRecords, monthlyInputs, setPage, openAppraisal } = useStore();
  const staff = useStaffRows();
  const [plant, setPlant] = useState<PlantId | 'all'>('all');
  const [month, setMonth] = useState(DATA_MONTHS[DATA_MONTHS.length - 1]);
  const prevMonth = DATA_MONTHS[DATA_MONTHS.indexOf(month) - 1];
  const cards = useScorecards(month);
  const prevCards = useScorecards(prevMonth ?? month);

  const plants: PlantId[] = plant === 'all' ? PLANTS.map((p) => p.id) : [plant];
  const records = useMemo(() => filterRecords(shiftRecords, { month, plantId: plant }), [shiftRecords, month, plant]);
  const s = useMemo(() => summarise(records, MACHINE_MAP), [records]);

  // Monthly targets; the in-progress month is pro-rated by calendar days elapsed.
  const isCurrent = month === DEMO_TODAY.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  // Pro-rate by working days (not calendar days): Sundays and plant shutdowns are excluded.
  const workingDays = (upToDay: number) => {
    let n = 0;
    for (let d = 1; d <= upToDay; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      if (new Date(`${iso}T00:00:00Z`).getUTCDay() !== 0 && !HOLIDAYS.has(iso)) n++;
    }
    return n;
  };
  const prorata = isCurrent ? workingDays(Number(DEMO_TODAY.slice(8)) - 1) / workingDays(daysInMonth) : 1;
  const tonnageTarget = plants.reduce((sum, p) => sum + PLANT_TARGETS[p].tonnage, 0) * prorata;

  const erp = PLANT_MONTHLY_KPIS.filter((k) => k.month === month && plants.includes(k.plantId));
  const power = avg(erp.map((k) => k.powerCostPerTonne));
  const otif = avg(erp.map((k) => k.otifPct));

  // Recordable injuries: month from the EHS register, YTD = Apr–Jul baseline + registered months up to the one selected.
  const inScope = (opId: string) => plants.includes(OPERATOR_MAP[opId].plantId);
  const injuriesMonth = monthlyInputs.filter((m) => m.month === month && inScope(m.operatorId)).reduce((sum, m) => sum + m.incidents, 0);
  const injuriesYtd =
    plants.reduce((sum, p) => sum + INJURIES_APR_TO_JUL[p], 0) +
    monthlyInputs.filter((m) => m.month <= month && inScope(m.operatorId)).reduce((sum, m) => sum + m.incidents, 0);

  // Performance review coverage (last completed cycle) — staff vs workers incl. contract.
  const cov = plants.reduce(
    (a, p) => {
      const c = REVIEW_COVERAGE[p];
      return {
        staffTotal: a.staffTotal + c.staffTotal,
        staffReviewed: a.staffReviewed + c.staffReviewed,
        workersTotal: a.workersTotal + c.workersTotal,
        workersReviewed: a.workersReviewed + c.workersReviewed,
        contractTotal: a.contractTotal + c.contractTotal,
        contractReviewed: a.contractReviewed + c.contractReviewed,
      };
    },
    { staffTotal: 0, staffReviewed: 0, workersTotal: 0, workersReviewed: 0, contractTotal: 0, contractReviewed: 0 },
  );
  const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
  const staffCov = pct(cov.staffReviewed, cov.staffTotal);
  const workerCov = pct(cov.workersReviewed, cov.workersTotal);
  const contractCov = pct(cov.contractReviewed, cov.contractTotal);

  const tone = (ok: boolean, near = false): Tone => (ok ? 'green' : near ? 'amber' : 'red');

  const scoped = staff.filter((r) => plant === 'all' || r.emp.plantId === plant);
  const finalised = scoped.filter((r) => r.appraisal.status === 'Finalised').length;
  const completion = scoped.length ? Math.round((finalised / scoped.length) * 100) : 0;

  const opScope = (c: (typeof cards)[number]) => (plant === 'all' || OPERATOR_MAP[c.operatorId].plantId === plant) && c.detail.shifts > 0;
  const cur = cards.filter(opScope);
  const prev = prevCards.filter(opScope);
  const dimAvg = (arr: typeof cards, k: PqcdsmKey) => avg(arr.map((c) => c.scores[k]));
  const floorScores = Object.fromEntries(DIMS.map((k) => [k, Math.round(dimAvg(cur, k) * 10) / 10])) as Record<PqcdsmKey, number>;
  const overall = avg(cur.map((c) => c.overall));
  const watch = [...cur].sort((a, b) => a.overall - b.overall).slice(0, 3).filter((c) => c.overall < 70);

  const stoppages = useMemo(() => notableStoppages(filterRecords(shiftRecords, { plantId: plant }), 240, 6), [shiftRecords, plant]);

  return (
    <>
      <PageHeader
        title="Plant Overview"
        subtitle={`${plant === 'all' ? 'Trichy · Singampunari · Viralimalai' : PLANT_NAME[plant] + ' plant'} · ${monthLabel(month)}${isCurrent ? ' (month to date)' : ''}`}
        actions={
          <>
            <select className="input !w-auto" value={plant} onChange={(e) => setPlant(e.target.value as PlantId | 'all')} aria-label="Plant">
              <option value="all">All plants</option>
              {PLANTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.city}
                </option>
              ))}
            </select>
            <select className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              {DATA_MONTHS.map((mm) => (
                <option key={mm} value={mm}>
                  {monthLabel(mm)}
                </option>
              ))}
            </select>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat label="Forged tonnage" value={`${fmtNumber(s.tonnes)} t`} sub={`Target ${fmtNumber(tonnageTarget)} t${isCurrent ? ' (pro-rata)' : ''}`} tone={tone(s.tonnes >= tonnageTarget, s.tonnes >= tonnageTarget * 0.95)} />
        <Stat label="OEE" value={`${s.oeePct.toFixed(1)}%`} sub="Target ≥ 78%" tone={tone(s.oeePct >= 78, s.oeePct >= 74)} hint="Availability × performance × quality on presses and hammers" />
        <Stat label="Forging yield" value={`${s.yieldPct.toFixed(1)}%`} sub="Target ≥ 88%" tone={tone(s.yieldPct >= 88, s.yieldPct >= 86)} />
        <Stat label="Power cost" value={`₹ ${fmtNumber(power)}`} sub="per tonne · target ≤ 4,200" tone={tone(power <= 4200, power <= 4300)} />
        <Stat label="Internal rejection" value={`${s.rejectionPct.toFixed(2)}%`} sub="Target ≤ 2.0%" tone={tone(s.rejectionPct <= 2, s.rejectionPct <= 2.3)} />
        <Stat label="OTIF delivery" value={`${otif.toFixed(1)}%`} sub="Target ≥ 95%" tone={tone(otif >= 95, otif >= 93)} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Stat
          label="Safety · recordable injuries"
          value={
            <span>
              {injuriesMonth} <span className="text-sm font-normal text-slate-500">in {monthLabel(month)}</span>
            </span>
          }
          sub={
            <span>
              <b className="text-slate-700">{injuriesYtd}</b> year to date (Apr – {monthLabel(month).slice(0, 3)}) · PPE compliance {s.ppePct.toFixed(1)}%
            </span>
          }
          tone={injuriesMonth === 0 ? 'green' : injuriesMonth === 1 ? 'amber' : 'red'}
          hint="Recordable injuries from the EHS register; year to date runs from 1 April"
        />
        <Card title="Performance review coverage" subtitle="Share of employees with a completed review · FY 2025-26 cycle">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-700">Staff</span>
                <span className="text-xl font-semibold tabular-nums text-slate-900">{staffCov.toFixed(0)}%</span>
              </div>
              <Bar value={staffCov} tone={staffCov >= 90 ? 'green' : 'amber'} height="h-2" />
              <div className="mt-1 text-[11px] text-slate-500">
                {cov.staffReviewed} of {cov.staffTotal} staff reviewed
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-700">Workers (incl. contract)</span>
                <span className="text-xl font-semibold tabular-nums text-slate-900">{workerCov.toFixed(0)}%</span>
              </div>
              <Bar value={workerCov} tone={workerCov >= 90 ? 'green' : workerCov >= 60 ? 'amber' : 'red'} height="h-2" />
              <div className="mt-1 text-[11px] text-slate-500">
                {cov.workersReviewed} of {cov.workersTotal} workers · contract workers {contractCov.toFixed(0)}% ({cov.contractReviewed} of {cov.contractTotal})
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card
          title="Appraisal completion"
          subtitle="Senior staff · FY 2026-27 Q2 review"
          action={
            <button className="btn btn-secondary !py-1" onClick={() => setPage('appraisals')}>
              Open appraisals
            </button>
          }
        >
          <div className="flex items-end gap-4">
            <div className="text-4xl font-semibold tabular-nums text-slate-900">{completion}%</div>
            <div className="pb-1 text-sm text-slate-500">
              {finalised} of {scoped.length} finalised
            </div>
          </div>
          <div className="mt-2">
            <Bar value={completion} height="h-2.5" tone="accent" />
          </div>
          <ul className="mt-4 space-y-2">
            {STAGES.map((st) => {
              const n = scoped.filter((r) => r.appraisal.status === st).length;
              return (
                <li key={st} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0">
                    <StatusChip status={st} />
                  </span>
                  <div className="flex-1">
                    <Bar value={n} max={Math.max(scoped.length, 1)} tone="slate" />
                  </div>
                  <span className="w-5 text-right tabular-nums text-slate-700">{n}</span>
                </li>
              );
            })}
          </ul>
          {scoped.some((r) => r.score !== null && r.score < 60) && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {scoped
                .filter((r) => r.score !== null && r.score < 60)
                .map((r) => (
                  <button key={r.emp.id} className="underline" onClick={() => openAppraisal(r.emp.id)}>
                    {r.emp.name} ({r.emp.role}, {r.score!.toFixed(1)})
                  </button>
                ))}{' '}
              is rated Unsatisfactory — review pending.
            </div>
          )}
        </Card>

        <Card
          title="PQCDSM summary · factory floor"
          subtitle={`${cur.length} operators and crew · average overall ${overall.toFixed(1)}`}
          action={
            <button className="btn btn-secondary !py-1" onClick={() => setPage('scorecards')}>
              Scorecards
            </button>
          }
        >
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <PqcdsmRadar scores={floorScores} />
            <ul className="space-y-2.5">
              {DIMS.map((k) => {
                const now = dimAvg(cur, k);
                const delta = prev.length ? now - dimAvg(prev, k) : 0;
                return (
                  <li key={k}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">
                        <b className="mr-1">{k}</b>
                        {PQCDSM_LABELS[k]}
                      </span>
                      <span className="tabular-nums">
                        <span className="font-semibold text-slate-900">{now.toFixed(1)}</span>
                        {prevMonth && (
                          <span className={`ml-1.5 text-xs ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
                          </span>
                        )}
                      </span>
                    </div>
                    <Bar value={now} tone="accent" />
                  </li>
                );
              })}
            </ul>
          </div>
          {watch.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <b>Floor watch-list:</b>{' '}
              {watch.map((c) => `${OPERATOR_MAP[c.operatorId].name} (${c.overall.toFixed(0)})`).join(' · ')}
            </div>
          )}
        </Card>
      </div>

      <Card title="Notable stoppages" subtitle="Machine-days with 4+ hours of downtime — excluded from operator productivity unless flagged as operator fault" pad={false}>
        <TableWrap>
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th className="th">Date</th>
                <th className="th">Plant</th>
                <th className="th">Machine</th>
                <th className="th">Main reason</th>
                <th className="th text-right">Downtime</th>
              </tr>
            </thead>
            <tbody>
              {stoppages.map((st) => (
                <tr key={`${st.date}-${st.machineId}`} className="tr-hover">
                  <td className="td">{fmtDate(st.date)}</td>
                  <td className="td">{PLANT_NAME[st.plantId]}</td>
                  <td className="td font-medium text-slate-900">{MACHINE_MAP[st.machineId].name}</td>
                  <td className="td">{st.reason}</td>
                  <td className="td text-right tabular-nums">{(st.minutes / 60).toFixed(1)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
