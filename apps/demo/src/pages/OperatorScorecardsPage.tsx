import { AlertTriangle, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PqcdsmRadar, TrendLine } from '../components/charts/Charts';
import { employmentTone } from '../components/floor/FloorDashboard';
import { Avatar, Bar, Card, Chip, Empty, PageHeader, TableWrap, type Tone } from '../components/ui';
import { DATA_MONTHS } from '../config/floor.config';
import { PQCDSM_LABELS, PQCDSM_WEIGHTS } from '../config/scoring.config';
import { EMPLOYMENT_TYPES, OPERATORS, OPERATOR_MAP, OPERATOR_ROLES } from '../data/operators';
import { MACHINE_MAP, PLANTS, plantCity } from '../data/org';
import { useScorecards, useStore } from '../store/AppStore';
import type { EmploymentType, OperatorRole, PlantId, PqcdsmKey } from '../types';
import { fmtNumber, monthLabel } from '../utils/format';
import type { Scorecard } from '../utils/operatorScoring';

const DIMS: PqcdsmKey[] = ['P', 'Q', 'C', 'D', 'S', 'M'];
const scoreTone = (s: number): Tone => (s >= 90 ? 'green' : s >= 75 ? 'blue' : s >= 60 ? 'amber' : 'red');
const scoreText = (s: number) => (s >= 90 ? 'text-emerald-700' : s >= 75 ? 'text-slate-800' : s >= 60 ? 'text-amber-700' : 'text-red-600');

export function OperatorScorecardsPage() {
  const { role } = useStore();
  const lockedPlant: PlantId | null = role === 'supervisor' ? 'P1' : null;

  const [month, setMonth] = useState(DATA_MONTHS[DATA_MONTHS.length - 1]);
  const [plant, setPlant] = useState<PlantId | 'all'>(lockedPlant ?? 'all');
  const [opRole, setOpRole] = useState<OperatorRole | 'all'>('all');
  const [emp, setEmp] = useState<EmploymentType | 'all'>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState('op05');

  const m1 = useScorecards(DATA_MONTHS[0]);
  const m2 = useScorecards(DATA_MONTHS[1]);
  const m3 = useScorecards(DATA_MONTHS[2]);
  const byMonth: Record<string, Scorecard[]> = { [DATA_MONTHS[0]]: m1, [DATA_MONTHS[1]]: m2, [DATA_MONTHS[2]]: m3 };
  const cards = byMonth[month];

  const scopePlant = lockedPlant ?? plant;
  const rows = useMemo(
    () =>
      cards
        .filter((c) => {
          const op = OPERATOR_MAP[c.operatorId];
          return (
            (scopePlant === 'all' || op.plantId === scopePlant) &&
            (opRole === 'all' || op.role === opRole) &&
            (emp === 'all' || op.employment === emp) &&
            (!q || op.name.toLowerCase().includes(q.toLowerCase()))
          );
        })
        .sort((a, b) => b.overall - a.overall),
    [cards, scopePlant, opRole, emp, q],
  );

  const sel = rows.find((r) => r.operatorId === selected) ?? rows[0];

  return (
    <>
      <PageHeader
        title="Operator Scorecards"
        subtitle={`Monthly PQCDSM scores · ${lockedPlant ? 'Trichy plant' : 'all three plants'} · ${OPERATORS.filter((o) => scopePlant === 'all' || o.plantId === scopePlant).length} operators and crew`}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => rows[0] && setSelected(rows[0].operatorId)}>
              <Star size={14} className="text-accent-700" /> Top performer
            </button>
            <button className="btn btn-secondary" onClick={() => rows.length && setSelected(rows[rows.length - 1].operatorId)}>
              <AlertTriangle size={14} className="text-red-600" /> Needs support
            </button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {DATA_MONTHS.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        {!lockedPlant && (
          <select className="input" value={plant} onChange={(e) => setPlant(e.target.value as PlantId | 'all')} aria-label="Plant">
            <option value="all">All plants</option>
            {PLANTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.city}
              </option>
            ))}
          </select>
        )}
        <select className="input" value={opRole} onChange={(e) => setOpRole(e.target.value as OperatorRole | 'all')} aria-label="Role">
          <option value="all">All roles</option>
          {OPERATOR_ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select className="input" value={emp} onChange={(e) => setEmp(e.target.value as EmploymentType | 'all')} aria-label="Employment type">
          <option value="all">All employment types</option>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input className="input" placeholder="Search operator…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card pad={false} className="self-start">
          <TableWrap>
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr>
                  <th className="th">Operator</th>
                  {DIMS.map((k) => (
                    <th key={k} className="th text-center" title={PQCDSM_LABELS[k]}>
                      {k}
                    </th>
                  ))}
                  <th className="th w-24 xl:w-40">Overall</th>
                  <th className="th">Grade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const op = OPERATOR_MAP[c.operatorId];
                  return (
                    <tr
                      key={c.operatorId}
                      onClick={() => setSelected(c.operatorId)}
                      className={`cursor-pointer transition-colors ${sel?.operatorId === c.operatorId ? 'bg-accent-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="td">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={op.name} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">{op.name}</div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                              {op.role}
                              {op.machineId ? ` · ${op.machineId} / ${op.shift}` : ` · Shift ${op.shift}`}
                            </div>
                          </div>
                        </div>
                      </td>
                      {DIMS.map((k) => (
                        <td key={k} className={`td text-center text-xs tabular-nums ${scoreText(c.scores[k])}`}>
                          {c.detail.shifts ? Math.round(c.scores[k]) : '—'}
                        </td>
                      ))}
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <span className="w-10 font-semibold tabular-nums">{c.overall.toFixed(1)}</span>
                          <div className="hidden w-16 xl:block">
                            <Bar value={c.overall} tone={scoreTone(c.overall)} />
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <Chip tone={c.grade.tone}>{c.grade.label}</Chip>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <Empty title="No operators match these filters" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        {sel ? (
          <Detail card={sel} cards={cards} trend={DATA_MONTHS.map((m) => ({ name: monthLabel(m).slice(0, 3), overall: byMonth[m].find((c) => c.operatorId === sel.operatorId)?.overall ?? 0 }))} />
        ) : (
          <Card>
            <Empty title="Select an operator" />
          </Card>
        )}
      </div>
    </>
  );
}

function Detail({ card, cards, trend }: { card: Scorecard; cards: Scorecard[]; trend: { name: string; overall: number }[] }) {
  const op = OPERATOR_MAP[card.operatorId];
  const d = card.detail;
  const weights = PQCDSM_WEIGHTS[op.role];

  const peers = cards.filter((c) => OPERATOR_MAP[c.operatorId].role === op.role && c.detail.shifts > 0);
  const compare = Object.fromEntries(
    DIMS.map((k) => [k, Math.round((peers.reduce((s, c) => s + c.scores[k], 0) / (peers.length || 1)) * 10) / 10]),
  ) as Record<PqcdsmKey, number>;

  const metric: Record<PqcdsmKey, string> = {
    P: `${d.productivityPct.toFixed(1)}% of adjusted standard · ${fmtNumber(d.actualQty)} / ${fmtNumber(d.adjustedStandardQty)} pcs`,
    Q: `${d.rejectionPct.toFixed(2)}% rejection · ${fmtNumber(d.rejectedQty)} pcs`,
    C: `Scrap ${d.scrapPct.toFixed(2)}% vs ${d.scrapAllowancePct.toFixed(2)}% allowance${d.dieLifePct !== null ? ` · die life ${d.dieLifePct.toFixed(0)}%` : ''}`,
    D: `${d.shiftsMeetingPlan} of ${d.shifts} shifts met plan (${d.adherencePct.toFixed(0)}%)`,
    S: `PPE ${d.ppePct.toFixed(0)}% · ${d.incidents} incident${d.incidents === 1 ? '' : 's'} · ${d.nearMissReports} near-miss report${d.nearMissReports === 1 ? '' : 's'}`,
    M: `Attendance ${d.attendancePct.toFixed(0)}% · ${d.kaizens} kaizen${d.kaizens === 1 ? '' : 's'} · 5S ${d.fiveSAvg.toFixed(0)}`,
  };

  return (
    <div className="space-y-4 xl:sticky xl:top-0 xl:self-start">
      <Card>
        <div className="flex items-start gap-3">
          <Avatar name={op.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-slate-900">{op.name}</h2>
            <div className="text-xs text-slate-500">
              {op.role} · {op.empCode} · {plantCity(op.plantId)}
              {op.machineId ? ` · ${MACHINE_MAP[op.machineId].name}` : ''}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Chip tone={employmentTone(op.employment)}>{op.employment}</Chip>
              <Chip tone="slate">{op.tenureYears} yr service</Chip>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums text-slate-900">{card.overall.toFixed(1)}</div>
            <Chip tone={card.grade.tone}>{card.grade.label}</Chip>
          </div>
        </div>
        <PqcdsmRadar scores={card.scores} compare={compare} compareLabel={`${op.role} average`} />
      </Card>

      <Card title="Score breakdown" subtitle={`${op.role} weightages · ${d.shifts} shifts in month`} pad={false}>
        <ul className="divide-y divide-slate-100">
          {DIMS.map((k) => (
            <li key={k} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-slate-900">
                  {k} · {PQCDSM_LABELS[k]} <span className="text-xs font-normal text-slate-400">weight {weights[k]}%</span>
                </span>
                <span className={`font-semibold tabular-nums ${scoreText(card.scores[k])}`}>{card.scores[k].toFixed(1)}</span>
              </div>
              <div className="mt-1.5">
                <Bar value={card.scores[k]} tone={scoreTone(card.scores[k])} />
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{metric[k]}</div>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-900">
          <b>{(d.excludedDowntimeMin / 60).toFixed(1)} h</b> of downtime was <b>not the operator’s fault</b> and was excluded from productivity.
          {d.faultDowntimeMin > 0 && (
            <>
              {' '}
              <b>{d.faultDowntimeMin} min</b> attributed to the operator counts against them.
            </>
          )}
        </div>
      </Card>

      <Card title="Overall score trend" subtitle="Last three months">
        <TrendLine data={trend} dataKey="overall" />
      </Card>
    </div>
  );
}
