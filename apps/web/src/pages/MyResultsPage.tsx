import { Card, Chip, Empty, ErrorBox, Loading, PageHeader, TableWrap } from '../components/ui';
import { get } from '../lib/api';
import { fmtScore, monthLabel } from '../lib/format';
import { useAsync } from '../lib/hooks';

interface UnitMonth {
  period: string;
  unitCode: string;
  unitName: string;
  levelCode: string;
  levelName: string;
  daysInUnit: number;
  score: string | null;
}

/**
 * An Employee's own results. There are no individual scorecards yet, so what shows is each locked month in which the
 * employee was placed at a people level in a unit, with that level's official score for the unit.
 */
export function MyResultsPage() {
  const res = useAsync(() => get<{ unitMonths: UnitMonth[] }>('/me/scores'), []);
  const rows = res.data?.unitMonths ?? [];
  return (
    <>
      <PageHeader title="My results" subtitle="Official scores for the months you worked in a unit. Only locked months appear; you see your own records only." />
      <Card pad={false}>
        {res.loading && !res.data ? (
          <Loading />
        ) : res.error ? (
          <div className="p-4">
            <ErrorBox onRetry={res.reload}>{res.error}</ErrorBox>
          </div>
        ) : rows.length === 0 ? (
          <Empty title="No results yet" hint="A month shows here once the unit you worked in has been locked. Individual scorecards are not part of this release." />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[560px]" aria-label="My results">
              <thead>
                <tr>
                  <th className="th">Month</th>
                  <th className="th">Unit</th>
                  <th className="th">Your level</th>
                  <th className="th">Days in unit</th>
                  <th className="th">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.period}-${r.unitCode}`} className="tr-hover">
                    <td className="td font-medium text-slate-900">{monthLabel(r.period)}</td>
                    <td className="td">
                      {r.unitName} <span className="muted">{r.unitCode}</span>
                    </td>
                    <td className="td">
                      <Chip tone="accent">{r.levelName}</Chip>
                    </td>
                    <td className="td tabular-nums">{r.daysInUnit}</td>
                    <td className="td tabular-nums">{fmtScore(r.score === null ? null : Number(r.score))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
