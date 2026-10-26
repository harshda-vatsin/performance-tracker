import { useMemo, useState } from 'react';
import { employmentTone } from '../components/floor/FloorDashboard';
import { Bar, Card, Chip, PageHeader, Stat } from '../components/ui';
import { OPERATORS, OPERATOR_ROLES } from '../data/operators';
import { PLANTS } from '../data/org';
import { QUARTER_LABEL, SKILL_COLUMNS, SKILL_LEVEL_LABEL, buildSkillBaseline, buildSkillMatrix } from '../data/skills';
import { useStore } from '../store/AppStore';
import type { OperatorRole, PlantId, SkillLevel } from '../types';

const LEVEL_CLASS: Record<SkillLevel, string> = {
  0: 'bg-white text-slate-300',
  1: 'bg-amber-100 text-amber-800',
  2: 'bg-sky-100 text-sky-800',
  3: 'bg-teal-100 text-teal-800',
  4: 'bg-emerald-600 text-white',
};

export function SkillMatrixPage() {
  const { role, skills, setSkill } = useStore();
  const canEdit = role === 'supervisor' || role === 'hr';
  const lockedPlant: PlantId | null = role === 'supervisor' ? 'P1' : null;

  const [plant, setPlant] = useState<PlantId | 'all'>(lockedPlant ?? 'all');
  const [opRole, setOpRole] = useState<OperatorRole | 'all'>('all');
  const scopePlant = lockedPlant ?? plant;

  const ops = useMemo(
    () => OPERATORS.filter((o) => (scopePlant === 'all' || o.plantId === scopePlant) && (opRole === 'all' || o.role === opRole)),
    [scopePlant, opRole],
  );
  // Skill upgradation coverage: share of operators who moved up at least one level since the quarter began.
  const baseline = useMemo(() => buildSkillBaseline(buildSkillMatrix()), []);
  const upgraded = ops.filter((o) => SKILL_COLUMNS.some((c) => (skills[o.id]?.[c.id] ?? 0) > (baseline[o.id]?.[c.id] ?? 0))).length;
  const upgradePct = ops.length ? (upgraded / ops.length) * 100 : 0;

  const cols = SKILL_COLUMNS.filter((c) => scopePlant === 'all' || c.kind === 'operation' || c.plantId === scopePlant);

  const cycle = (opId: string, colId: string) => {
    if (!canEdit) return;
    const cur = (skills[opId]?.[colId] ?? 0) as SkillLevel;
    setSkill(opId, colId, ((cur + 1) % 5) as SkillLevel);
  };

  return (
    <>
      <PageHeader
        title="Skill Matrix"
        subtitle={canEdit ? 'Click a cell to change the level (L1 → L4 → clear).' : 'Operators × machines and operations. View only.'}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,320px)_1fr]">
        <Stat
          label="Skill upgradation coverage"
          value={`${upgradePct.toFixed(0)}%`}
          sub={`${upgraded} of ${ops.length} operators moved up at least one level · ${QUARTER_LABEL}`}
          hint="Share of operators in the current filter whose skill level rose in at least one machine or operation this quarter"
        />
        <div className="card flex flex-col justify-center p-4">
          <div className="mb-1.5 text-xs text-slate-500">Operators who moved up a level this quarter</div>
          <Bar value={upgradePct} tone="accent" height="h-2.5" />
          <div className="mt-1.5 text-[11px] text-slate-400">Changing a cell in the matrix below updates this figure.</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {!lockedPlant && (
          <select className="input !w-auto" value={plant} onChange={(e) => setPlant(e.target.value as PlantId | 'all')} aria-label="Plant">
            <option value="all">All plants</option>
            {PLANTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.city}
              </option>
            ))}
          </select>
        )}
        <select className="input !w-auto" value={opRole} onChange={(e) => setOpRole(e.target.value as OperatorRole | 'all')} aria-label="Role">
          <option value="all">All roles</option>
          {OPERATOR_ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {([1, 2, 3, 4] as SkillLevel[]).map((l) => (
            <span key={l} className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium ${LEVEL_CLASS[l]}`}>
              {SKILL_LEVEL_LABEL[l]}
            </span>
          ))}
        </div>
      </div>

      <Card pad={false}>
        <div className="max-h-[70vh] overflow-auto">
          <table className="border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="th sticky left-0 top-0 z-30 min-w-[220px] border-r border-slate-200">Operator</th>
                {cols.map((c) => (
                  <th key={c.id} className="th sticky top-0 z-20 min-w-[92px] whitespace-normal text-center normal-case tracking-normal">
                    <div className="text-[11px] font-semibold leading-tight text-slate-700">{c.label}</div>
                    <div className="text-[10px] font-normal text-slate-400">{c.sub}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ops.map((o) => (
                <tr key={o.id}>
                  <td className="td sticky left-0 z-10 border-r border-slate-200 bg-white">
                    <div className="font-medium text-slate-900">{o.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      {o.role}
                      <Chip tone={employmentTone(o.employment)}>{o.employment}</Chip>
                    </div>
                  </td>
                  {cols.map((c) => {
                    const lvl = (skills[o.id]?.[c.id] ?? 0) as SkillLevel;
                    return (
                      <td key={c.id} className="border-b border-slate-100 p-1 text-center">
                        <button
                          disabled={!canEdit}
                          onClick={() => cycle(o.id, c.id)}
                          title={SKILL_LEVEL_LABEL[lvl]}
                          className={`h-8 w-full min-w-[56px] rounded text-xs font-semibold transition-transform ${LEVEL_CLASS[lvl]} ${
                            canEdit ? 'hover:scale-105 hover:ring-2 hover:ring-accent-300' : 'cursor-default'
                          }`}
                        >
                          {lvl ? `L${lvl}` : '·'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="td sticky bottom-0 left-0 z-20 border-r border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                  Qualified (L3 +)
                </td>
                {cols.map((c) => {
                  const n = ops.filter((o) => (skills[o.id]?.[c.id] ?? 0) >= 3).length;
                  return (
                    <td key={c.id} className={`td sticky bottom-0 z-10 border-t border-slate-200 bg-slate-50 text-center text-sm font-semibold tabular-nums ${n < 2 ? 'text-red-600' : 'text-slate-700'}`}>
                      {n}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <p className="mt-2 text-xs text-slate-500">Red totals flag machines or operations with fewer than two qualified (L3+) people — a coverage risk for leave and shift swaps.</p>
    </>
  );
}
