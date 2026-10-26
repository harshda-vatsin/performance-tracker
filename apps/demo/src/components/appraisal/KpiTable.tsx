import { useEffect, useState } from 'react';
import { ACHIEVEMENT_CAP_PCT } from '../../config/scoring.config';
import type { Actual, GoalItem } from '../../types';
import { fmtNumber } from '../../utils/format';
import { achievementPct, scoreItems } from '../../utils/scoring';
import { KPI_MAP } from '../../data/kpiCatalog';
import { Bar, Chip, TableWrap, type Tone } from '../ui';
import { DirectionTag, SourceBadge } from './parts';

function NumberCell({ value, decimals, onCommit, disabled }: { value: number; decimals: number; onCommit: (n: number) => void; disabled: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      className="input !w-28 text-right tabular-nums"
      type="number"
      step={decimals > 0 ? Math.pow(10, -decimals) : 1}
      value={text}
      disabled={disabled}
      title={disabled ? 'Manual KPIs can be edited during self-assessment (employee) and manager assessment' : 'Enter the actual value'}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n) && n >= 0) onCommit(n);
      }}
    />
  );
}

const achTone = (a: number): Tone => (a >= 100 ? 'green' : a >= 80 ? 'blue' : a >= 60 ? 'amber' : 'red');

export function KpiTable({
  items,
  actuals,
  editableManual = false,
  onActualChange,
}: {
  items: GoalItem[];
  actuals: Record<string, Actual>;
  editableManual?: boolean;
  onActualChange?: (kraId: string, value: number) => void;
}) {
  const { rows, total } = scoreItems(items, actuals);
  return (
    <TableWrap>
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr>
            <th className="th">KRA / KPI</th>
            <th className="th text-right">Weight</th>
            <th className="th text-right">Target</th>
            <th className="th text-right">Actual</th>
            <th className="th">Source</th>
            <th className="th w-44">Achievement</th>
            <th className="th text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, actual, achievement, points }) => {
            const raw = achievementPct(actual ?? 0, item.target, item.direction, Number.POSITIVE_INFINITY);
            const capped = Number.isFinite(raw) && raw > ACHIEVEMENT_CAP_PCT;
            const decimals = KPI_MAP[item.kpiKey]?.decimals ?? 0;
            const a = actuals[item.kraId];
            return (
              <tr key={item.kraId} className="tr-hover">
                <td className="td">
                  <div className="font-medium text-slate-900">{item.kpi}</div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {item.area} · <DirectionTag direction={item.direction} />
                  </div>
                </td>
                <td className="td text-right tabular-nums">{item.weightage}%</td>
                <td className="td text-right tabular-nums">
                  {fmtNumber(item.target, decimals)} <span className="text-xs text-slate-400">{item.unit}</span>
                </td>
                <td className="td text-right">
                  {item.source === 'Manual' && a ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <NumberCell
                        value={a.value}
                        decimals={decimals}
                        disabled={!editableManual}
                        onCommit={(n) => onActualChange?.(item.kraId, n)}
                      />
                    </div>
                  ) : (
                    <span className="tabular-nums">{actual === undefined ? '—' : fmtNumber(actual, decimals)}</span>
                  )}
                  <div className="whitespace-nowrap text-[11px] text-slate-400">{item.unit}</div>
                </td>
                <td className="td">
                  <SourceBadge source={item.source} lastSynced={a?.lastSynced} />
                </td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <Bar value={achievement} max={ACHIEVEMENT_CAP_PCT} tone={achTone(achievement)} />
                    </div>
                    <span className="w-12 text-right text-sm font-medium tabular-nums">{achievement.toFixed(1)}%</span>
                  </div>
                  {capped && (
                    <div className="mt-0.5">
                      <Chip tone="slate" title={`Raw achievement ${raw.toFixed(0)}% is capped at ${ACHIEVEMENT_CAP_PCT}%`}>
                        capped at {ACHIEVEMENT_CAP_PCT}%
                      </Chip>
                    </div>
                  )}
                </td>
                <td className="td text-right tabular-nums text-slate-700">{points.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="td font-semibold text-slate-900">Weighted total score</td>
            <td className="td text-right font-semibold tabular-nums">{items.reduce((s, i) => s + i.weightage, 0)}%</td>
            <td className="td" colSpan={4} />
            <td className="td text-right text-base font-semibold tabular-nums text-slate-900">{total.toFixed(1)}</td>
          </tr>
        </tfoot>
      </table>
    </TableWrap>
  );
}
