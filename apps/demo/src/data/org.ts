import type { Line, Machine, Plant, PlantId } from '../types';

/** Corporate office (shown in the shell and on HR / management personas). */
export const CORPORATE_OFFICE = 'Chennai';

export const PLANTS: Plant[] = [
  { id: 'P1', name: 'Trichy Plant', city: 'Trichy', volumeScale: 1 },
  { id: 'P2', name: 'Singampunari Plant', city: 'Singampunari', volumeScale: 0.85 },
  { id: 'P3', name: 'Viralimalai Plant', city: 'Viralimalai', volumeScale: 0.2 },
];

export const LINES: Line[] = [
  { id: 'L1', plantId: 'P1', name: 'Line 1 · Crankshafts', products: ['Crankshafts'] },
  { id: 'L2', plantId: 'P1', name: 'Line 2 · Connecting Rods', products: ['Connecting rods'] },
  { id: 'L3', plantId: 'P2', name: 'Line 3 · Axle Beams & Knuckles', products: ['Front axle beams', 'Steering knuckles'] },
  { id: 'L4', plantId: 'P3', name: 'Line 4 · UJ Crosses & Steering Arms', products: ['Universal joint crosses', 'Steering arms'] },
];

const ABC = ['A', 'B', 'C'] as const;
const AB = ['A', 'B'] as const;

export const MACHINES: Machine[] = [
  { id: 'M01', lineId: 'L1', plantId: 'P1', name: '2500 T Mechanical Press', type: 'press', tonnage: 2500, products: ['Crankshafts'], shifts: [...ABC], plannedQty: 420, pieceWeightKg: 38, scrapAllowancePct: 9, standardDieLife: 18000 },
  { id: 'M02', lineId: 'L1', plantId: 'P1', name: 'Trimming Press TP-1 (1600 T)', type: 'trimmer', tonnage: 1600, products: ['Crankshafts'], shifts: [...ABC], plannedQty: 420, pieceWeightKg: 36, scrapAllowancePct: 2, standardDieLife: 40000 },
  { id: 'M03', lineId: 'L2', plantId: 'P1', name: '6 T Forging Hammer', type: 'hammer', products: ['Connecting rods'], shifts: [...AB], plannedQty: 620, pieceWeightKg: 4.2, scrapAllowancePct: 11, standardDieLife: 9000 },
  { id: 'M04', lineId: 'L2', plantId: 'P1', name: '1600 T Mechanical Press', type: 'press', tonnage: 1600, products: ['Connecting rods'], shifts: [...AB], plannedQty: 800, pieceWeightKg: 5.4, scrapAllowancePct: 8, standardDieLife: 22000 },
  { id: 'M05', lineId: 'L3', plantId: 'P2', name: '8000 T Mechanical Press', type: 'press', tonnage: 8000, products: ['Front axle beams', 'Steering knuckles'], shifts: [...ABC], plannedQty: 240, pieceWeightKg: 70, scrapAllowancePct: 9, standardDieLife: 11000 },
  { id: 'M06', lineId: 'L3', plantId: 'P2', name: 'Trimming Press TP-2 (2500 T)', type: 'trimmer', tonnage: 2500, products: ['Front axle beams', 'Steering knuckles'], shifts: [...ABC], plannedQty: 240, pieceWeightKg: 66, scrapAllowancePct: 2, standardDieLife: 30000 },
  { id: 'M07', lineId: 'L4', plantId: 'P3', name: '3150 T Hydraulic Press', type: 'press', tonnage: 3150, products: ['Steering arms'], shifts: [...AB], plannedQty: 600, pieceWeightKg: 6, scrapAllowancePct: 9, standardDieLife: 15000 },
  { id: 'M08', lineId: 'L4', plantId: 'P3', name: '4 T Forging Hammer', type: 'hammer', products: ['Universal joint crosses'], shifts: [...AB], plannedQty: 1400, pieceWeightKg: 1.8, scrapAllowancePct: 11, standardDieLife: 8000 },
  { id: 'M09', lineId: 'L1', plantId: 'P1', name: 'Induction Furnace IF-1 (1200 kW)', type: 'furnace', products: ['Crankshafts', 'Connecting rods'], shifts: [...ABC], plannedQty: 1300, pieceWeightKg: 20, scrapAllowancePct: 1.5, standardDieLife: null },
  { id: 'M10', lineId: 'L3', plantId: 'P2', name: 'Induction Furnace IF-2 (1500 kW)', type: 'furnace', products: ['Front axle beams', 'Steering knuckles'], shifts: [...ABC], plannedQty: 700, pieceWeightKg: 35, scrapAllowancePct: 1.5, standardDieLife: null },
  { id: 'M11', lineId: 'L4', plantId: 'P3', name: 'Induction Furnace IF-3 (800 kW)', type: 'furnace', products: ['Universal joint crosses', 'Steering arms'], shifts: [...AB], plannedQty: 1600, pieceWeightKg: 4, scrapAllowancePct: 1.5, standardDieLife: null },
];

export const plantById = (id: PlantId) => PLANTS.find((p) => p.id === id)!;
/** Short plant label used everywhere in the UI: "Trichy", "Singampunari", "Viralimalai". */
export const plantCity = (id: PlantId) => plantById(id).city;
export const lineById = (id: string) => LINES.find((l) => l.id === id)!;
export const machineById = (id: string) => MACHINES.find((m) => m.id === id)!;
export const MACHINE_MAP: Record<string, Machine> = Object.fromEntries(MACHINES.map((m) => [m.id, m]));
