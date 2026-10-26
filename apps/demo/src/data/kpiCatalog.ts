import type { KpiDef } from '../types';

/**
 * KPI catalogue. `source: 'SAP'` KPIs are shown with a "Synced from SAP S/4HANA" badge;
 * `source: 'Manual'` KPIs get an editable entry field during the appraisal.
 */
export const KPI_CATALOG: KpiDef[] = [
  { key: 'tonnage', name: 'Forged tonnage output', unit: 't / month', direction: 'higher', source: 'SAP', sapModule: 'PP', decimals: 0 },
  { key: 'oee', name: 'OEE', unit: '%', direction: 'higher', source: 'SAP', sapModule: 'PM', decimals: 1 },
  { key: 'yield', name: 'Forging yield', unit: '%', direction: 'higher', source: 'SAP', sapModule: 'PP', decimals: 1 },
  { key: 'power', name: 'Power cost per tonne', unit: '₹ / t', direction: 'lower', source: 'SAP', sapModule: 'CO', decimals: 0 },
  { key: 'rejInt', name: 'Internal rejection', unit: '%', direction: 'lower', source: 'SAP', sapModule: 'QM', decimals: 2 },
  { key: 'ppm', name: 'Customer PPM', unit: 'ppm', direction: 'lower', source: 'Manual', decimals: 0 },
  { key: 'otif', name: 'OTIF delivery', unit: '%', direction: 'higher', source: 'SAP', sapModule: 'SD', decimals: 1 },
  { key: 'dieCost', name: 'Die cost per tonne', unit: '₹ / t', direction: 'lower', source: 'SAP', sapModule: 'CO', decimals: 0 },
  { key: 'dieLife', name: 'Die life', unit: 'strokes', direction: 'higher', source: 'Manual', decimals: 0 },
  { key: 'mtbf', name: 'MTBF', unit: 'hrs', direction: 'higher', source: 'SAP', sapModule: 'PM', decimals: 0 },
  { key: 'mttr', name: 'MTTR', unit: 'hrs', direction: 'lower', source: 'SAP', sapModule: 'PM', decimals: 1 },
  { key: 'ltifr', name: 'LTIFR', unit: 'per mn man-hrs', direction: 'lower', source: 'Manual', decimals: 2 },
  { key: 'training', name: 'Training hours', unit: 'hrs / person', direction: 'higher', source: 'Manual', decimals: 0 },
  { key: 'attrition', name: 'Attrition', unit: '% p.a.', direction: 'lower', source: 'Manual', decimals: 1 },
  { key: 'timeToFill', name: 'Time to fill vacancy', unit: 'days', direction: 'lower', source: 'Manual', decimals: 0 },
  { key: 'apprComp', name: 'Appraisal completion', unit: '%', direction: 'higher', source: 'Manual', decimals: 0 },
];

export const KPI_MAP: Record<string, KpiDef> = Object.fromEntries(KPI_CATALOG.map((k) => [k.key, k]));
