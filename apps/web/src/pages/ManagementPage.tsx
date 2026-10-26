import { useState } from 'react';
import { PlantComparisonChart } from '../components/Charts';
import { Card, Chip, Empty, ErrorBox, Loading, PageHeader, TableWrap } from '../components/ui';
import { get } from '../lib/api';
import { defaultPeriod, fmtScore, isPeriod, monthLabel } from '../lib/format';
import { useAsync } from '../lib/hooks';
import type { Management } from '../lib/types';

export function ManagementPage() {
  const [period, setPeriod] = useState(defaultPeriod());
  const data = useAsync(() => (isPeriod(period) ? get<Management>(`/dashboards/management?period=${period}`) : Promise.resolve(undefined)), [period]);

  return (
    <>
      <PageHeader
        title="Management comparison"
        subtitle="Plants compared within each plant type: the average level score across a plant's locked units. Plants with unlocked units are marked partial."
        actions={<input type="month" className="input !w-auto" aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} />}
      />
      {data.error ? (
        <ErrorBox onRetry={data.reload}>{data.error}</ErrorBox>
      ) : !data.data ? (
        <Loading />
      ) : data.data.plantTypes.length === 0 ? (
        <Card>
          <Empty title="No plants in your scope" />
        </Card>
      ) : (
        <div className="space-y-4">
          {data.data.plantTypes.map((pt) => {
            const levels = [...new Set(pt.plants.flatMap((p) => p.levels.map((l) => l.levelCode)))];
            const anyScore = pt.plants.some((p) => p.levels.some((l) => l.score !== null));
            return (
              <Card key={pt.code} title={`${pt.code} plants · ${monthLabel(data.data!.period)}`}>
                {!anyScore ? (
                  <Empty title="Nothing locked for this month yet" hint="Scores appear once a plant's units are locked." />
                ) : (
                  <PlantComparisonChart plants={pt.plants.map((p) => ({ name: p.code, scores: Object.fromEntries(p.levels.map((l) => [l.levelCode, l.score])) }))} levels={levels} />
                )}
                <TableWrap>
                  <table className="mt-3 w-full" aria-label={`${pt.code} comparison`}>
                    <thead>
                      <tr>
                        <th className="th">Plant</th>
                        <th className="th">Units locked</th>
                        {levels.map((l) => (
                          <th className="th" key={l}>
                            {l}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pt.plants.map((p) => (
                        <tr key={p.plantId} data-testid={`mgmt-row-${p.code}`}>
                          <td className="td font-medium text-slate-900">{p.code}</td>
                          <td className="td">
                            {p.unitsLocked} of {p.unitsTotal} {p.unitsLocked < p.unitsTotal && <Chip tone="amber">partial</Chip>}
                          </td>
                          {levels.map((l) => (
                            <td className="td tabular-nums" key={l}>
                              {fmtScore(p.levels.find((x) => x.levelCode === l)?.score)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
