import { ArrowDown, ArrowUp, Check, RefreshCw } from 'lucide-react';
import { RATING_BANDS, type RatingKey } from '../../config/scoring.config';
import { CYCLE } from '../../data/cycle';
import type { AppraisalStatus, Direction, Employee, GoalStatus, KpiSource, StageComment } from '../../types';
import { fmtDate, fmtDateTime } from '../../utils/format';
import { bandByKey, ratingFor } from '../../utils/scoring';
import { Chip, type Tone } from '../ui';

export function RatingChip({ score, ratingKey }: { score?: number; ratingKey?: RatingKey }) {
  const band = ratingKey ? bandByKey(ratingKey) : ratingFor(score ?? 0);
  return <Chip tone={band.tone}>{band.label}</Chip>;
}

export function ratingTone(key: RatingKey): Tone {
  return RATING_BANDS.find((b) => b.key === key)!.tone;
}

const STATUS_TONE: Record<AppraisalStatus, Tone> = {
  'Not started': 'slate',
  'Self-assessment': 'blue',
  'Manager assessment': 'amber',
  'Reviewer sign-off': 'accent',
  'HR finalisation': 'teal',
  Finalised: 'green',
};

export function StatusChip({ status }: { status: AppraisalStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{status}</Chip>;
}

export function GoalStatusChip({ status }: { status?: GoalStatus }) {
  if (!status) return <Chip tone="slate">Not assigned</Chip>;
  const tone: Tone = status === 'Acknowledged' ? 'green' : status === 'Draft' ? 'slate' : 'amber';
  return <Chip tone={tone}>{status}</Chip>;
}

export function DirectionTag({ direction }: { direction: Direction }) {
  const Icon = direction === 'higher' ? ArrowUp : ArrowDown;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs text-slate-500"
      title={direction === 'higher' ? 'Higher is better' : 'Lower is better'}
    >
      <Icon size={12} />
      {direction === 'higher' ? 'Higher' : 'Lower'}
    </span>
  );
}

export function SourceBadge({ source, lastSynced }: { source: KpiSource; lastSynced?: string }) {
  if (source === 'SAP') {
    return (
      <div className="leading-tight">
        <Chip tone="blue" title="Value is pulled automatically from SAP S/4HANA">
          <RefreshCw size={11} /> Synced from SAP S/4HANA
        </Chip>
        {lastSynced && <div className="mt-0.5 text-[11px] text-slate-400">Last synced {fmtDateTime(lastSynced)}</div>}
      </div>
    );
  }
  return <Chip tone="slate">Manual entry</Chip>;
}

/** Who the appraisal is waiting on, for the "pending with" indicator. */
export function pendingWith(
  status: AppraisalStatus,
  emp: Employee,
  goalStatus?: GoalStatus,
): { role: string; name: string } | null {
  switch (status) {
    case 'Not started':
      return goalStatus === 'Awaiting acknowledgement'
        ? { role: 'Employee', name: emp.name }
        : { role: 'Reporting Manager', name: emp.managerName };
    case 'Self-assessment':
      return { role: 'Employee', name: emp.name };
    case 'Manager assessment':
      return { role: 'Reporting Manager', name: emp.managerName };
    case 'Reviewer sign-off':
      return { role: 'Reviewer', name: emp.reviewerName.replace(/ \(.*\)/, '') };
    case 'HR finalisation':
      return { role: 'HR', name: 'Deepika Raghunathan' };
    default:
      return null;
  }
}

export function PendingWith({ status, emp, goalStatus }: { status: AppraisalStatus; emp: Employee; goalStatus?: GoalStatus }) {
  const p = pendingWith(status, emp, goalStatus);
  if (!p) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="leading-tight">
      <div className="text-xs font-medium text-slate-700">{p.role}</div>
      <div className="text-[11px] text-slate-500">{p.name}</div>
    </div>
  );
}

const STEPS: { label: string; status: AppraisalStatus }[] = [
  { label: 'Self-assessment', status: 'Self-assessment' },
  { label: 'Manager assessment', status: 'Manager assessment' },
  { label: 'Reviewer sign-off', status: 'Reviewer sign-off' },
  { label: 'HR finalisation', status: 'HR finalisation' },
];
const ORDER: AppraisalStatus[] = ['Not started', 'Self-assessment', 'Manager assessment', 'Reviewer sign-off', 'HR finalisation', 'Finalised'];

export function WorkflowStepper({ status }: { status: AppraisalStatus }) {
  const cur = ORDER.indexOf(status);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto py-1">
      {STEPS.map((s, i) => {
        const idx = ORDER.indexOf(s.status);
        const done = cur > idx;
        const active = cur === idx;
        return (
          <li key={s.label} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ${
                done
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : active
                    ? 'border-accent-300 bg-accent-50 text-accent-800'
                    : 'border-slate-200 bg-white text-slate-400'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  done ? 'bg-emerald-600 text-white' : active ? 'bg-accent-700 text-white' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {done ? <Check size={10} strokeWidth={3} /> : i + 1}
              </span>
              {s.label}
            </div>
            {i < STEPS.length - 1 && <span className={`h-px w-4 ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
          </li>
        );
      })}
      <li className="ml-1">
        <Chip tone={status === 'Finalised' ? 'green' : 'slate'}>{status === 'Finalised' ? 'Finalised & locked' : 'Not finalised'}</Chip>
      </li>
    </ol>
  );
}

const STAGE_LABEL: Record<StageComment['stage'], string> = {
  self: 'Self-assessment',
  manager: 'Manager assessment',
  reviewer: 'Reviewer sign-off',
  hr: 'HR finalisation',
  returned: 'Returned for re-assessment',
};
const STAGE_TONE: Record<StageComment['stage'], Tone> = {
  self: 'blue',
  manager: 'amber',
  reviewer: 'accent',
  hr: 'teal',
  returned: 'red',
};

export function CommentThread({ comments }: { comments: StageComment[] }) {
  if (comments.length === 0) return <p className="text-sm text-slate-500">No comments yet — the first one is added at self-assessment.</p>;
  return (
    <ul className="space-y-3">
      {comments.map((c, i) => (
        <li key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Chip tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}</Chip>
            <span className="font-medium text-slate-700">{c.author}</span>
            <span className="text-slate-400">· {fmtDateTime(c.at)}</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{c.text}</p>
        </li>
      ))}
    </ul>
  );
}

export function CycleTimeline() {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span className="font-medium text-slate-700">{CYCLE.label}</span>
        <span>{CYCLE.range}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {CYCLE.quarters.map((q) => (
          <div
            key={q.q}
            className={`rounded-md border px-2 py-1.5 text-center ${
              q.state === 'Completed'
                ? 'border-emerald-200 bg-emerald-50'
                : q.state === 'In review'
                  ? 'border-accent-300 bg-accent-50'
                  : 'border-slate-200 bg-white'
            }`}
          >
            <div className="text-xs font-semibold text-slate-800">{q.q}</div>
            <div className="text-[10px] text-slate-500">{q.months}</div>
            <div className={`mt-0.5 text-[10px] font-medium ${q.state === 'Upcoming' ? 'text-slate-400' : q.state === 'Completed' ? 'text-emerald-700' : 'text-accent-800'}`}>
              {q.state}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { fmtDate };
