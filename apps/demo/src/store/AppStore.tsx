import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ROLE_MAP } from '../config/roles';
import { WEIGHTAGE_TOTAL } from '../config/scoring.config';
import { buildGoalItems, buildInitialAppraisalData, genActuals } from '../data/appraisals';
import { CYCLE } from '../data/cycle';
import { buildSeedKras } from '../data/kras';
import { SEED_MONTHLY_INPUTS, SEED_SHIFT_RECORDS } from '../data/shiftData';
import { buildSkillMatrix } from '../data/skills';
import { STAFF_MAP } from '../data/staff';
import type {
  Appraisal,
  Employee,
  GoalSheet,
  HistoryEntry,
  Kra,
  MonthlyInput,
  PageKey,
  RoleKey,
  SeniorRole,
  ShiftRecord,
  SkillLevel,
  SkillMap,
  StageKey,
} from '../types';
import { MACHINE_MAP } from '../data/org';
import { OPERATORS } from '../data/operators';
import { buildScorecards } from '../utils/aggregate';
import type { Scorecard } from '../utils/operatorScoring';
import { incrementFor, ratingFor, scoreItems, sumWeights } from '../utils/scoring';

export interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'info' | 'error';
}

interface Store {
  // navigation / persona
  role: RoleKey;
  page: PageKey;
  setRole: (r: RoleKey) => void;
  setPage: (p: PageKey) => void;
  employeeId: string;
  setEmployeeId: (id: string) => void;
  managerId: string;
  setManagerId: (id: string) => void;
  /** Appraisal opened from a list (manager / HR / management views). */
  focusEmployeeId: string | null;
  setFocusEmployeeId: (id: string | null) => void;
  openAppraisal: (employeeId: string) => void;
  currentEmployee: Employee;

  // data
  kras: Kra[];
  goalSheets: GoalSheet[];
  appraisals: Appraisal[];
  history: HistoryEntry[];
  shiftRecords: ShiftRecord[];
  monthlyInputs: MonthlyInput[];
  skills: SkillMap;

  // KRA library
  saveRoleKras: (role: SeniorRole, list: Kra[]) => void;

  // goals
  assignGoals: (employeeId: string, actor: string) => void;
  updateGoalTarget: (employeeId: string, kraId: string, target: number) => void;
  sendGoalsForAck: (employeeId: string) => void;
  acknowledgeGoals: (employeeId: string, note: string) => void;
  reopenGoals: (employeeId: string) => void;

  // appraisal workflow
  setActual: (employeeId: string, kraId: string, value: number) => void;
  submitStage: (employeeId: string, stage: StageKey, text: string, actor: string) => void;
  returnToManager: (employeeId: string, text: string, actor: string) => void;
  scoreFor: (employeeId: string) => ReturnType<typeof scoreItems> & { rating: ReturnType<typeof ratingFor> };

  // floor
  addShiftRecord: (rec: Omit<ShiftRecord, 'id'>) => void;
  setSkill: (operatorId: string, columnId: string, level: SkillLevel) => void;

  // feedback
  toasts: Toast[];
  notify: (message: string, tone?: Toast['tone']) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore must be used inside AppStoreProvider');
  return s;
}

const now = () => '2026-10-22T' + new Date().toTimeString().slice(0, 5) + ':00';

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const seed = useMemo(() => {
    const kras = buildSeedKras();
    return { kras, ...buildInitialAppraisalData(kras) };
  }, []);

  const [role, setRoleState] = useState<RoleKey>('management');
  const [page, setPage] = useState<PageKey>('overview');
  const [employeeId, setEmployeeId] = useState('e2'); // Karthik — the strong performer
  const [managerId, setManagerId] = useState('e1');
  const [focusEmployeeId, setFocusEmployeeId] = useState<string | null>(null);

  const [kras, setKras] = useState<Kra[]>(seed.kras);
  const [goalSheets, setGoalSheets] = useState<GoalSheet[]>(seed.goalSheets);
  const [appraisals, setAppraisals] = useState<Appraisal[]>(seed.appraisals);
  const [history] = useState<HistoryEntry[]>(seed.history);
  const [shiftRecords, setShiftRecords] = useState<ShiftRecord[]>(SEED_SHIFT_RECORDS);
  const [monthlyInputs] = useState<MonthlyInput[]>(SEED_MONTHLY_INPUTS);
  const [skills, setSkills] = useState<SkillMap>(() => buildSkillMatrix());

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);
  const notify = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = toastId.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const setRole = useCallback((r: RoleKey) => {
    setRoleState(r);
    setPage(ROLE_MAP[r].home);
    setFocusEmployeeId(null);
  }, []);

  const openAppraisal = useCallback((id: string) => {
    setFocusEmployeeId(id);
    setPage('appraisals');
  }, []);

  // ---- KRA library --------------------------------------------------------
  const saveRoleKras = useCallback(
    (r: SeniorRole, list: Kra[]) => {
      if (Math.abs(sumWeights(list) - WEIGHTAGE_TOTAL) > 0.001) {
        notify(`Weightages for ${r} must total ${WEIGHTAGE_TOTAL}%.`, 'error');
        return;
      }
      setKras((prev) => [...prev.filter((k) => k.role !== r), ...list]);
      notify(`KRA library updated for ${r}. New goal sheets will use these KRAs.`);
    },
    [notify],
  );

  // ---- goals --------------------------------------------------------------
  const patchSheet = useCallback((employeeId: string, fn: (s: GoalSheet) => GoalSheet) => {
    setGoalSheets((prev) => prev.map((s) => (s.employeeId === employeeId ? fn(s) : s)));
  }, []);

  const assignGoals = useCallback(
    (employeeId: string, actor: string) => {
      const emp = STAFF_MAP[employeeId];
      const roleKras = kras.filter((k) => k.role === emp.role);
      if (Math.abs(sumWeights(roleKras) - WEIGHTAGE_TOTAL) > 0.001) {
        notify(`KRA weightages for ${emp.role} do not total ${WEIGHTAGE_TOTAL}%. Ask HR to fix the library first.`, 'error');
        return;
      }
      const sheet: GoalSheet = {
        employeeId,
        cycleId: CYCLE.id,
        status: 'Draft',
        items: buildGoalItems(emp.role, emp.plantId, kras),
        assignedBy: actor,
        assignedOn: '2026-10-22',
      };
      setGoalSheets((prev) => [...prev.filter((s) => s.employeeId !== employeeId), sheet]);
      notify(`KRAs for ${emp.role} assigned from the library. Review targets, then send for acknowledgement.`, 'info');
    },
    [kras, notify],
  );

  const updateGoalTarget = useCallback(
    (employeeId: string, kraId: string, target: number) =>
      patchSheet(employeeId, (s) => ({ ...s, items: s.items.map((i) => (i.kraId === kraId ? { ...i, target } : i)) })),
    [patchSheet],
  );

  const sendGoalsForAck = useCallback(
    (employeeId: string) => {
      patchSheet(employeeId, (s) => ({ ...s, status: 'Awaiting acknowledgement' }));
      notify(`Goal sheet sent to ${STAFF_MAP[employeeId].name} for acknowledgement.`);
    },
    [patchSheet, notify],
  );

  const acknowledgeGoals = useCallback(
    (employeeId: string, note: string) => {
      const sheet = goalSheets.find((s) => s.employeeId === employeeId);
      patchSheet(employeeId, (s) => ({ ...s, status: 'Acknowledged', acknowledgedOn: '2026-10-22', acknowledgementNote: note || undefined }));
      setAppraisals((prev) =>
        prev.map((a) =>
          a.employeeId === employeeId && a.status === 'Not started'
            ? { ...a, status: 'Self-assessment', actuals: sheet ? genActuals(employeeId, sheet.items) : a.actuals }
            : a,
        ),
      );
      notify('Goals acknowledged. The appraisal is now open for self-assessment.');
    },
    [goalSheets, patchSheet, notify],
  );

  const reopenGoals = useCallback(
    (employeeId: string) => {
      patchSheet(employeeId, (s) => ({ ...s, status: 'Draft', acknowledgedOn: undefined, acknowledgementNote: undefined }));
      notify('Goal sheet re-opened for revision.', 'info');
    },
    [patchSheet, notify],
  );

  // ---- appraisal workflow ---------------------------------------------------
  const setActual = useCallback((employeeId: string, kraId: string, value: number) => {
    setAppraisals((prev) =>
      prev.map((a) =>
        a.employeeId === employeeId && a.actuals[kraId]
          ? { ...a, actuals: { ...a.actuals, [kraId]: { ...a.actuals[kraId], value } } }
          : a,
      ),
    );
  }, []);

  const scoreFor = useCallback(
    (employeeId: string) => {
      const sheet = goalSheets.find((s) => s.employeeId === employeeId);
      const appraisal = appraisals.find((a) => a.employeeId === employeeId);
      const res = scoreItems(sheet?.items ?? [], appraisal?.actuals ?? {});
      return { ...res, rating: ratingFor(res.total) };
    },
    [goalSheets, appraisals],
  );

  const NEXT: Record<StageKey, Appraisal['status']> = {
    self: 'Manager assessment',
    manager: 'Reviewer sign-off',
    reviewer: 'HR finalisation',
    hr: 'Finalised',
  };

  const submitStage = useCallback(
    (employeeId: string, stage: StageKey, text: string, actor: string) => {
      const sheet = goalSheets.find((s) => s.employeeId === employeeId);
      setAppraisals((prev) =>
        prev.map((a) => {
          if (a.employeeId !== employeeId) return a;
          const next: Appraisal = {
            ...a,
            status: NEXT[stage],
            comments: [...a.comments, { stage, author: actor, at: now(), text }],
          };
          if (stage === 'hr') {
            const { total } = scoreItems(sheet?.items ?? [], a.actuals);
            const band = ratingFor(total);
            next.finalScore = total;
            next.finalRating = band.key;
            next.incrementPct = incrementFor(band.key);
          }
          return next;
        }),
      );
      const who = STAFF_MAP[employeeId].name;
      notify(
        stage === 'hr'
          ? `${who}'s appraisal is finalised and locked.`
          : `${who}'s appraisal moved to “${NEXT[stage]}”.`,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goalSheets, notify],
  );

  const returnToManager = useCallback(
    (employeeId: string, text: string, actor: string) => {
      setAppraisals((prev) =>
        prev.map((a) =>
          a.employeeId === employeeId
            ? { ...a, status: 'Manager assessment', comments: [...a.comments, { stage: 'returned', author: actor, at: now(), text }] }
            : a,
        ),
      );
      notify('Returned to the reporting manager for re-assessment.', 'info');
    },
    [notify],
  );

  // ---- floor --------------------------------------------------------------
  const addShiftRecord = useCallback(
    (rec: Omit<ShiftRecord, 'id'>) => {
      setShiftRecords((prev) => [...prev, { ...rec, id: `sh-live-${prev.length + 1}` }]);
      notify('Shift data saved. Operator scorecards have been updated.');
    },
    [notify],
  );

  const setSkill = useCallback((operatorId: string, columnId: string, level: SkillLevel) => {
    setSkills((prev) => ({ ...prev, [operatorId]: { ...prev[operatorId], [columnId]: level } }));
  }, []);

  const value: Store = {
    role,
    page,
    setRole,
    setPage,
    employeeId,
    setEmployeeId,
    managerId,
    setManagerId,
    focusEmployeeId,
    setFocusEmployeeId,
    openAppraisal,
    currentEmployee: STAFF_MAP[employeeId],
    kras,
    goalSheets,
    appraisals,
    history,
    shiftRecords,
    monthlyInputs,
    skills,
    saveRoleKras,
    assignGoals,
    updateGoalTarget,
    sendGoalsForAck,
    acknowledgeGoals,
    reopenGoals,
    setActual,
    submitStage,
    returnToManager,
    scoreFor,
    addShiftRecord,
    setSkill,
    toasts,
    notify,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** PQCDSM scorecards for all 40 operators for one month, recomputed whenever shift data changes. */
export function useScorecards(month: string): Scorecard[] {
  const { shiftRecords, monthlyInputs } = useStore();
  return useMemo(
    () => buildScorecards(month, shiftRecords, OPERATORS, monthlyInputs, MACHINE_MAP),
    [month, shiftRecords, monthlyInputs],
  );
}

export interface StaffRow {
  emp: Employee;
  appraisal: Appraisal;
  sheet?: GoalSheet;
  /** Finalised score if locked, otherwise the live score from current actuals. */
  score: number | null;
  rating: ReturnType<typeof ratingFor> | null;
  final: boolean;
}

/** One row per senior-staff member: appraisal, goal sheet, score and rating. */
export function useStaffRows(): StaffRow[] {
  const { appraisals, goalSheets } = useStore();
  return useMemo(
    () =>
      Object.values(STAFF_MAP).map((emp) => {
        const appraisal = appraisals.find((a) => a.employeeId === emp.id)!;
        const sheet = goalSheets.find((g) => g.employeeId === emp.id);
        const final = appraisal.status === 'Finalised' && appraisal.finalScore !== undefined;
        const score = sheet ? (final ? appraisal.finalScore! : scoreItems(sheet.items, appraisal.actuals).total) : null;
        return { emp, appraisal, sheet, score, rating: score === null ? null : ratingFor(score), final };
      }),
    [appraisals, goalSheets],
  );
}
