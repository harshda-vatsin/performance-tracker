import { Plus, SquarePen } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, PageHeader, TableWrap, useToast } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { humanize } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { Direction, Kpi } from '../lib/types';
import { PQCDSM, PQCDSM_LABELS } from '../lib/validate';

export function KpisPage() {
  const { can } = useAuth();
  const toast = useToast();
  const kpis = useAsync(() => get<{ items: Kpi[] }>('/kpi-library'), []);
  const [cat, setCat] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Kpi>();
  const canWrite = can('kpi:write');
  const items = (kpis.data?.items ?? []).filter((k) => !cat || k.pqcdsm === cat);

  return (
    <>
      <PageHeader
        title="KPI library"
        subtitle="Reusable measures that KRA templates copy from. Grouped by PQCDSM category."
        actions={
          canWrite && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add KPI
            </button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
        <button className={`btn !py-1 text-xs ${cat === '' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCat('')}>
          All
        </button>
        {PQCDSM.map((c) => (
          <button key={c} className={`btn !py-1 text-xs ${cat === c ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCat(c)}>
            {c} · {PQCDSM_LABELS[c]}
          </button>
        ))}
      </div>
      <Card pad={false}>
        {kpis.loading && !kpis.data ? (
          <Loading />
        ) : kpis.error ? (
          <div className="p-4">
            <ErrorBox onRetry={kpis.reload}>{kpis.error}</ErrorBox>
          </div>
        ) : items.length === 0 ? (
          <Empty title="No KPIs in this category" />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="th">Code</th>
                  <th className="th">Name</th>
                  <th className="th">Category</th>
                  <th className="th">Better when</th>
                  <th className="th">Unit</th>
                  <th className="th">Status</th>
                  {canWrite && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {items.map((k) => (
                  <tr key={k.id} className="tr-hover">
                    <td className="td font-mono text-xs">{k.code}</td>
                    <td className="td font-medium text-slate-900">{k.nameEn}</td>
                    <td className="td">
                      <Chip tone="accent">
                        {k.pqcdsm} · {PQCDSM_LABELS[k.pqcdsm]}
                      </Chip>
                    </td>
                    <td className="td">{k.direction === 'HIGHER_BETTER' ? 'Higher' : 'Lower'}</td>
                    <td className="td">{k.unit}</td>
                    <td className="td">
                      <Chip tone={k.active ? 'green' : 'slate'}>{k.active ? 'active' : 'inactive'}</Chip>
                    </td>
                    {canWrite && (
                      <td className="td text-right">
                        <button className="btn btn-ghost !p-1.5" onClick={() => setEditing(k)} aria-label={`Edit ${k.code}`}>
                          <SquarePen size={14} />
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
        <KpiForm
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            toast('KPI added');
            kpis.reload();
          }}
        />
      )}
      {editing && (
        <KpiForm
          kpi={editing}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            toast('KPI updated');
            kpis.reload();
          }}
        />
      )}
    </>
  );
}

function KpiForm({ kpi, onClose, onDone }: { kpi?: Kpi; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(kpi?.code ?? '');
  const [nameEn, setName] = useState(kpi?.nameEn ?? '');
  const [pqcdsm, setCat] = useState(kpi?.pqcdsm ?? 'P');
  const [direction, setDir] = useState<Direction>(kpi?.direction ?? 'HIGHER_BETTER');
  const [unit, setUnit] = useState(kpi?.unit ?? '');
  const [active, setActive] = useState(kpi?.active ?? true);
  const { busy, error, run } = useAction();
  return (
    <Modal
      open
      title={kpi ? `Edit ${kpi.code}` : 'Add KPI'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !nameEn.trim() || !unit.trim() || (!kpi && !code.trim())}
            onClick={() => void run(async () => {
              if (kpi) await patch(`/kpi-library/${kpi.id}`, { nameEn: nameEn.trim(), unit: unit.trim(), active });
              else await post('/kpi-library', { code: code.trim(), nameEn: nameEn.trim(), pqcdsm, direction, unit: unit.trim() });
              onDone();
            })}
          >
            {kpi ? 'Save' : 'Add KPI'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" htmlFor="k-code">
            <input id="k-code" className="input" value={code} disabled={!!kpi} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SCRAP_RATE" />
          </Field>
          <Field label="Unit" htmlFor="k-unit" hint="% and count get range checks on data entry">
            <input id="k-unit" className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. %, count, kWh/t" />
          </Field>
        </div>
        <Field label="Name" htmlFor="k-name">
          <input id="k-name" className="input" value={nameEn} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="k-cat">
            <select id="k-cat" className="input" value={pqcdsm} disabled={!!kpi} onChange={(e) => setCat(e.target.value)}>
              {PQCDSM.map((c) => (
                <option key={c} value={c}>
                  {c} · {PQCDSM_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Better when" htmlFor="k-dir">
            <select id="k-dir" className="input" value={direction} disabled={!!kpi} onChange={(e) => setDir(e.target.value as Direction)}>
              <option value="HIGHER_BETTER">{humanize('HIGHER_BETTER')}</option>
              <option value="LOWER_BETTER">{humanize('LOWER_BETTER')}</option>
            </select>
          </Field>
        </div>
        {kpi && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
        )}
      </div>
    </Modal>
  );
}
