import { Plus, UserRoundPen } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, PageHeader, TableWrap, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAction, useAsync } from '../lib/hooks';

interface Appraisal {
  id: string;
  fiscalYear: number;
  employeeCode: string;
  employeeName: string;
  unitCode: string | null;
  reviewerLoginId: string | null;
  reviewerName: string | null;
}

/** Start year of the Apr-Mar fiscal year that contains today. */
const currentFy = (): number => {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
};

/**
 * Senior-staff appraisals. The reviewer is chosen per appraisal, not by role: any HOD / Manager, Plant Head or
 * Management user can be assigned, and the server refuses anyone else.
 */
export function AppraisalsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [fy, setFy] = useState(currentFy());
  const list = useAsync(() => get<{ appraisals: Appraisal[] }>(`/appraisals?fiscalYear=${fy}`), [fy]);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<Appraisal>();
  const canAssign = can('appraisals:assign');
  const rows = list.data?.appraisals ?? [];

  return (
    <>
      <PageHeader
        title="Appraisals"
        subtitle="Senior-staff appraisals and who reviews each one. A reviewer is an assignment on the appraisal, not a role."
        actions={
          canAssign && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> New appraisal
            </button>
          )
        }
      />
      <div className="mb-3 max-w-[10rem]">
        <Field label="Fiscal year" htmlFor="ap-fy" hint={`FY ${fy}-${String(fy + 1).slice(2)}`}>
          <input id="ap-fy" type="number" className="input" min={2000} max={2100} value={fy} onChange={(e) => Number(e.target.value) >= 2000 && setFy(Number(e.target.value))} />
        </Field>
      </div>
      <Card pad={false}>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorBox onRetry={list.reload}>{list.error}</ErrorBox>
          </div>
        ) : rows.length === 0 ? (
          <Empty title="No appraisals for this year" hint={canAssign ? 'Use New appraisal to add one.' : 'Appraisals you review or can see will appear here.'} />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[640px]" aria-label="Appraisals">
              <thead>
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">Unit</th>
                  <th className="th">Reviewer</th>
                  {canAssign && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="tr-hover" data-testid={`appraisal-${a.employeeCode}`}>
                    <td className="td font-medium text-slate-900">
                      {a.employeeName} <span className="muted">{a.employeeCode}</span>
                    </td>
                    <td className="td">{a.unitCode ?? '—'}</td>
                    <td className="td">
                      {a.reviewerLoginId ? (
                        <>
                          {a.reviewerName} <span className="muted">{a.reviewerLoginId}</span>
                        </>
                      ) : (
                        <Chip tone="amber">Not assigned</Chip>
                      )}
                    </td>
                    {canAssign && (
                      <td className="td text-right">
                        <button className="btn btn-ghost !p-1.5" onClick={() => setChanging(a)} aria-label={`Change reviewer for ${a.employeeCode}`}>
                          <UserRoundPen size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {adding && (
        <NewAppraisal
          fy={fy}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            toast('Appraisal added');
            list.reload();
          }}
        />
      )}
      {changing && (
        <ChangeReviewer
          appraisal={changing}
          onClose={() => setChanging(undefined)}
          onDone={() => {
            setChanging(undefined);
            toast('Reviewer assigned');
            list.reload();
          }}
        />
      )}
    </>
  );
}

const REVIEWER_HINT = 'Login id of an HOD / Manager, Plant Head or Management user';

function NewAppraisal({ fy, onClose, onDone }: { fy: number; onClose: () => void; onDone: () => void }) {
  const [employeeCode, setEmployee] = useState('');
  const [year, setYear] = useState(String(fy));
  const [reviewer, setReviewer] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      open
      title="New appraisal"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !employeeCode.trim() || !/^\d{4}$/.test(year)}
            onClick={() => void run(async () => {
              await post('/appraisals', { employeeCode: employeeCode.trim(), fiscalYear: Number(year), ...(reviewer.trim() ? { reviewerLoginId: reviewer.trim() } : {}) });
              onDone();
            })}
          >
            Add appraisal
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Employee code" htmlFor="na-emp">
          <input id="na-emp" className="input" value={employeeCode} onChange={(e) => setEmployee(e.target.value)} placeholder="e.g. E0107" />
        </Field>
        <Field label="Fiscal year" htmlFor="na-fy" hint="Start year of the Apr-Mar year">
          <input id="na-fy" className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        </Field>
        <Field label="Reviewer (optional)" htmlFor="na-rev" hint={REVIEWER_HINT}>
          <input id="na-rev" className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ChangeReviewer({ appraisal, onClose, onDone }: { appraisal: Appraisal; onClose: () => void; onDone: () => void }) {
  const [reviewer, setReviewer] = useState(appraisal.reviewerLoginId ?? '');
  const { busy, error, run } = useAction();
  return (
    <Modal
      open
      title={`Reviewer for ${appraisal.employeeName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !reviewer.trim()}
            onClick={() => void run(async () => {
              await put(`/appraisals/${appraisal.id}/reviewer`, { reviewerLoginId: reviewer.trim() });
              onDone();
            })}
          >
            Assign reviewer
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Reviewer" htmlFor="cr-rev" hint={REVIEWER_HINT}>
          <input id="cr-rev" className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
