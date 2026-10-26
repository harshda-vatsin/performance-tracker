import type { EmploymentType, Operator, OperatorRole, PlantId, Shift } from '../types';

type Row = [
  name: string,
  role: OperatorRole,
  employment: EmploymentType,
  plantId: PlantId,
  machineId: string | undefined,
  shift: Shift,
  tenureYears: number,
];

// Machine operators are rostered to one machine + shift; die setters, helpers and
// inspectors are rostered to a plant + shift and work alongside the machine crew.
const ROWS: Row[] = [
  // Hammer operators
  ['Muthukrishnan Selvam', 'Hammer Operator', 'Permanent', 'P1', 'M03', 'A', 11],
  ['Pandian Rajendran', 'Hammer Operator', 'Contract', 'P1', 'M03', 'B', 7],
  ['Anbazhagan Chinnasamy', 'Hammer Operator', 'Permanent', 'P3', 'M08', 'A', 9],
  ['Vijayakumar Naidu', 'Hammer Operator', 'Contract', 'P3', 'M08', 'B', 4],
  // Press operators
  ['Arumugam Selvaraj', 'Press Operator', 'Permanent', 'P1', 'M01', 'A', 15],
  ['Karuppasamy Murugesan', 'Press Operator', 'Contract', 'P1', 'M01', 'B', 8],
  ['Ramesh Babu Chelladurai', 'Press Operator', 'Contract', 'P1', 'M01', 'C', 2],
  ['Sathish Kumar Nadar', 'Press Operator', 'Contract', 'P1', 'M04', 'A', 6],
  ['Manikandan Ramaswamy', 'Press Operator', 'Trainee', 'P1', 'M04', 'B', 1],
  ['Thirumalai Vasan', 'Press Operator', 'Permanent', 'P2', 'M05', 'A', 12],
  ['Balaji Sundarrajan', 'Press Operator', 'Contract', 'P2', 'M05', 'B', 7],
  ['Palanisamy Gounder', 'Press Operator', 'Contract', 'P2', 'M05', 'C', 3],
  ['Prakash Raj Subbiah', 'Press Operator', 'Contract', 'P3', 'M07', 'A', 10],
  ['Gowtham Ilango', 'Press Operator', 'Trainee', 'P3', 'M07', 'B', 1],
  // Trimmers
  ['Saravanan Perumal', 'Trimmer', 'Permanent', 'P1', 'M02', 'A', 9],
  ['Dinesh Kannan', 'Trimmer', 'Contract', 'P1', 'M02', 'B', 5],
  ['Ganesan Ayyanar', 'Trimmer', 'Contract', 'P1', 'M02', 'C', 3],
  ['Lokesh Reddy', 'Trimmer', 'Contract', 'P2', 'M06', 'A', 8],
  ['Yuvaraj Thangavel', 'Trimmer', 'Contract', 'P2', 'M06', 'B', 2],
  ['Hari Prasad Chandran', 'Trimmer', 'Trainee', 'P2', 'M06', 'C', 1],
  // Furnace operators
  ['Venkatachalam Raju', 'Furnace Operator', 'Permanent', 'P1', 'M09', 'A', 13],
  ['Sivakumar Pillai', 'Furnace Operator', 'Contract', 'P1', 'M09', 'B', 6],
  ['Nagarajan Doraisamy', 'Furnace Operator', 'Contract', 'P1', 'M09', 'C', 4],
  ['Jayaraman Mudaliar', 'Furnace Operator', 'Permanent', 'P2', 'M10', 'A', 10],
  ['Elumalai Govindan', 'Furnace Operator', 'Contract', 'P2', 'M10', 'B', 3],
  ['Kumaresan Velu', 'Furnace Operator', 'Contract', 'P2', 'M10', 'C', 5],
  ['Ramu Subramani', 'Furnace Operator', 'Contract', 'P3', 'M11', 'A', 6],
  ['Gunasekaran Mani', 'Furnace Operator', 'Contract', 'P3', 'M11', 'B', 4],
  // Die setters
  ['Raghavendra Rao', 'Die Setter', 'Permanent', 'P1', undefined, 'A', 14],
  ['Chandrasekar Iyer', 'Die Setter', 'Contract', 'P1', undefined, 'B', 9],
  ['Sundar Rajan', 'Die Setter', 'Contract', 'P1', undefined, 'C', 4],
  ['Mohan Das Pillai', 'Die Setter', 'Permanent', 'P2', undefined, 'A', 11],
  ['Ashok Kumar Reddy', 'Die Setter', 'Contract', 'P2', undefined, 'B', 8],
  ['Vinoth Kanagaraj', 'Die Setter', 'Contract', 'P2', undefined, 'C', 3],
  ['Manoharan Pandi', 'Die Setter', 'Contract', 'P3', undefined, 'A', 7],
  ['Dhanasekaran Alagu', 'Die Setter', 'Contract', 'P3', undefined, 'B', 5],
  // Helpers
  ['Murali Krishnan', 'Helper', 'Contract', 'P1', undefined, 'A', 6],
  ['Selvakumar Dhanraj', 'Helper', 'Trainee', 'P1', undefined, 'B', 1],
  ['Ajith Kumar', 'Helper', 'Contract', 'P2', undefined, 'A', 2],
  ['Pradeep Menon', 'Helper', 'Contract', 'P2', undefined, 'B', 1],
  ['Karthikeyan Rajan', 'Helper', 'Contract', 'P3', undefined, 'A', 3],
  // Inspectors
  ['Revathi Natarajan', 'Inspector', 'Permanent', 'P1', undefined, 'A', 8],
  ['Anitha Chandramouli', 'Inspector', 'Contract', 'P1', undefined, 'B', 6],
  ['Lavanya Sekar', 'Inspector', 'Contract', 'P2', undefined, 'A', 3],
  ['Kalaiselvi Murugan', 'Inspector', 'Contract', 'P2', undefined, 'B', 7],
  ['Meera Sundaresan', 'Inspector', 'Contract', 'P3', undefined, 'A', 4],
];

export const OPERATORS: Operator[] = ROWS.map(([name, role, employment, plantId, machineId, shift, tenureYears], i) => ({
  id: `op${String(i + 1).padStart(2, '0')}`,
  empCode: `MMF-F${2000 + i + 1}`,
  name,
  role,
  employment,
  plantId,
  machineId,
  shift,
  tenureYears,
}));

export const OPERATOR_MAP: Record<string, Operator> = Object.fromEntries(OPERATORS.map((o) => [o.id, o]));

export const OPERATOR_ROLES: OperatorRole[] = [
  'Hammer Operator',
  'Press Operator',
  'Die Setter',
  'Furnace Operator',
  'Trimmer',
  'Helper',
  'Inspector',
];

export const EMPLOYMENT_TYPES: EmploymentType[] = ['Permanent', 'Contract', 'Trainee'];

/** Story operators: one clearly strong, one clearly weak. */
export const STAR_OPERATOR_ID = 'op05'; // Arumugam Selvaraj — 2500 T press, Trichy, Shift A
export const WEAK_OPERATOR_ID = 'op07'; // Ramesh Babu Chelladurai — 2500 T press, Trichy, Shift C

/** Demo-only hidden skill factor (1.0 = average). Drives the generated shift data. */
export function skillFactor(op: Operator): number {
  if (op.id === STAR_OPERATOR_ID) return 1.13;
  if (op.id === WEAK_OPERATOR_ID) return 0.76;
  const base = op.employment === 'Permanent' ? 1.0 : op.employment === 'Contract' ? 0.96 : 0.9;
  // small stable per-person spread
  const n = parseInt(op.id.slice(2), 10);
  const spread = (((n * 37) % 11) - 5) * 0.008;
  return base + spread + Math.min(op.tenureYears, 12) * 0.002;
}
