import { useState } from 'react';
import { LevelTrendChart } from '../components/Charts';
import { Card, Empty, ErrorBox, Loading, PageHeader, TableWrap } from '../components/ui';
import { get } from '../lib/api';
import { defaultPeriod, fiscalMonths, fiscalYearOf, fmtScore, fyLabel, monthLabel } from '../lib/format';
import { useAsync } from '../lib/hooks';
import type { ScorecardRow, UnitTrend } from '../lib/types';

export function UnitTrendPage() {
  const [fy, setFy] = useState(fiscalYearOf(defaultPeriod()));
  const [unitId, setUnitId] = useState('');
  const cards = useAsync(() => get<{ scorecards: ScorecardRow[] }>(`/scorecards?fiscalYear=${fy}`), [fy]);
  const units = cards.data?.scorecards ?? [];
  const unit = units.some((u) => u.orgUnitId === unitId) ? unitId : (units[0]?.orgUnitId ?? '');
  const trend = useAsync(() => (unit ? get<UnitTrend>(`/dashboards/units/${unit}?fiscalYear=${fy}`) : Promise.resolve(undefined)), [unit, fy]);
  const t = trend.data;

  return (
    <>
      <PageHeader
        title="Unit trend"
        subtitle="Official (locked) level scores by month, with quarter and year roll-ups. Months not yet locked are left out, not counted as zero."
        actions={
          <>
            <select className="input !w-auto" aria-label="Fiscal year" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
              {[fy - 1, fy, fy + 1].map((y) => (
                <option key={y} value={y}>
                  {fyLabel(y)}
                </option>
              ))}
            </select>
            <select className="input !w-auto" aria-label="Unit" value={unit} onChange={(e) => setUnitId(e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.orgUnitId}>
                  {u.unitCode}
                </option>
              ))}
            </select>
          </>
        }
      />
      {cards.loading && !cards.data ? (
        <Loading />
      ) : units.length === 0 ? (
        <Card>
          <Empty title={`No scored units with a scorecard for ${fyLabel(fy)}`} />
        </Card>
      ) : trend.error ? (
        <ErrorBox onRetry={trend.reload}>{trend.error}</ErrorBox>
      ) : !t ? (
        <Loading />
      ) : t.levels.length === 0 ? (
        <Card>
          <Empty title="No locked months yet" hint="Scores appear here once a month is locked." />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card title={`${t.unitCode} · monthly level scores`}>
            <LevelTrendChart
              months={fiscalMonths(fy)}
              series={t.levels.map((l) => ({ name: l.levelCode, values: Object.fromEntries(l.months.map((m) => [m.period, m.score])) }))}
            />
          </Card>
          <Card title="Roll-ups" pad={false}>
            <TableWrap>
              <table className="w-full" aria-label="Roll-ups">
                <thead>
                  <tr>
                    <th className="th">Level</th>
                    {[1, 2, 3, 4].map((q) => (
                      <th className="th" key={q}>
                        Q{q}
                      </th>
                    ))}
                    <th className="th">Year</th>
                    <th className="th">Locked months</th>
                  </tr>
                </thead>
                <tbody>
                  {t.levels.map((l) => (
                    <tr key={l.levelCode} data-testid={`rollup-${l.levelCode}`}>
                      <td className="td font-medium text-slate-900">{l.levelCode}</td>
                      {l.quarters.map((q) => (
                        <td className="td tabular-nums" key={q.quarter} title={`${q.monthsCounted} month(s) counted`}>
                          {fmtScore(q.score)}
                        </td>
                      ))}
                      <td className="td font-semibold tabular-nums">{fmtScore(l.year.score)}</td>
                      <td className="td">{l.months.map((m) => monthLabel(m.period).slice(0, 3)).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      )}
    </>
  );
}
