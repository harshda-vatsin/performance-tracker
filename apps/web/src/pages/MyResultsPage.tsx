import { Card, Chip, Empty, ErrorBox, Loading, PageHeader, TableWrap } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { fmtPaise, fmtScore, monthLabel } from '../lib/format';
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
  const { can } = useAuth();
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
      {can('bonus:own') && <MyBonus />}
    </>
  );
}

interface BonusStatement {
  totalPaise: number;
  months: {
    period: string;
    totalPaise: number;
    lines: { kind: 'REGULAR' | 'ADJUSTMENT'; plantName: string; score: number | null; days: number | null; band: string | null; basePaise: number; percentBp: number; amountPaise: number; note: string | null; reason: string | null }[];
  }[];
}

/** The employee's own bonus statement: locked batches only, adjustments as their own lines. */
function MyBonus() {
  const res = useAsync(() => get<BonusStatement>('/me/bonus'), []);
  const months = res.data?.months ?? [];
  return (
    <div className="mt-6">
      <PageHeader title="My bonus" subtitle="Your approved bonus by month. A correction after approval appears as its own adjustment line." />
      <Card pad={false} action={res.data ? <span className="text-sm text-slate-600">Total <b data-testid="bonus-total">{fmtPaise(res.data.totalPaise)}</b></span> : undefined}>
        {res.loading && !res.data ? (
          <Loading />
        ) : res.error ? (
          <div className="p-4">
            <ErrorBox onRetry={res.reload}>{res.error}</ErrorBox>
          </div>
        ) : months.length === 0 ? (
          <Empty title="No bonus yet" hint="A month shows here once Corporate HR has calculated it and a second Corporate HR user has approved it." />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[560px]" aria-label="My bonus">
              <thead>
                <tr>
                  <th className="th">Month</th>
                  <th className="th">Detail</th>
                  <th className="th text-right">Score</th>
                  <th className="th text-right">Base</th>
                  <th className="th text-right">Percent</th>
                  <th className="th text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {months.flatMap((m) =>
                  m.lines.map((l, i) => (
                    <tr key={`${m.period}-${i}`} className="tr-hover">
                      <td className="td font-medium text-slate-900">{i === 0 ? monthLabel(m.period) : ''}</td>
                      <td className="td">{l.kind === 'REGULAR' ? `Bonus · ${l.plantName}${l.band ? ` · ${l.band}` : ''}` : `Adjustment: ${l.reason ?? ''}`}</td>
                      <td className="td text-right tabular-nums">{l.kind === 'REGULAR' ? fmtScore(l.score) : '—'}</td>
                      <td className="td text-right tabular-nums">{l.kind === 'REGULAR' ? fmtPaise(l.basePaise) : '—'}</td>
                      <td className="td text-right tabular-nums">{l.kind === 'REGULAR' ? `${l.percentBp / 100}%` : '—'}</td>
                      <td className="td text-right font-medium tabular-nums">{fmtPaise(l.amountPaise)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
