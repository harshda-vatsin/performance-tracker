import { Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DATA_MONTHS, DEFECT_TYPES, SHIFTS } from '../../config/floor.config';
import { PQCDSM_LABELS } from '../../config/scoring.config';
import { EMPLOYMENT_TYPES, OPERATOR_MAP, OPERATOR_ROLES } from '../../data/operators';
import { LINES, MACHINE_MAP, PLANTS, plantCity } from '../../data/org';
import { useScorecards, useStore } from '../../store/AppStore';
import type { EmploymentType, PlantId, PqcdsmKey } from '../../types';
import { filterRecords, summarise, weeklyRejections } from '../../utils/aggregate';
import { fmtNumber, monthLabel } from '../../utils/format';
import { GroupedBars, RejectionTrendChart } from '../charts/Charts';
import { Avatar, Bar, Card, Chip, Stat, Tabs, TableWrap, type Tone } from '../ui';

const DIMS: PqcdsmKey[] = ['P', 'Q', 'C', 'D', 'S', 'M'];
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0);

export function employmentTone(e: EmploymentType): Tone {
  return e === 'Permanent' ? 'blue' : e === 'Contract' ? 'amber' : 'slate';
}

export function FloorDashboard({ plantScope }: { plantScope: PlantId | 'all' }) {
  const { shiftRecords } = useStore();
  const [month, setMonth] = useState(DATA_MONTHS[DATA_MONTHS.length - 1]);
  const [plant, setPlant] = useState<PlantId | 'all'>(plantScope);
  const [tab, setTab] = useState<'floor' | 'employment'>('floor');
  const cards = useScorecards(month);

  const scopedPlant = plantScope === 'all' ? plant : plantScope;
  const monthRecords = useMemo(() => filterRecords(shiftRecords, { month, plantId: scopedPlant }), [shiftRecords, month, scopedPlant]);
  const stats = useMemo(() => summarise(monthRecords, MACHINE_MAP), [monthRecords]);

  const opCards = cards.filter((c) => scopedPlant === 'all' || OPERATOR_MAP[c.operatorId].plantId === scopedPlant).filter((c) => c.detail.shifts > 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { key: 'floor', label: 'Lines, shifts & top performers' },
            { key: 'employment', label: 'By employment type' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="-mt-4 flex items-center gap-2">
          {plantScope === 'all' && (
            <select className="input !w-auto" value={plant} onChange={(e) => setPlant(e.target.value as PlantId | 'all')} aria-label="Plant">
              <option value="all">All plants</option>
              {PLANTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.city}
                </option>
              ))}
            </select>
          )}
          <select className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {DATA_MONTHS.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {m === DATA_MONTHS[DATA_MONTHS.length - 1] ? ' (this month)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tab === 'floor' ? (
        <FloorTab month={month} plant={scopedPlant} stats={stats} opCards={opCards} />
      ) : (
        <EmploymentTab opCards={opCards} month={month} />
      )}
    </>
  );
}

type Card_ = ReturnType<typeof useScorecards>[number];

function FloorTab({
  month,
  plant,
  stats,
  opCards,
}: {
  month: string;
  plant: PlantId | 'all';
  stats: ReturnType<typeof summarise>;
  opCards: Card_[];
}) {
  const { shiftRecords } = useStore();

  const board = useMemo(() => {
    const rows: { key: string; line: string; shift: string; plantName: string; s: ReturnType<typeof summarise> }[] = [];
    for (const line of LINES.filter((l) => plant === 'all' || l.plantId === plant)) {
      for (const shift of SHIFTS) {
        const recs = filterRecords(shiftRecords, { month, lineId: line.id, shift });
        if (recs.length === 0) continue;
        rows.push({ key: `${line.id}-${shift}`, line: line.name, shift, plantName: plantCity(line.plantId), s: summarise(recs, MACHINE_MAP) });
      }
    }
    return rows.sort((a, b) => b.s.goodVsStdPct - a.s.goodVsStdPct);
  }, [shiftRecords, month, plant]);

  const trend = useMemo(() => weeklyRejections(filterRecords(shiftRecords, { plantId: plant })), [shiftRecords, plant]);

  const defectMix = useMemo(() => {
    const totals = DEFECT_TYPES.map((d) => ({
      d,
      n: shiftRecords
        .filter((r) => r.date.startsWith(month) && (plant === 'all' || r.plantId === plant))
        .reduce((s, r) => s + r.rejections.filter((x) => x.defect === d).reduce((a, x) => a + x.qty, 0), 0),
    }));
    const max = Math.max(...totals.map((t) => t.n), 1);
    return { totals, max };
  }, [shiftRecords, month, plant]);

  const top = [...opCards].sort((a, b) => b.overall - a.overall).slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Output vs plan" value={`${stats.outputVsPlanPct.toFixed(1)}%`} sub="Includes all stoppages" />
        <Stat label="Productivity" value={`${stats.productivityPct.toFixed(1)}%`} sub="Vs downtime-adjusted standard" tone={stats.productivityPct >= 92 ? 'green' : 'amber'} hint="Non-operator downtime removed from the standard" />
        <Stat label="Rejection" value={`${stats.rejectionPct.toFixed(2)}%`} sub="Target ≤ 2.0%" tone={stats.rejectionPct <= 2 ? 'green' : 'amber'} />
        <Stat label="Downtime" value={`${fmtNumber(stats.downtimeMin / 60, 0)} h`} sub={`${stats.shifts} machine-shifts`} />
        <Stat label="PPE compliance" value={`${stats.ppePct.toFixed(1)}%`} sub="Shifts fully compliant" tone={stats.ppePct >= 95 ? 'green' : 'amber'} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Card title="Line & shift leaderboard" subtitle={`${monthLabel(month)} · ranked by good pieces vs adjusted standard`} pad={false}>
          <TableWrap>
            <table className="w-full min-w-[600px] border-collapse">
              <thead>
                <tr>
                  <th className="th">#</th>
                  <th className="th">Line</th>
                  <th className="th">Shift</th>
                  <th className="th text-right">Vs plan</th>
                  <th className="th text-right">Productivity</th>
                  <th className="th text-right">Rejection</th>
                  <th className="th text-right">Downtime</th>
                  <th className="th">Good / std</th>
                </tr>
              </thead>
              <tbody>
                {board.map((r, i) => (
                  <tr key={r.key} className="tr-hover">
                    <td className="td">
                      {i === 0 ? <Trophy size={15} className="text-accent-700" /> : <span className="text-slate-400">{i + 1}</span>}
                    </td>
                    <td className="td">
                      <div className="whitespace-nowrap font-medium text-slate-900">{r.line}</div>
                      <div className="text-[11px] text-slate-500">{r.plantName}</div>
                    </td>
                    <td className="td">
                      <Chip tone="slate">Shift {r.shift}</Chip>
                    </td>
                    <td className="td text-right tabular-nums">{r.s.outputVsPlanPct.toFixed(1)}%</td>
                    <td className="td text-right tabular-nums">{r.s.productivityPct.toFixed(1)}%</td>
                    <td className={`td text-right tabular-nums ${r.s.rejectionPct > 2.4 ? 'text-red-600' : ''}`}>{r.s.rejectionPct.toFixed(2)}%</td>
                    <td className="td text-right tabular-nums">{(r.s.downtimeMin / 60).toFixed(0)} h</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <div className="w-12">
                          <Bar value={r.s.goodVsStdPct} max={100} tone={r.s.goodVsStdPct >= 90 ? 'green' : 'amber'} />
                        </div>
                        <span className="text-xs tabular-nums">{r.s.goodVsStdPct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card title="Top performers this month" subtitle={`${monthLabel(month)} · overall PQCDSM score`} pad={false}>
          <ul className="divide-y divide-slate-100">
            {top.map((c, i) => {
              const op = OPERATOR_MAP[c.operatorId];
              return (
                <li key={c.operatorId} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-4 text-sm font-semibold text-slate-400">{i + 1}</span>
                  <Avatar name={op.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{op.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {op.role}
                      {op.machineId ? ` · ${MACHINE_MAP[op.machineId].name}` : ''} · {op.employment}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-slate-900">{c.overall.toFixed(1)}</div>
                    <Chip tone={c.grade.tone}>{c.grade.label}</Chip>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Card title="Rejection trend by defect type" subtitle="Weekly rejected pieces, Aug – Oct">
          <RejectionTrendChart data={trend} defects={DEFECT_TYPES} />
          <p className="mt-1 text-xs text-slate-500">
            Lap / fold peaked in September (die wear) and dropped after the early-October die refurbishment.
          </p>
        </Card>
        <Card title={`Defect mix · ${monthLabel(month)}`} subtitle="Rejected pieces by defect type">
          <ul className="space-y-3">
            {defectMix.totals.map(({ d, n }) => (
              <li key={d}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-700">{d}</span>
                  <span className="tabular-nums text-slate-500">{fmtNumber(n)}</span>
                </div>
                <Bar value={n} max={defectMix.max} tone="accent" height="h-2" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function EmploymentTab({ opCards, month }: { opCards: Card_[]; month: string }) {
  const byType = EMPLOYMENT_TYPES.map((t) => {
    const cs = opCards.filter((c) => OPERATOR_MAP[c.operatorId].employment === t);
    const dims = Object.fromEntries(DIMS.map((k) => [k, avg(cs.map((c) => c.scores[k]))])) as Record<PqcdsmKey, number>;
    const sorted = [...cs].sort((a, b) => b.overall - a.overall);
    return { type: t, cs, overall: avg(cs.map((c) => c.overall)), dims, best: sorted[0], worst: sorted[sorted.length - 1] };
  });

  const chart = DIMS.map((k) => {
    const row: Record<string, number | string> = { name: `${k} · ${PQCDSM_LABELS[k]}` };
    byType.forEach((t) => (row[t.type] = Math.round(t.dims[k] * 10) / 10));
    return row;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {byType.map((t) => (
          <Card key={t.type}>
            <div className="flex items-center justify-between">
              <Chip tone={employmentTone(t.type)}>{t.type}</Chip>
              <span className="text-xs text-slate-500">
                {t.cs.length} people · {Math.round((t.cs.length / Math.max(opCards.length, 1)) * 100)}% of workforce
              </span>
            </div>
            <div className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{t.overall.toFixed(1)}</div>
            <div className="text-xs text-slate-500">Average overall score · {monthLabel(month)}</div>
            <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
              {t.best && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Best</dt>
                  <dd className="truncate font-medium text-slate-700">
                    {OPERATOR_MAP[t.best.operatorId].name} · {t.best.overall.toFixed(0)}
                  </dd>
                </div>
              )}
              {t.worst && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Needs support</dt>
                  <dd className="truncate font-medium text-slate-700">
                    {OPERATOR_MAP[t.worst.operatorId].name} · {t.worst.overall.toFixed(0)}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="PQCDSM by employment type" subtitle="Average dimension score">
          <GroupedBars data={chart} series={EMPLOYMENT_TYPES} />
        </Card>
        <Card title="Average overall score · role × employment type" subtitle="— means nobody in that group" pad={false}>
          <TableWrap>
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr>
                  <th className="th">Role</th>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <th key={t} className="th text-right">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {OPERATOR_ROLES.map((r) => (
                  <tr key={r} className="tr-hover">
                    <td className="td font-medium text-slate-900">{r}</td>
                    {EMPLOYMENT_TYPES.map((t) => {
                      const cs = opCards.filter((c) => OPERATOR_MAP[c.operatorId].role === r && OPERATOR_MAP[c.operatorId].employment === t);
                      const a = avg(cs.map((c) => c.overall));
                      return (
                        <td key={t} className="td text-right tabular-nums">
                          {cs.length ? (
                            <span className={a < 70 ? 'font-medium text-red-600' : a >= 90 ? 'font-medium text-emerald-700' : ''}>
                              {a.toFixed(1)} <span className="text-[11px] text-slate-400">({cs.length})</span>
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </div>
    </div>
  );
}
