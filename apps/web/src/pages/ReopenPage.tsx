import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StateChip, TableWrap, useToast } from '../components/ui';
import { get, post } from '../lib/api';
import { fmtDateTime, monthLabel } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { ReopenRequest } from '../lib/types';

export function ReopenPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [state, setState] = useState('');
  const list = useAsync(() => get<{ requests: ReopenRequest[] }>(`/reopen-requests${state ? `?state=${state}` : ''}`), [state]);
  const [deciding, setDeciding] = useState<{ r: ReopenRequest; approve: boolean }>();

  return (
    <>
      <PageHeader title="Reopen requests" subtitle="A locked month can only be changed through an approved reopen; its official scores disappear until it is locked again." />
      <Card pad={false}>
        <div className="border-b border-slate-100 px-4 py-3 md:px-5">
          <select className="input !w-auto" aria-label="State" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Refused</option>
          </select>
        </div>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorBox onRetry={list.reload}>{list.error}</ErrorBox>
          </div>
        ) : !list.data?.requests.length ? (
          <Empty title="No reopen requests" hint="Request a reopen from a locked month's page." />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="th">Unit</th>
                  <th className="th">Month</th>
                  <th className="th">Reason</th>
                  <th className="th">Requested</th>
                  <th className="th">State</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {list.data.requests.map((r) => (
                  <tr key={r.id} className="tr-hover">
                    <td className="td font-medium">
                      <Link className="text-accent-800 hover:underline" to={`/submissions/${r.submissionId}`}>
                        {r.unitCode}
                      </Link>
                    </td>
                    <td className="td">{monthLabel(r.period)}</td>
                    <td className="td max-w-xs">{r.reason}</td>
                    <td className="td">{fmtDateTime(r.requestedAt)}</td>
                    <td className="td">
                      <StateChip state={r.state} />
                    </td>
                    <td className="td text-right">
                      {r.state === 'PENDING' && can('reopen:approve') && (
                        <span className="inline-flex gap-2">
                          <button className="btn btn-primary !py-1 text-xs" onClick={() => setDeciding({ r, approve: true })}>
                            Approve
                          </button>
                          <button className="btn btn-danger !py-1 text-xs" onClick={() => setDeciding({ r, approve: false })}>
                            Refuse
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {deciding && (
        <Decide
          {...deciding}
          onClose={() => setDeciding(undefined)}
          onDone={() => {
            toast(deciding.approve ? 'Month reopened' : 'Request refused');
            setDeciding(undefined);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function Decide({ r, approve, onClose, onDone }: { r: ReopenRequest; approve: boolean; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      open
      title={approve ? 'Approve reopen' : 'Refuse reopen'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`}
            disabled={busy || (!approve && !comment.trim())}
            onClick={() => void run(async () => {
              await post(`/reopen-requests/${r.id}/decision`, { approve, ...(comment.trim() ? { comment: comment.trim() } : {}) });
              onDone();
            })}
          >
            {approve ? 'Approve' : 'Refuse'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <p className="text-sm">
          {r.unitCode} · {monthLabel(r.period)}: {r.reason}
        </p>
        <Field label={approve ? 'Comment (optional)' : 'Comment (required)'} htmlFor="ro-comment">
          <textarea id="ro-comment" className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
