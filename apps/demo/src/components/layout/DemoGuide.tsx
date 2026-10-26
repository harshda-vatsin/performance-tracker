import { useStore } from '../../store/AppStore';
import type { RoleKey } from '../../types';
import { Modal } from '../ui';

const STEPS: { role: RoleKey; title: string; text: string; personId?: string }[] = [
  {
    role: 'management',
    title: 'Start with the Plant Head overview',
    text: 'Plant KPIs, appraisal completion and the PQCDSM summary for both plants. Note the stoppage list — those are the "bad days".',
  },
  {
    role: 'employee',
    title: 'Strong performer: Karthik Subramanian',
    text: 'Production Manager, Outstanding. Open Appraisals, see SAP-synced vs manual KPIs, edit a manual KPI and watch the score move, then submit the self-assessment.',
    personId: 'e2',
  },
  {
    role: 'manager',
    title: 'Manager review: Rajagopal Iyer’s team',
    text: 'Team table with score, rating and status. Murugan Pillai (Maintenance Manager) is the weak performer — open the appraisal and add a manager assessment.',
  },
  {
    role: 'hr',
    title: 'HR Admin: library, distribution, export',
    text: 'Edit a KRA weightage (the 100% rule is enforced), view the rating distribution by department, then export the increment sheet to Excel.',
  },
  {
    role: 'supervisor',
    title: 'Shift supervisor: enter a shift',
    text: 'Pick a machine, log a breakdown as "not operator fault" and watch the live productivity preview exclude it. Then open Operator Scorecards.',
  },
];

export function DemoGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setRole, setEmployeeId } = useStore();
  return (
    <Modal open={open} title="Demo walkthrough" onClose={onClose} wide>
      <p className="mb-4 text-sm text-slate-600">
        All data is sample data held in memory — refresh the page to reset. Use <b>View as</b> in the top bar to switch role at any time.
      </p>
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-lg border border-slate-200 p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-700 text-xs font-semibold text-white">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">{s.title}</div>
              <p className="mt-0.5 text-sm text-slate-600">{s.text}</p>
            </div>
            <button
              className="btn btn-secondary self-start"
              onClick={() => {
                if (s.personId) setEmployeeId(s.personId);
                setRole(s.role);
                onClose();
              }}
            >
              Go
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <b>Factory floor story:</b> Arumugam Selvaraj (2500 T press, Trichy, Shift A, permanent) is the standout operator; Ramesh Babu Chelladurai
        (2500 T press, Trichy, Shift C, contract) is clearly struggling on quality, safety and attendance.
      </div>
    </Modal>
  );
}
