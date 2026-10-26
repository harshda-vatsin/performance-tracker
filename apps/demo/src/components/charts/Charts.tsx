import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PQCDSM_LABELS, RATING_BANDS, type RatingKey } from '../../config/scoring.config';
import type { PqcdsmKey } from '../../types';

export const BAND_HEX: Record<RatingKey, string> = {
  outstanding: '#059669',
  exceeds: '#14b8a6',
  meets: '#38bdf8',
  'needs-improvement': '#f59e0b',
  unsatisfactory: '#ef4444',
};

/** Orange ramp + slate ramp: one accent colour with neutral companions. */
export const SERIES_COLORS = ['#c2410c', '#fb923c', '#475569', '#94a3b8', '#cbd5e1'];
export const ACCENT = '#c2410c';

const AXIS = { fontSize: 12, fill: '#64748b' };
const GRID = '#e2e8f0';

export function RatingDistributionChart({ data }: { data: ({ name: string } & Record<string, number | string>)[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        {[...RATING_BANDS].reverse().map((b) => (
          <Bar isAnimationActive={false} key={b.key} dataKey={b.label} stackId="r" fill={BAND_HEX[b.key]} maxBarSize={44} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HistoryChart({ points }: { points: { cycle: string; score: number; current?: boolean }[] }) {
  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={points} margin={{ top: 12, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="cycle" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} tickFormatter={(v: string) => v.replace("FY ", "").replace(" (Q2)", "")} />
        <YAxis domain={[40, 125]} ticks={[60, 80, 95, 110]} tick={AXIS} tickLine={false} axisLine={false} />
        {RATING_BANDS.filter((b) => Number.isFinite(b.min)).map((b) => (
          <ReferenceLine key={b.key} y={b.min} stroke="#cbd5e1" strokeDasharray="3 3" />
        ))}
        <Tooltip />
        <Line
          type="monotone"
          dataKey="score"
          stroke={ACCENT}
          strokeWidth={2.5}
          dot={{ r: 4, fill: ACCENT, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

const DIMS: PqcdsmKey[] = ['P', 'Q', 'C', 'D', 'S', 'M'];

export function PqcdsmRadar({
  scores,
  compare,
  compareLabel = 'Floor average',
}: {
  scores: Record<PqcdsmKey, number>;
  compare?: Record<PqcdsmKey, number>;
  compareLabel?: string;
}) {
  const data = DIMS.map((k) => ({ dim: `${k} · ${PQCDSM_LABELS[k]}`, score: scores[k], compare: compare?.[k] }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} outerRadius="60%" margin={{ top: 8, right: 36, bottom: 8, left: 36 }}>
        <PolarGrid stroke={GRID} />
        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#475569' }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        {compare && (
          <Radar isAnimationActive={false} name={compareLabel} dataKey="compare" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.12} strokeDasharray="4 3" />
        )}
        <Radar isAnimationActive={false} name="Score" dataKey="score" stroke={ACCENT} fill={ACCENT} fillOpacity={0.25} strokeWidth={2} />
        <Tooltip />
        {compare && <Legend wrapperStyle={{ fontSize: 12 }} />}
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function RejectionTrendChart({ data, defects }: { data: Record<string, number | string>[]; defects: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={270}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} angle={-35} textAnchor="end" height={48} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        {defects.map((d, i) => (
          <Bar isAnimationActive={false} key={d} dataKey={d} stackId="d" fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GroupedBars({
  data,
  series,
}: {
  data: Record<string, number | string>[];
  series: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        {series.map((s, i) => (
          <Bar isAnimationActive={false} key={s} dataKey={s} fill={[ACCENT, '#fb923c', '#94a3b8'][i % 3]} radius={[3, 3, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({ data, dataKey, xKey = 'name' }: { data: Record<string, number | string>[]; dataKey: string; xKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip />
        <Line isAnimationActive={false} type="monotone" dataKey={dataKey} stroke={ACCENT} strokeWidth={2.5} dot={{ r: 3.5, fill: ACCENT, strokeWidth: 0 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
