import type {
  Actual,
  Appraisal,
  AppraisalStatus,
  Employee,
  GoalItem,
  GoalSheet,
  HistoryEntry,
  Kra,
  SeniorRole,
  StageComment,
} from '../types';
import { clamp, hashString, mulberry32, normal } from '../utils/prng';
import { incrementFor, ratingFor, scoreItems } from '../utils/scoring';
import { CYCLE, HISTORY_CYCLES, SAP_LAST_SYNC } from './cycle';
import { KPI_MAP } from './kpiCatalog';
import { VOLUME_KPIS } from './kras';
import { plantById } from './org';
import { HISTORY_SCORES, PERF_FACTOR, STAFF, STAFF_MAP } from './staff';

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Instantiate a goal sheet's items from the KRA library for a role, scaling volume targets by plant. */
export function buildGoalItems(role: SeniorRole, plantId: Employee['plantId'], kras: Kra[]): GoalItem[] {
  const scale = plantById(plantId).volumeScale;
  return kras
    .filter((k) => k.role === role)
    .map((k) => ({
      kraId: k.id,
      area: k.area,
      kpiKey: k.kpiKey,
      kpi: k.kpi,
      unit: k.unit,
      direction: k.direction,
      source: k.source,
      weightage: k.weightage,
      target: VOLUME_KPIS.has(k.kpiKey) ? Math.round(k.target * scale) : k.target,
    }));
}

/** Generate YTD actuals that reflect the employee's hidden performance factor (demo story). */
export function genActuals(employeeId: string, items: GoalItem[]): Record<string, Actual> {
  const rand = mulberry32(hashString(`actuals-${employeeId}`));
  const f = PERF_FACTOR[employeeId] ?? 1;
  const sd = f < 0.75 ? 0.08 : 0.06;
  const out: Record<string, Actual> = {};
  for (const item of items) {
    const a = clamp(f + normal(rand, 0, sd), 0.25, 1.5);
    const raw = item.direction === 'higher' ? item.target * a : item.target / a;
    const decimals = KPI_MAP[item.kpiKey]?.decimals ?? 0;
    out[item.kraId] = {
      value: round(raw, decimals),
      source: item.source,
      lastSynced: item.source === 'SAP' ? SAP_LAST_SYNC : undefined,
    };
  }
  return out;
}

const STATUS: Record<string, AppraisalStatus> = {
  e1: 'Reviewer sign-off',
  e2: 'Self-assessment',
  e3: 'Manager assessment',
  e4: 'Manager assessment',
  e5: 'Finalised',
  e6: 'Finalised',
  e7: 'Finalised',
  e8: 'Reviewer sign-off',
  e9: 'Finalised',
  e10: 'HR finalisation',
  e11: 'HR finalisation',
  e12: 'Self-assessment',
  e13: 'Finalised',
  e14: 'Reviewer sign-off',
  e15: 'Not started',
  e16: 'Manager assessment',
};

const STAGE_ORDER: AppraisalStatus[] = [
  'Not started',
  'Self-assessment',
  'Manager assessment',
  'Reviewer sign-off',
  'HR finalisation',
  'Finalised',
];

const SELF_TEXT: Record<SeniorRole, string> = {
  'Plant Head':
    'Plant delivered the tonnage plan with OEE up on the heavy presses. Safety stand-down held after the near-miss at the hammer apron; power cost per tonne still needs work.',
  'Production Manager':
    'Monthly tonnage met on most months; OEE gains came from SMED on die changes and fewer unplanned stoppages. Billet-weight control at the shear remains a focus for yield.',
  'Quality Manager':
    'Internal rejection trended down after in-line MPI at the trimming station. Customer complaints closed with 8D inside 10 days; two repeat lap/fold defects still open.',
  'Maintenance Manager':
    'Preventive maintenance on clutch, brake and flywheel completed to schedule on most presses. Hammer anvil-cap failures and spares availability affected MTTR.',
  'Die Shop Manager':
    'Die life improved with the revised hardening cycle and better die lubrication; die cost per tonne is below last year. Die readiness for new-part trials was tight in September.',
  'HR Manager':
    'Statutory and skill training calendar delivered. Attrition among contract operators and time-to-fill for die setters are the main concerns this half.',
};

const MANAGER_TEXT = {
  strong:
    'Consistently ahead of plan on volume, yield and OEE. Takes ownership of line problems and mentors the shift engineers. Recommend a stretch role at the next review.',
  ok: 'Delivered to expectation on most KPIs. Power cost per tonne and schedule adherence need closer tracking in the second half.',
  below:
    'Several KPIs slipped below target in Q2. Agreed a focused action plan with monthly checkpoints on the weakest KRAs.',
  weak: 'Repeated press breakdowns, MTBF well below target and PM schedule slipped on both hammers. Discussed openly; a 90-day improvement plan is required.',
};

const REVIEWER_TEXT = {
  strong: 'Agree with the manager. Strong case for a top-band increment and a larger plant-level responsibility.',
  ok: 'Reviewed against SAP actuals; ratings are consistent. Concur with the manager’s assessment.',
  weak: 'Concur. Place on a 90-day performance improvement plan with fortnightly review by the Plant Head.',
};

const HR_TEXT = 'Calibrated across plants and finalised as per the increment guideline.';

const tier = (f: number) => (f >= 1.1 ? 'strong' : f < 0.75 ? 'weak' : f < 0.92 ? 'below' : 'ok');

function buildComments(emp: Employee, status: AppraisalStatus): StageComment[] {
  const idx = STAGE_ORDER.indexOf(status);
  const t = tier(PERF_FACTOR[emp.id] ?? 1);
  const out: StageComment[] = [];
  if (idx >= 2)
    out.push({ stage: 'self', author: emp.name, at: '2026-10-06T10:30:00', text: SELF_TEXT[emp.role] });
  if (idx >= 3)
    out.push({
      stage: 'manager',
      author: emp.managerName.replace(/ \(.*\)/, ''),
      at: '2026-10-12T16:10:00',
      text: MANAGER_TEXT[t],
    });
  if (idx >= 4)
    out.push({
      stage: 'reviewer',
      author: 'Sundaram Natarajan',
      at: '2026-10-16T11:45:00',
      text: REVIEWER_TEXT[t === 'strong' ? 'strong' : t === 'weak' ? 'weak' : 'ok'],
    });
  if (idx >= 5)
    out.push({ stage: 'hr', author: 'Deepika Raghunathan', at: '2026-10-20T15:20:00', text: HR_TEXT });
  return out;
}

export interface AppraisalSeed {
  goalSheets: GoalSheet[];
  appraisals: Appraisal[];
  history: HistoryEntry[];
}

export function buildInitialAppraisalData(kras: Kra[]): AppraisalSeed {
  const goalSheets: GoalSheet[] = [];
  const appraisals: Appraisal[] = [];
  const history: HistoryEntry[] = [];

  for (const emp of STAFF) {
    const status = STATUS[emp.id];

    if (emp.id !== 'e15') {
      goalSheets.push({
        employeeId: emp.id,
        cycleId: CYCLE.id,
        status: 'Acknowledged',
        items: buildGoalItems(emp.role, emp.plantId, kras),
        assignedBy: emp.managerName.replace(/ \(.*\)/, ''),
        assignedOn: '2026-04-08',
        acknowledgedOn: '2026-04-11',
      });
    }

    const items = goalSheets.find((g) => g.employeeId === emp.id)?.items ?? [];
    const actuals = emp.id === 'e15' ? {} : genActuals(emp.id, items);
    const appraisal: Appraisal = {
      employeeId: emp.id,
      cycleId: CYCLE.id,
      period: CYCLE.currentPeriod,
      status,
      actuals,
      comments: buildComments(emp, status),
    };
    if (status === 'Finalised') {
      const { total } = scoreItems(items, actuals);
      const band = ratingFor(total);
      appraisal.finalScore = total;
      appraisal.finalRating = band.key;
      appraisal.incrementPct = incrementFor(band.key);
    }
    appraisals.push(appraisal);

    (HISTORY_SCORES[emp.id] ?? []).forEach((score, i) => {
      history.push({ employeeId: emp.id, cycle: HISTORY_CYCLES[i], score, rating: ratingFor(score).key });
    });
  }
  return { goalSheets, appraisals, history };
}

export const employeeName = (id: string) => STAFF_MAP[id]?.name ?? id;
