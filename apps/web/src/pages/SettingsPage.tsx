import { useState } from 'react';
import { Card, Chip, ErrorBox, Loading, Notice, PageHeader, useToast } from '../components/ui';
import { get, put } from '../lib/api';
import { useAction, useAsync } from '../lib/hooks';
import type { WorkflowSettings } from '../lib/workflow';

/** Corporate HR chooses which optional approval steps are in use. Nothing is removed: a switched-off step is skipped. */
export function SettingsPage() {
  const toast = useToast();
  const res = useAsync(() => get<WorkflowSettings>('/settings/workflow'), []);
  const [saved, setSaved] = useState<WorkflowSettings>();
  const { busy, error, run } = useAction();
  const s = saved ?? res.data;

  async function change(patch: { monthly?: Partial<WorkflowSettings['monthly']>; senior?: Partial<WorkflowSettings['senior']> }, what: string) {
    const next = await run(() => put<WorkflowSettings>('/settings/workflow', patch));
    if (next) {
      setSaved(next);
      toast(what);
    }
  }

  if (res.loading && !res.data) return <Loading />;
  if (res.error || !s) return <ErrorBox onRetry={res.reload}>{res.error ?? 'Could not load the settings.'}</ErrorBox>;

  return (
    <>
      <PageHeader title="Approval steps" subtitle="Choose which optional steps your organisation uses. Every step stays in the system; a step that is switched off is simply skipped." />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="space-y-4">
        <Card title="Monthly shop-floor scorecards" subtitle="Plant HR enters and submits the month, then Corporate HR locks it. These two steps are always on.">
          <ul className="space-y-3">
            <Toggle
              id="step-hod-verify"
              label="HOD verifies the month before it goes on"
              hint="The HOD of the unit checks the submitted figures."
              checked={s.monthly.hodVerify}
              disabled={busy}
              onChange={(v) => void change({ monthly: { hodVerify: v } }, `HOD verification ${v ? 'switched on' : 'switched off'}`)}
            />
            <Toggle
              id="step-plant-head-approve"
              label="Plant Head approves before Corporate HR locks"
              hint="Adds an approval by the Plant Head, and the plant-month Approve all action."
              checked={s.monthly.plantHeadApprove}
              disabled={busy}
              onChange={(v) => void change({ monthly: { plantHeadApprove: v } }, `Plant Head approval ${v ? 'switched on' : 'switched off'}`)}
            />
          </ul>
          <p className="mt-3 text-sm text-slate-600" data-testid="monthly-chain">
            Current chain: <b>Plant HR submits</b>
            {s.monthly.hodVerify && <> → <b>HOD verifies</b></>}
            {s.monthly.plantHeadApprove && <> → <b>Plant Head approves</b></>} → <b>Corporate HR locks</b>
          </p>
        </Card>

        <Card title="Senior-staff monthly results" subtitle="The manager enters each month's results and confirms them. There is no separate approval step.">
          <Chip tone="green">Fixed</Chip>
        </Card>

        <Card title="Senior-staff appraisal" subtitle="The employee writes a self-assessment, the manager assesses, and Corporate HR finalises.">
          <ul className="space-y-3">
            <Toggle
              id="step-reviewer"
              label="A reviewer signs off between the manager and Corporate HR"
              hint="When on, every appraisal needs a reviewer assigned (HOD, Plant Head or Management)."
              checked={s.senior.reviewerStep}
              disabled={busy}
              onChange={(v) => void change({ senior: { reviewerStep: v } }, `Reviewer step ${v ? 'switched on' : 'switched off'}`)}
            />
          </ul>
        </Card>

        <Notice tone="blue">
          Two people are always required, whatever is set here: a template's author cannot activate it, a scorecard target change needs a different approver, a reopen request is decided by someone other than the requester, and a bonus batch is approved by someone other than the person who calculated it.
        </Notice>
      </div>
    </>
  );
}

function Toggle({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <li className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-1 h-4 w-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-slate-900">{label}</span>
        <span className="block text-slate-500">{hint}</span>
      </label>
    </li>
  );
}
