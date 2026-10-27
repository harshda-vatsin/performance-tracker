import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth, useMe } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Loading, PageHeader, StateChip } from '../components/ui';
import { get } from '../lib/api';
import { monthLabel } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { navFor, ROLE_LABELS, scopeLabel } from '../lib/nav';
import type { ReopenRequest, SubmissionRow, TemplateRow } from '../lib/types';
import { nextStep, STEP_LABEL, STEP_PERMISSION, useWorkflowSettings } from '../lib/workflow';

/** Months waiting for the person: data entry for Plant HR, and whichever review step is next under the current settings. */
function actionsFor(state: string, can: (perm: string) => boolean, settings: ReturnType<typeof useWorkflowSettings>): { verb: string }[] {
  if (['DRAFT', 'REOPENED', 'REJECTED'].includes(state)) return can('submissions:enter') ? [{ verb: 'Enter data / resubmit' }] : [];
  const next = nextStep(state, settings);
  return next && can(STEP_PERMISSION[next]) ? [{ verb: STEP_LABEL[next] }] : [];
}

export function HomePage() {
  const me = useMe();
  const { can } = useAuth();
  const settings = useWorkflowSettings();
  const links = navFor(me).filter((n) => n.to !== '/');

  const subs = useAsync(() => (can('submissions:read') ? get<{ submissions: SubmissionRow[] }>('/submissions') : Promise.resolve({ submissions: [] })), []);
  const reopen = useAsync(
    () => (can('reopen:approve') ? get<{ requests: ReopenRequest[] }>('/reopen-requests?state=PENDING') : Promise.resolve({ requests: [] })),
    [],
  );
  const drafts = useAsync(
    () => (can('templates:approve') ? get<{ templates: TemplateRow[] }>('/templates?status=DRAFT') : Promise.resolve({ templates: [] })),
    [],
  );

  const mine = (subs.data?.submissions ?? [])
    .map((s) => ({ s, acts: actionsFor(s.state, can, settings) }))
    .filter((x) => x.acts.length > 0);

  const pendingReopen = reopen.data?.requests ?? [];
  const pendingTemplates = drafts.data?.templates ?? [];
  const nothingPending = mine.length === 0 && pendingReopen.length === 0 && pendingTemplates.length === 0;

  return (
    <>
      <PageHeader title={`Welcome, ${me.user.fullName.replace(/\s*\(.*\)\s*$/, '')}`} subtitle="What you can see and do follows your role and its scope." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Your access" className="lg:col-span-1">
          <ul className="space-y-2.5">
            {me.roles.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-slate-800">{ROLE_LABELS[r.code] ?? r.code}</span>
                <Chip tone="slate">{scopeLabel(r)}</Chip>
              </li>
            ))}
          </ul>
          {links.length === 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Your role is signed in but has no portal screens in this release.
            </p>
          )}
        </Card>

        <Card title="Waiting on you" subtitle="Months, requests and templates that need your action" className="lg:col-span-2" pad={false}>
          {subs.loading && !subs.data ? (
            <Loading />
          ) : subs.error ? (
            <div className="p-4">
              <ErrorBox onRetry={subs.reload}>{subs.error}</ErrorBox>
            </div>
          ) : nothingPending ? (
            <Empty title="Nothing is waiting on you" hint={links.length ? 'New work from your plants will appear here.' : 'There is nothing for your role to act on yet.'} />
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="waiting-list">
              {mine.map(({ s, acts }) => (
                <li key={s.id}>
                  <Link to={`/submissions/${s.id}`} className="tr-hover flex items-center justify-between gap-3 px-4 py-3 md:px-5">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        {s.unitCode} · {monthLabel(s.period)}
                      </div>
                      <div className="muted">{acts.map((a) => a.verb).join(' / ')}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StateChip state={s.state} />
                      <ArrowRight size={14} className="text-slate-400" />
                    </div>
                  </Link>
                </li>
              ))}
              {pendingReopen.map((r) => (
                <li key={r.id}>
                  <Link to="/reopen" className="tr-hover flex items-center justify-between gap-3 px-4 py-3 md:px-5">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        Reopen request · {r.unitCode} · {monthLabel(r.period)}
                      </div>
                      <div className="muted">{r.reason}</div>
                    </div>
                    <Chip tone="amber">Pending</Chip>
                  </Link>
                </li>
              ))}
              {pendingTemplates.map((t) => (
                <li key={t.id}>
                  <Link to={`/templates/${t.id}`} className="tr-hover flex items-center justify-between gap-3 px-4 py-3 md:px-5">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        Template to approve · {t.name} v{t.version}
                      </div>
                      <div className="muted">
                        {t.plantTypeCode} · {t.kraCount} KRAs
                      </div>
                    </div>
                    <StateChip state="DRAFT" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {links.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {links.map((n) => (
            <Link key={n.to} to={n.to} className="card tr-hover flex items-center gap-3 p-4">
              <n.icon size={18} className="text-accent-700" />
              <span className="text-sm font-medium text-slate-800">{n.label}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
