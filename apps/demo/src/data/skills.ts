import type { PlantId, SkillLevel, SkillMap } from '../types';
import { clamp, hashString, mulberry32 } from '../utils/prng';
import { MACHINES, MACHINE_MAP, plantCity } from './org';
import { OPERATORS, STAR_OPERATOR_ID, WEAK_OPERATOR_ID, skillFactor } from './operators';

export interface SkillColumn {
  id: string;
  label: string;
  sub: string;
  kind: 'machine' | 'operation';
  plantId?: PlantId;
}

export const OPERATION_COLUMNS: SkillColumn[] = [
  { id: 'OP-DIE', label: 'Die setting', sub: 'Operation', kind: 'operation' },
  { id: 'OP-INS', label: 'MPI / visual inspection', sub: 'Operation', kind: 'operation' },
  { id: 'OP-HAN', label: 'Billet handling', sub: 'Operation', kind: 'operation' },
];

export const SKILL_COLUMNS: SkillColumn[] = [
  ...MACHINES.map((m) => ({
    id: m.id,
    label: m.name.replace(/\s*\(.*\)/, ''),
    sub: `${m.id} · ${plantCity(m.plantId)}`,
    kind: 'machine' as const,
    plantId: m.plantId,
  })),
  ...OPERATION_COLUMNS,
];

export const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = {
  0: 'Not assessed',
  1: 'L1 · In training',
  2: 'L2 · Works with supervision',
  3: 'L3 · Works independently',
  4: 'L4 · Can train others',
};

export function buildSkillMatrix(): SkillMap {
  const map: SkillMap = {};
  for (const op of OPERATORS) {
    const rand = mulberry32(hashString(`skill-${op.id}`));
    const skill = skillFactor(op);
    const row: Record<string, SkillLevel> = {};

    // Level on the rostered machine reflects tenure and performance.
    let primary: number;
    if (op.id === STAR_OPERATOR_ID) primary = 4;
    else if (op.id === WEAK_OPERATOR_ID) primary = 2;
    else if (op.employment === 'Trainee') primary = 1;
    else if (op.tenureYears >= 8) primary = skill >= 1.03 ? 4 : 3;
    else if (op.tenureYears >= 3) primary = 3;
    else primary = 2;

    const primaryMachine = op.machineId ? MACHINE_MAP[op.machineId] : undefined;
    for (const m of MACHINES) {
      if (op.machineId === m.id) {
        row[m.id] = primary as SkillLevel;
      } else if (primaryMachine && m.type === primaryMachine.type) {
        // cross-trained on a similar machine
        const samePlant = m.plantId === op.plantId;
        const p = samePlant ? 0.75 : 0.3;
        row[m.id] = (rand() < p ? clamp(primary - (samePlant ? 1 : 2), 1, 4) : 0) as SkillLevel;
      } else if (!primaryMachine && m.plantId === op.plantId) {
        // die setters / helpers / inspectors know their plant's machines
        const base = op.role === 'Die Setter' ? 3 : op.role === 'Inspector' ? 2 : 1;
        row[m.id] = (m.type === 'furnace' ? 0 : clamp(base + (rand() < 0.4 ? 1 : 0), 0, 4)) as SkillLevel;
      } else {
        row[m.id] = (rand() < 0.15 && m.plantId === op.plantId ? 1 : 0) as SkillLevel;
      }
    }

    // Operations
    row['OP-DIE'] = (op.role === 'Die Setter' ? clamp(primary + 1, 2, 4) : op.role === 'Press Operator' && primary >= 3 ? 2 : 0) as SkillLevel;
    row['OP-INS'] = (op.role === 'Inspector' ? clamp(primary + 1, 2, 4) : rand() < 0.25 ? 1 : 0) as SkillLevel;
    row['OP-HAN'] = (op.role === 'Helper' ? clamp(primary + 1, 1, 4) : rand() < 0.5 ? 2 : 1) as SkillLevel;
    map[op.id] = row;
  }
  return map;
}

/**
 * Skill levels at the start of the current quarter (Q3, 1 Oct 2026). A deterministic ~40% of operators
 * are one level lower in one cell than today, i.e. they "moved up" this quarter.
 */
export function buildSkillBaseline(current: SkillMap): SkillMap {
  const base: SkillMap = {};
  for (const op of OPERATORS) {
    const row = { ...current[op.id] };
    const rand = mulberry32(hashString(`upgrade-${op.id}`));
    if (rand() < 0.4) {
      const preferred = op.machineId && row[op.machineId] > 0 ? op.machineId : Object.keys(row).find((k) => row[k] > 0);
      if (preferred) row[preferred] = (row[preferred] - 1) as SkillLevel;
    }
    base[op.id] = row;
  }
  return base;
}

export const QUARTER_LABEL = 'Q3 FY 2026-27 (since 1 Oct 2026)';
