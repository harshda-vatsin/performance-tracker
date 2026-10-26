import type { Employee, RoleKey } from '../types';

const DIRECTOR = 'Sundaram Natarajan (Director – Operations)';

const e = (
  n: number,
  name: string,
  role: Employee['role'],
  department: Employee['department'],
  plantId: Employee['plantId'],
  managerId: string | null,
  managerName: string,
  joined: string,
): Employee => ({
  id: `e${n}`,
  empCode: `MMF-${1000 + n}`,
  name,
  role,
  department,
  plantId,
  managerId,
  managerName,
  reviewerName: DIRECTOR,
  joined,
});

/** 15 senior staff across two plants. */
export const STAFF: Employee[] = [
  e(1, 'Rajagopal Iyer', 'Plant Head', 'Management', 'P1', null, 'Sundaram Natarajan (Director – Operations)', '2009-06-01'),
  e(2, 'Karthik Subramanian', 'Production Manager', 'Production', 'P1', 'e1', 'Rajagopal Iyer', '2013-02-11'),
  e(3, 'Lakshmi Narayanan', 'Quality Manager', 'Quality', 'P1', 'e1', 'Rajagopal Iyer', '2014-08-04'),
  e(4, 'Murugan Pillai', 'Maintenance Manager', 'Maintenance', 'P1', 'e1', 'Rajagopal Iyer', '2016-01-18'),
  e(5, 'Dhanapal Gounder', 'Die Shop Manager', 'Die Shop', 'P1', 'e1', 'Rajagopal Iyer', '2012-05-21'),
  e(6, 'Priya Ramesh', 'HR Manager', 'HR', 'P1', 'e1', 'Rajagopal Iyer', '2017-11-06'),
  e(7, 'Senthil Kumar', 'Production Manager', 'Production', 'P1', 'e1', 'Rajagopal Iyer', '2015-03-02'),
  e(8, 'Venkatesh Reddy', 'Plant Head', 'Management', 'P2', 'e1', 'Rajagopal Iyer', '2011-09-12'),
  e(9, 'Arun Prakash', 'Production Manager', 'Production', 'P2', 'e8', 'Venkatesh Reddy', '2014-04-14'),
  e(10, 'Meenakshi Sundaram', 'Quality Manager', 'Quality', 'P2', 'e8', 'Venkatesh Reddy', '2015-07-27'),
  e(11, 'Balasubramanian Naidu', 'Maintenance Manager', 'Maintenance', 'P2', 'e8', 'Venkatesh Reddy', '2013-10-09'),
  e(12, 'Gopinath Rao', 'Die Shop Manager', 'Die Shop', 'P2', 'e8', 'Venkatesh Reddy', '2012-12-03'),
  e(13, 'Kavitha Nair', 'HR Manager', 'HR', 'P2', 'e8', 'Venkatesh Reddy', '2018-02-19'),
  e(14, 'Vignesh Babu', 'Production Manager', 'Production', 'P3', 'e16', 'Muthuraman Pandian', '2019-06-24'),
  e(15, 'Ramya Krishnamurthy', 'Quality Manager', 'Quality', 'P3', 'e16', 'Muthuraman Pandian', '2026-09-01'),
  e(16, 'Muthuraman Pandian', 'Plant Head', 'Management', 'P3', 'e1', 'Rajagopal Iyer', '2012-03-19'),
];

export const STAFF_MAP: Record<string, Employee> = Object.fromEntries(STAFF.map((s) => [s.id, s]));

/** Staff who manage others — the "Reporting Manager" persona picker lists these. */
export const MANAGER_IDS = ['e1', 'e8', 'e16'];

/** The three plant heads (Trichy, Singampunari, Viralimalai) — each has their own direct reports. */
export const PLANT_HEAD_IDS = ['e1', 'e8', 'e16'];

export interface Persona {
  id: string;
  name: string;
  title: string;
  role: RoleKey;
}

export const FIXED_PERSONAS: Record<'hr' | 'management' | 'supervisor', Persona> = {
  hr: { id: 'hr1', name: 'Deepika Raghunathan', title: 'HR Admin · Corporate Office, Chennai', role: 'hr' },
  management: { id: 'mgmt1', name: 'Sundaram Natarajan', title: 'Director – Operations · Chennai', role: 'management' },
  supervisor: { id: 'sup1', name: 'Palaniappan Shanmugam', title: 'Shift Supervisor · Trichy', role: 'supervisor' },
};

/** Demo-only: hidden "true performance" factor per employee that drives the generated KPI actuals. */
export const PERF_FACTOR: Record<string, number> = {
  e1: 1.03, e2: 1.18, e3: 1.06, e4: 0.5, e5: 0.93, e6: 0.99, e7: 0.88, e8: 1.08,
  e9: 0.97, e10: 0.9, e11: 0.84, e12: 1.0, e13: 1.02, e14: 0.72, e15: 0.95, e16: 1.05,
};

/** Last three annual cycle scores (FY23-24, FY24-25, FY25-26). */
export const HISTORY_SCORES: Record<string, number[]> = {
  e1: [98, 100, 102],
  e2: [101, 107, 112],
  e3: [96, 103, 105],
  e4: [82, 72, 63],
  e5: [90, 93, 91],
  e6: [94, 96, 99],
  e7: [86, 85, 89],
  e8: [103, 104, 108],
  e9: [92, 95, 97],
  e10: [88, 91, 89],
  e11: [84, 86, 82],
  e12: [97, 98, 99],
  e13: [99, 100, 103],
  e14: [78, 75, 71],
  e15: [],
  e16: [95, 98, 100],
};
