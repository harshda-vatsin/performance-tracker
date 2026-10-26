import type { Department, Kra, SeniorRole } from '../types';
import { KPI_MAP } from './kpiCatalog';

export const ROLE_DEPARTMENT: Record<SeniorRole, Department> = {
  'Plant Head': 'Management',
  'Production Manager': 'Production',
  'Quality Manager': 'Quality',
  'Maintenance Manager': 'Maintenance',
  'Die Shop Manager': 'Die Shop',
  'HR Manager': 'HR',
};

export const SENIOR_ROLES = Object.keys(ROLE_DEPARTMENT) as SeniorRole[];
export const DEPARTMENTS = Array.from(new Set(Object.values(ROLE_DEPARTMENT))) as Department[];

type Row = [area: string, kpiKey: string, weightage: number, target: number];

/**
 * Seed KRA library. Weightages for every role add up to 100.
 * Volume targets are for the Trichy plant; other plants are scaled by Plant.volumeScale.
 */
const SEED: Record<SeniorRole, Row[]> = {
  'Plant Head': [
    ['Production Volume', 'tonnage', 20, 1350],
    ['Equipment Effectiveness', 'oee', 15, 78],
    ['Material Yield', 'yield', 10, 88],
    ['Energy Cost', 'power', 10, 4200],
    ['Customer Delivery', 'otif', 15, 95],
    ['Customer Quality', 'ppm', 10, 250],
    ['Safety', 'ltifr', 10, 0.8],
    ['People Stability', 'attrition', 10, 8],
  ],
  'Production Manager': [
    ['Production Volume', 'tonnage', 25, 700],
    ['Equipment Effectiveness', 'oee', 20, 78],
    ['Material Yield', 'yield', 20, 88],
    ['Energy Cost', 'power', 10, 4200],
    ['In-process Quality', 'rejInt', 15, 2.0],
    ['Schedule Adherence', 'otif', 10, 95],
  ],
  'Quality Manager': [
    ['Internal Quality', 'rejInt', 30, 2.0],
    ['Customer Quality', 'ppm', 30, 250],
    ['Material Yield', 'yield', 15, 88],
    ['Capability Building', 'training', 15, 24],
    ['Safety', 'ltifr', 10, 0.8],
  ],
  'Maintenance Manager': [
    ['Equipment Reliability', 'mtbf', 25, 120],
    ['Equipment Recovery', 'mttr', 25, 2.5],
    ['Equipment Effectiveness', 'oee', 20, 78],
    ['Energy Efficiency', 'power', 10, 4200],
    ['Safety', 'ltifr', 10, 0.8],
    ['Capability Building', 'training', 10, 24],
  ],
  'Die Shop Manager': [
    ['Die Cost', 'dieCost', 30, 380],
    ['Die Life', 'dieLife', 30, 14000],
    ['Die-related Quality', 'rejInt', 15, 2.0],
    ['Die Readiness', 'otif', 10, 95],
    ['Safety', 'ltifr', 10, 0.8],
    ['Capability Building', 'training', 5, 24],
  ],
  'HR Manager': [
    ['People Stability', 'attrition', 30, 8],
    ['Capability Building', 'training', 25, 24],
    ['Safety Culture', 'ltifr', 15, 0.8],
    ['Talent Acquisition', 'timeToFill', 15, 35],
    ['Performance Management', 'apprComp', 15, 100],
  ],
};

export function buildSeedKras(): Kra[] {
  const out: Kra[] = [];
  (Object.keys(SEED) as SeniorRole[]).forEach((role, roleIdx) => {
    SEED[role].forEach(([area, kpiKey, weightage, target], i) => {
      const k = KPI_MAP[kpiKey];
      out.push({
        id: `kra-${roleIdx + 1}${String(i + 1).padStart(2, '0')}`,
        department: ROLE_DEPARTMENT[role],
        role,
        area,
        kpiKey,
        kpi: k.name,
        unit: k.unit,
        weightage,
        target,
        direction: k.direction,
        source: k.source,
      });
    });
  });
  return out;
}

/** KPIs whose target scales with plant size (so each plant gets a target sized to its presses). */
export const VOLUME_KPIS = new Set(['tonnage']);
