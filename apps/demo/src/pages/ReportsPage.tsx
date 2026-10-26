import { Download, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PQCDSM_LABELS, INCREMENT_GUIDELINE } from '../config/scoring.config';
import { DATA_MONTHS } from '../config/floor.config';
import { OPERATOR_MAP } from '../data/operators';
import { MACHINE_MAP, lineById, plantCity } from '../data/org';
import { SKILL_COLUMNS } from '../data/skills';
import { OPERATORS } from '../data/operators';
import { useScorecards, useStaffRows, useStore, type StaffRow } from '../store/AppStore';
import { Card, PageHeader, TableWrap } from '../components/ui';
import { pendingWith } from '../components/appraisal/parts';
import { downloadCsv, downloadXlsx, type ExportRow } from '../utils/export';
import { filterRecords } from '../utils/aggregate';
import { monthLabel } from '../utils/format';
import { rejectedQty, totalDowntimeMin } from '../utils/operatorScoring';
import { achievementPct, bandByKey } from '../utils/scoring';
import type { PqcdsmKey } from '../types';

/** Increment-cycle sheet for HR: one row per senior-staff member. */
export function incrementRows(rows: StaffRow[]): ExportRow[] {
  return rows.map((r) => {
    const key = r.final && r.appraisal.finalRating ? r.appraisal.finalRating : r.rating?.key;
    return {
      'Emp Code': r.emp.empCode,
      Name: r.emp.name,
      Designation: r.emp.role,
      Department: r.emp.department,
      Plant: plantCity(r.emp.plantId),
      'Reporting Manager': r.emp.managerName,
      'Appraisal Status': r.appraisal.status,
      'Score (weighted)': r.score === null ? '' : Number(r.score.toFixed(1)),
      Rating: key ? bandByKey(key).label : '',
      'Recommended Increment %': key ? INCREMENT_GUIDELINE[key] : '',
      Basis: r.final ? 'Final' : 'Provisional (live score)',
    };
  });
}

type ReportId = 'increment' | 'status' | 'kpi' | 'scorecards' | 'shift' | 'skills';

const REPORTS: { id: ReportId; title: string; desc: string; floor?: boolean }[] = [
  { id: 'increment', title: 'Increment cycle sheet', desc: 'Score, rating and recommended increment % for every senior-staff member.' },
  { id: 'status', title: 'Appraisal status tracker', desc: 'Where each appraisal sits in the workflow and who it is pending with.' },
  { id: 'kpi', title: 'KPI actuals extract', desc: 'Every KPI: target, actual, achievement %, weightage and data source.' },
  { id: 'scorecards', title: 'Operator monthly scorecards', desc: 'PQCDSM scores and overall grade for all operators.', floor: true },
  { id: 'shift', title: 'Shift data extract', desc: 'Planned vs actual, rejections and downtime for every shift record.', floor: true },
  { id: 'skills', title: 'Skill matrix', desc: 'Operator × machine / operation skill levels (L1–L4).' },
];

export function ReportsPage() {
  const rows = useStaffRows();
  const { goalSheets, appraisals, shiftRecords, skills, notify } = useStore();
  const [id, setId] = useState<ReportId>('increment');
  const [month, setMonth] = useState(DATA_MONTHS[DATA_MONTHS.length - 1]);
  const cards = useScorecards(month);
  const def = REPORTS.find((r) => r.id === id)!;

  const data: ExportRow[] = useMemo(() => {
    switch (id) {
      case 'increment':
        return incrementRows(rows);
      case 'status':
        return rows.map((r) => {
          const p = pendingWith(r.appraisal.status, r.emp, r.sheet?.status);
          const last = r.appraisal.comments[r.appraisal.comments.length - 1];
          return {
            'Emp Code': r.emp.empCode,
            Name: r.emp.name,
            Designation: r.emp.role,
            'Goal Sheet': r.sheet?.status ?? 'Not assigned',
            'Appraisal Status': r.appraisal.status,
            'Pending With': p ? `${p.role} — ${p.name}` : '—',
            'Last Comment By': last?.author ?? '',
            'Last Comment On': last?.at.slice(0, 10) ?? '',
          };
        });
      case 'kpi':
        return goalSheets.flatMap((g) => {
          const a = appraisals.find((x) => x.employeeId === g.employeeId);
          const e = rows.find((r) => r.emp.id === g.employeeId)!.emp;
          return g.items.map((i) => {
            const actual = a?.actuals[i.kraId]?.value;
            return {
              Name: e.name,
              Designation: e.role,
              KRA: i.area,
              KPI: i.kpi,
              Unit: i.unit,
              Direction: i.direction === 'higher' ? 'Higher is better' : 'Lower is better',
              'Weightage %': i.weightage,
              Target: i.target,
              Actual: actual ?? '',
              'Achievement % (capped)': actual === undefined ? '' : Number(achievementPct(actual, i.target, i.direction).toFixed(1)),
              Source: i.source === 'SAP' ? 'SAP S/4HANA' : 'Manual entry',
            };
          });
        });
      case 'scorecards':
        return cards.map((c) => {
          const op = OPERATOR_MAP[c.operatorId];
          const row: ExportRow = {
            'Emp Code': op.empCode,
            Name: op.name,
            Role: op.role,
            Employment: op.employment,
            Plant: plantCity(op.plantId),
            Month: monthLabel(c.month),
          };
          (Object.keys(PQCDSM_LABELS) as PqcdsmKey[]).forEach((k) => (row[`${k} · ${PQCDSM_LABELS[k]}`] = c.scores[k]));
          row['Overall'] = c.overall;
          row['Grade'] = c.grade.label;
          return row;
        });
      case 'shift':
        return filterRecords(shiftRecords, { month }).map((r) => ({
          Date: r.date,
          Shift: r.shift,
          Plant: plantCity(r.plantId),
          Line: lineById(r.lineId).name,
          Product: r.product,
          Machine: MACHINE_MAP[r.machineId].name,
          Operator: OPERATOR_MAP[r.operatorId]?.name ?? r.operatorId,
          'Planned Qty': r.plannedQty,
          'Actual Qty': r.actualQty,
          'Rejected Qty': rejectedQty(r),
          'Downtime (min)': totalDowntimeMin(r),
          'PPE Compliant': r.ppeCompliant ? 'Y' : 'N',
          '5S Score': r.fiveS,
        }));
      case 'skills':
        return OPERATORS.map((op) => {
          const row: ExportRow = { Name: op.name, Role: op.role, Employment: op.employment, Plant: plantCity(op.plantId) };
          SKILL_COLUMNS.forEach((c) => (row[c.label + (c.kind === 'machine' ? ` (${c.id})` : '')] = skills[op.id]?.[c.id] ? `L${skills[op.id][c.id]}` : ''));
          return row;
        });
    }
  }, [id, rows, goalSheets, appraisals, shiftRecords, skills, cards, month]);

  const filename = `mmf-${id}${def.floor ? `-${month}` : ''}`;
  const headers = data[0] ? Object.keys(data[0]) : [];

  return (
    <>
      <PageHeader title="Reports" subtitle="Export-ready extracts for the increment cycle, operations reviews and audits" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-2">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              onClick={() => setId(r.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                id === r.id ? 'border-accent-300 bg-accent-50' : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileSpreadsheet size={15} className={id === r.id ? 'text-accent-700' : 'text-slate-400'} />
                {r.title}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{r.desc}</div>
            </button>
          ))}
        </div>

        <Card
          title={def.title}
          subtitle={`${data.length} rows · preview of the first 8`}
          pad={false}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {def.floor && (
                <select className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
                  {DATA_MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => {
                  downloadCsv(filename, data);
                  notify(`${def.title} exported as CSV.`);
                }}
              >
                <Download size={15} /> CSV
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await downloadXlsx(filename, def.title, data);
                  notify(`${def.title} exported as Excel.`);
                }}
              >
                <Download size={15} /> Excel
              </button>
            </div>
          }
        >
          <TableWrap>
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="th">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 8).map((r, i) => (
                  <tr key={i} className="tr-hover">
                    {headers.map((h) => (
                      <td key={h} className="td whitespace-nowrap">
                        {String(r[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {def.id === 'increment' && (
            <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              Increment % follows the guideline in <code className="rounded bg-slate-100 px-1">src/config/scoring.config.ts</code>. Rows marked
              “Provisional” will change if actuals are edited before finalisation.
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
