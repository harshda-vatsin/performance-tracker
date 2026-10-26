import { ArrowRightLeft, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, PageHeader, TableWrap, useToast } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { fiscalYearOf } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { Employee, OrgUnit } from '../lib/types';

interface Category {
  id: string;
  code: string;
  name: string;
}
interface Assignment {
  id: string;
  unitCode: string;
  category: string;
  designation: string | null;
  validFrom: string;
  validTo: string | null;
}

/** An employee must be assigned to the unit for the whole month to be placed on that month's scorecard, so default to the start of the fiscal year. */
const fyStart = () => `${fiscalYearOf(new Date().toISOString().slice(0, 7))}-04-01`;

export function EmployeesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const emps = useAsync(() => get<{ employees: Employee[] }>('/employees'), []);
  const units = useAsync(() => (can('org:read') ? get<{ units: OrgUnit[] }>('/org/units') : Promise.resolve({ units: [] })), []);
  const cats = useAsync(() => get<{ categories: Category[] }>('/config/employee-categories'), []);
  const [q, setQ] = useState('');
  const [unit, setUnit] = useState('');
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Employee>();
  const canWrite = can('employees:write');

  const list = emps.data?.employees ?? [];
  const unitCodes = useMemo(() => [...new Set(list.map((e) => e.unitCode).filter((c): c is string => !!c))].sort(), [list]);
  const shown = list.filter(
    (e) => (!unit || e.unitCode === unit) && (!q || `${e.employeeCode} ${e.fullName} ${e.designation ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="People in your scope and where they are currently assigned."
        actions={
          canWrite && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add employee
            </button>
          )
        }
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 md:px-5">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
            <input className="input !pl-8" placeholder="Search code, name or designation" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input !w-auto" aria-label="Filter by unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">All units</option>
            {unitCodes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="muted ml-auto">{shown.length} shown</span>
        </div>
        {emps.loading && !emps.data ? (
          <Loading />
        ) : emps.error ? (
          <div className="p-4">
            <ErrorBox onRetry={emps.reload}>{emps.error}</ErrorBox>
          </div>
        ) : shown.length === 0 ? (
          <Empty title={list.length ? 'No one matches that filter' : 'No employees in your scope yet'} />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="th">Code</th>
                  <th className="th">Name</th>
                  <th className="th">Unit</th>
                  <th className="th">Category</th>
                  <th className="th">Designation</th>
                  <th className="th">Status</th>
                  {canWrite && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="tr-hover">
                    <td className="td font-mono text-xs">{e.employeeCode}</td>
                    <td className="td font-medium text-slate-900">{e.fullName}</td>
                    <td className="td">{e.unitCode ?? <span className="text-slate-400">Unassigned</span>}</td>
                    <td className="td">{e.category?.replace(/_/g, ' ').toLowerCase() ?? '—'}</td>
                    <td className="td">{e.designation ?? '—'}</td>
                    <td className="td">
                      <Chip tone={e.status === 'ACTIVE' ? 'green' : 'slate'}>{e.status.toLowerCase()}</Chip>
                    </td>
                    {canWrite && (
                      <td className="td text-right">
                        <button className="btn btn-secondary !py-1 text-xs" onClick={() => setMoving(e)} aria-label={`Transfer ${e.fullName}`}>
                          <ArrowRightLeft size={13} /> Transfer
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
        <AddEmployee
          units={units.data?.units ?? []}
          categories={cats.data?.categories ?? []}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            toast('Employee added');
            emps.reload();
          }}
        />
      )}
      {moving && (
        <Transfer
          emp={moving}
          units={units.data?.units ?? []}
          categories={cats.data?.categories ?? []}
          onClose={() => setMoving(undefined)}
          onDone={(msg) => {
            setMoving(undefined);
            toast(msg);
            emps.reload();
          }}
        />
      )}
    </>
  );
}

const assignable = (units: OrgUnit[]) => units.filter((u) => u.unitType !== 'COMPANY');

function AddEmployee({ units, categories, onClose, onDone }: { units: OrgUnit[]; categories: Category[]; onClose: () => void; onDone: () => void }) {
  const opts = assignable(units);
  const [f, setF] = useState({ employeeCode: '', fullName: '', orgUnitId: '', categoryCode: 'STAFF', designation: '', grade: '', mobile: '', validFrom: fyStart() });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useAction();
  const unitId = f.orgUnitId || opts[0]?.id || '';
  const ready = f.employeeCode.trim() && f.fullName.trim() && unitId;
  return (
    <Modal
      open
      title="Add employee"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!ready || busy}
            onClick={() => void run(async () => {
              await post('/employees', {
                employeeCode: f.employeeCode.trim(),
                fullName: f.fullName.trim(),
                orgUnitId: unitId,
                categoryCode: f.categoryCode,
                validFrom: f.validFrom,
                ...(f.designation.trim() ? { designation: f.designation.trim() } : {}),
                ...(f.grade.trim() ? { grade: f.grade.trim() } : {}),
                ...(f.mobile.trim() ? { mobile: f.mobile.trim() } : {}),
              });
              onDone();
            })}
          >
            Add employee
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee code" htmlFor="emp-code">
            <input id="emp-code" className="input" value={f.employeeCode} onChange={set('employeeCode')} />
          </Field>
          <Field label="Full name" htmlFor="emp-name">
            <input id="emp-name" className="input" value={f.fullName} onChange={set('fullName')} />
          </Field>
        </div>
        <Field label="Unit" htmlFor="emp-unit">
          <select id="emp-unit" className="input" value={unitId} onChange={set('orgUnitId')}>
            {opts.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.code})
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="emp-cat">
            <select id="emp-cat" className="input" value={f.categoryCode} onChange={set('categoryCode')}>
              {categories.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned from" htmlFor="emp-from" hint="Defaults to the start of the fiscal year so earlier months can include them">
            <input id="emp-from" type="date" className="input" value={f.validFrom} onChange={set('validFrom')} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Designation" htmlFor="emp-des">
            <input id="emp-des" className="input" value={f.designation} onChange={set('designation')} />
          </Field>
          <Field label="Grade" htmlFor="emp-grade">
            <input id="emp-grade" className="input" value={f.grade} onChange={set('grade')} />
          </Field>
          <Field label="Mobile" htmlFor="emp-mob">
            <input id="emp-mob" className="input" value={f.mobile} onChange={set('mobile')} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Transfer({ emp, units, categories, onClose, onDone }: { emp: Employee; units: OrgUnit[]; categories: Category[]; onClose: () => void; onDone: (msg: string) => void }) {
  const history = useAsync(() => get<{ assignments: Assignment[] }>(`/employees/${emp.id}/assignments`), [emp.id]);
  const opts = assignable(units);
  const [orgUnitId, setUnit] = useState('');
  const [categoryCode, setCat] = useState(emp.category ?? 'STAFF');
  const [validFrom, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const { busy, error, run } = useAction();
  const unitId = orgUnitId || opts.find((u) => u.code !== emp.unitCode)?.id || '';
  return (
    <Modal
      open
      wide
      title={`Transfer ${emp.fullName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!unitId || busy}
            onClick={() => void run(async () => {
              await post(`/employees/${emp.id}/assignments`, { orgUnitId: unitId, categoryCode, validFrom, designation: emp.designation ?? undefined });
              onDone('Transfer recorded');
            })}
          >
            Transfer
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid grid-cols-3 gap-3">
          <Field label="New unit" htmlFor="tr-unit">
            <select id="tr-unit" className="input" value={unitId} onChange={(e) => setUnit(e.target.value)}>
              {opts.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category" htmlFor="tr-cat">
            <select id="tr-cat" className="input" value={categoryCode} onChange={(e) => setCat(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Effective from" htmlFor="tr-from">
            <input id="tr-from" type="date" className="input" value={validFrom} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div>
          <h3 className="section-title mb-2">Assignment history</h3>
          {history.loading && !history.data ? (
            <Loading />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Unit</th>
                  <th className="th">Category</th>
                  <th className="th">From</th>
                  <th className="th">To</th>
                </tr>
              </thead>
              <tbody>
                {(history.data?.assignments ?? []).map((a) => (
                  <tr key={a.id}>
                    <td className="td">{a.unitCode}</td>
                    <td className="td">{a.category.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="td">{a.validFrom}</td>
                    <td className="td">{a.validTo ?? 'current'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <EmployeeStatus emp={emp} onDone={onDone} />
      </div>
    </Modal>
  );
}

function EmployeeStatus({ emp, onDone }: { emp: Employee; onDone: (msg: string) => void }) {
  const { busy, error, run } = useAction();
  const next = emp.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-sm">
        Status: <b>{emp.status.toLowerCase()}</b>
        {error && <span className="ml-2 text-red-700">{error}</span>}
      </div>
      <button
        className="btn btn-secondary !py-1 text-xs"
        disabled={busy}
        onClick={() => void run(async () => {
          await patch(`/employees/${emp.id}`, { status: next });
          onDone(`Marked ${next.toLowerCase()}`);
        })}
      >
        Mark {next.toLowerCase()}
      </button>
    </div>
  );
}
