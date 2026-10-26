import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monthLabel } from '../lib/format';

// Styling follows apps/demo/src/components/charts: one accent ramp plus neutrals, light grid, no animation (stable screenshots).
export const SERIES_COLORS = ['#c2410c', '#475569', '#fb923c', '#94a3b8', '#9a3412'];
const AXIS = { fontSize: 12, fill: '#64748b' };
const GRID = '#e2e8f0';

export function LevelTrendChart({ months, series }: { months: string[]; series: { name: string; values: Record<string, number | null> }[] }) {
  const data = months.map((p) => ({ period: p, label: monthLabel(p).slice(0, 3), ...Object.fromEntries(series.map((s) => [s.name, s.values[p] ?? null])) }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 12, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        {series.map((s, i) => (
          <Line key={s.name} isAnimationActive={false} type="monotone" dataKey={s.name} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 0 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PlantComparisonChart({ plants, levels }: { plants: { name: string; scores: Record<string, number | null> }[]; levels: string[] }) {
  const data = plants.map((p) => ({ name: p.name, ...Object.fromEntries(levels.map((l) => [l, p.scores[l] ?? null])) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[0, 'auto']} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        {levels.map((l, i) => (
          <Bar key={l} isAnimationActive={false} dataKey={l} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={36} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
