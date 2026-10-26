import { useState } from 'react';
import { Card, Chip, Empty, ErrorBox, Field, Loading, PageHeader, TableWrap } from '../components/ui';
import { get } from '../lib/api';
import { fmtDateTime, humanize } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';

interface AuditEvent {
  id: number;
  at: string;
  action: string;
  category: 'system' | 'business';
  actorLoginId: string | null;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}
interface AuditPage {
  categories: ('system' | 'business')[];
  events: AuditEvent[];
  nextBefore: number | null;
}
interface Filters {
  category: '' | 'system' | 'business';
  action: string;
  actor: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { category: '', action: '', actor: '', from: '', to: '' };

function query(f: Filters, before?: number): string {
  const p = new URLSearchParams({ limit: '50' });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v.trim());
  if (before) p.set('before', String(before));
  return `/audit-log?${p}`;
}

/** Read-only view of the hash-chained audit log. Admin sees system events, Corporate HR business events. */
export function AuditLogPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [categories, setCategories] = useState<AuditPage['categories']>([]);
  const more = useAction();

  const first = useAsync(async () => {
    const page = await get<AuditPage>(query(filters));
    setEvents(page.events);
    setNext(page.nextBefore);
    setCategories(page.categories);
    return page;
  }, [filters]);
  const integrity = useAsync(() => get<{ intact: boolean; brokenAtId: number | null }>('/audit-log/integrity'), []);

  const loadMore = () =>
    void more.run(async () => {
      const page = await get<AuditPage>(query(filters, next ?? undefined));
      setEvents((e) => [...e, ...page.events]);
      setNext(page.nextBefore);
    });

  const set = (p: Partial<Filters>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            Read-only record of sensitive actions, newest first. Entries cannot be changed or removed.
            {integrity.data && (
              <span data-testid="chain-status">
                <Chip tone={integrity.data.intact ? 'green' : 'red'}>{integrity.data.intact ? 'Hash chain intact' : `Chain broken at #${integrity.data.brokenAtId}`}</Chip>
              </span>
            )}
          </span>
        }
      />

      <form
        className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
        aria-label="Filter audit events"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        {categories.length > 1 && (
          <Field label="Category" htmlFor="a-cat">
            <select id="a-cat" className="input" value={draft.category} onChange={(e) => set({ category: e.target.value as Filters['category'] })}>
              <option value="">All</option>
              <option value="system">System</option>
              <option value="business">Business</option>
            </select>
          </Field>
        )}
        <Field label="Action" htmlFor="a-action" hint="e.g. TEMPLATE_ACTIVATED">
          <input id="a-action" className="input" value={draft.action} onChange={(e) => set({ action: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Actor" htmlFor="a-actor" hint="Login id, e.g. E0003">
          <input id="a-actor" className="input" value={draft.actor} onChange={(e) => set({ actor: e.target.value })} />
        </Field>
        <Field label="From" htmlFor="a-from">
          <input id="a-from" type="date" className="input" value={draft.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label="To" htmlFor="a-to">
          <input id="a-to" type="date" className="input" value={draft.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            Apply
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
            }}
          >
            Clear
          </button>
        </div>
      </form>

      <Card pad={false}>
        {first.loading && events.length === 0 ? (
          <Loading />
        ) : first.error ? (
          <div className="p-4">
            <ErrorBox onRetry={first.reload}>{first.error}</ErrorBox>
          </div>
        ) : events.length === 0 ? (
          <Empty title="No matching events" hint="Try clearing the filters." />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[820px]" aria-label="Audit events">
              <thead>
                <tr>
                  <th className="th">When</th>
                  <th className="th">Category</th>
                  <th className="th">Action</th>
                  <th className="th">Actor</th>
                  <th className="th">Record</th>
                  <th className="th">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="align-top" data-testid={`audit-${e.action}`}>
                    <td className="td whitespace-nowrap tabular-nums">{fmtDateTime(e.at)}</td>
                    <td className="td">
                      <Chip tone={e.category === 'system' ? 'slate' : 'accent'}>{humanize(e.category)}</Chip>
                    </td>
                    <td className="td font-mono text-xs">{e.action}</td>
                    <td className="td">
                      {e.actorLoginId ? (
                        <>
                          {e.actorName} <span className="muted">{e.actorLoginId}</span>
                        </>
                      ) : (
                        <span className="muted">system</span>
                      )}
                    </td>
                    <td className="td">
                      {e.entityType ? (
                        <>
                          {e.entityType} <span className="muted">{(e.entityId ?? '').slice(0, 8)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="td">
                      {e.before == null && e.after == null && !e.ip ? (
                        '—'
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-accent-800">View</summary>
                          <pre className="mt-1 max-w-[28rem] overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">
                            {JSON.stringify({ before: e.before ?? undefined, after: e.after ?? undefined, ip: e.ip ?? undefined }, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {more.error && (
          <div className="p-4">
            <ErrorBox>{more.error}</ErrorBox>
          </div>
        )}
        {next !== null && (
          <div className="border-t border-slate-100 p-3 text-center">
            <button className="btn btn-secondary" disabled={more.busy} onClick={loadMore}>
              {more.busy ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
