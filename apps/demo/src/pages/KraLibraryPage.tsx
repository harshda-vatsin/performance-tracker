import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DirectionTag, SourceBadge } from '../components/appraisal/parts';
import { Card, Chip, Field, Modal, PageHeader, TableWrap } from '../components/ui';
import { WEIGHTAGE_TOTAL } from '../config/scoring.config';
import { KPI_CATALOG, KPI_MAP } from '../data/kpiCatalog';
import { ROLE_DEPARTMENT, SENIOR_ROLES } from '../data/kras';
import { useStore } from '../store/AppStore';
import type { Direction, Kra, KpiSource, SeniorRole } from '../types';
import { fmtNumber } from '../utils/format';
import { rebalanceWeights, sumWeights } from '../utils/scoring';

export function KraLibraryPage() {
  const { role, kras, saveRoleKras } = useStore();
  const canEdit = role === 'hr';
  const [selRole, setSelRole] = useState<SeniorRole>('Production Manager');
  const [editing, setEditing] = useState<{ kra: Kra; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Kra | null>(null);

  const roleKras = kras.filter((k) => k.role === selRole);
  const total = sumWeights(roleKras);
  const ok = Math.abs(total - WEIGHTAGE_TOTAL) < 0.001;

  const startNew = () =>
    setEditing({
      isNew: true,
      kra: {
        id: `kra-new-${Date.now()}`,
        department: ROLE_DEPARTMENT[selRole],
        role: selRole,
        area: '',
        kpiKey: 'custom',
        kpi: '',
        unit: '',
        weightage: 5,
        target: 0,
        direction: 'higher',
        source: 'Manual',
      },
    });

  const confirmDelete = () => {
    if (!deleting) return;
    const rest = roleKras.filter((k) => k.id !== deleting.id);
    const w = rebalanceWeights(rest.map((k) => k.weightage), null);
    saveRoleKras(selRole, rest.map((k, i) => ({ ...k, weightage: w[i] })));
    setDeleting(null);
  };

  return (
    <>
      <PageHeader
        title="KRA / KPI Library"
        subtitle="Key result areas by department and role. Weightages for each role must total 100%."
        actions={
          canEdit && (
            <button className="btn btn-primary" onClick={startNew}>
              <Plus size={15} /> Add KRA
            </button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {SENIOR_ROLES.map((r) => {
          const t = sumWeights(kras.filter((k) => k.role === r));
          const active = r === selRole;
          return (
            <button
              key={r}
              onClick={() => setSelRole(r)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                active ? 'border-accent-300 bg-accent-50' : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{ROLE_DEPARTMENT[r]}</div>
              <div className="text-sm font-semibold text-slate-900">{r}</div>
              <div className="mt-1.5">
                <Chip tone={Math.abs(t - WEIGHTAGE_TOTAL) < 0.001 ? 'green' : 'red'}>{t}% weightage</Chip>
              </div>
            </button>
          );
        })}
      </div>

      {!canEdit && (
        <div className="mb-4 rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-600">
          View only — the KRA library is maintained by HR.
        </div>
      )}

      <Card
        title={`${selRole} · ${ROLE_DEPARTMENT[selRole]}`}
        subtitle="Changes apply to goal sheets assigned from now on; sheets already acknowledged keep their own snapshot."
        action={<Chip tone={ok ? 'green' : 'red'}>{ok ? `Total ${total}% ✓` : `Total ${total}% — must be ${WEIGHTAGE_TOTAL}%`}</Chip>}
        pad={false}
      >
        <TableWrap>
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th className="th">KRA</th>
                <th className="th">KPI</th>
                <th className="th">Unit</th>
                <th className="th">Direction</th>
                <th className="th">Data source</th>
                <th className="th text-right">Target</th>
                <th className="th text-right">Weightage</th>
                {canEdit && <th className="th" />}
              </tr>
            </thead>
            <tbody>
              {roleKras.map((k) => (
                <tr key={k.id} className="tr-hover">
                  <td className="td font-medium text-slate-900">{k.area}</td>
                  <td className="td">{k.kpi}</td>
                  <td className="td text-slate-500">{k.unit}</td>
                  <td className="td">
                    <DirectionTag direction={k.direction} />
                  </td>
                  <td className="td">
                    <SourceBadge source={k.source} />
                  </td>
                  <td className="td text-right tabular-nums">{fmtNumber(k.target, KPI_MAP[k.kpiKey]?.decimals ?? 1)}</td>
                  <td className="td text-right font-medium tabular-nums">{k.weightage}%</td>
                  {canEdit && (
                    <td className="td text-right">
                      <button className="btn btn-ghost !p-1.5" title="Edit" onClick={() => setEditing({ kra: k, isNew: false })}>
                        <Pencil size={14} />
                      </button>
                      <button className="btn btn-ghost !p-1.5 text-red-600" title="Remove" onClick={() => setDeleting(k)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="td font-semibold" colSpan={6}>
                  Total weightage
                </td>
                <td className={`td text-right font-semibold tabular-nums ${ok ? 'text-emerald-700' : 'text-red-600'}`}>{total}%</td>
                {canEdit && <td className="td" />}
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      </Card>

      {editing && (
        <KraEditor
          key={editing.kra.id}
          initial={editing.kra}
          isNew={editing.isNew}
          roleKras={roleKras}
          onClose={() => setEditing(null)}
          onSave={(list) => {
            saveRoleKras(selRole, list);
            setEditing(null);
          }}
        />
      )}

      <Modal
        open={!!deleting}
        title="Remove KRA"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={confirmDelete}>
              Remove and rebalance
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Remove <b>{deleting?.kpi}</b> from {selRole}? The remaining KRAs will be rescaled proportionally so the role still totals{' '}
          {WEIGHTAGE_TOTAL}%.
        </p>
      </Modal>
    </>
  );
}

function KraEditor({
  initial,
  isNew,
  roleKras,
  onClose,
  onSave,
}: {
  initial: Kra;
  isNew: boolean;
  roleKras: Kra[];
  onClose: () => void;
  onSave: (list: Kra[]) => void;
}) {
  const [draft, setDraft] = useState<Kra>(initial);
  const [others, setOthers] = useState<Kra[]>(roleKras.filter((k) => k.id !== initial.id));

  const total = draft.weightage + sumWeights(others);
  const balanced = Math.abs(total - WEIGHTAGE_TOTAL) < 0.001;
  const valid = balanced && draft.area.trim() && draft.kpi.trim() && draft.unit.trim() && draft.weightage > 0 && draft.target >= 0;

  const set = <K extends keyof Kra>(key: K, value: Kra[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const pickCatalog = (key: string) => {
    const k = KPI_MAP[key];
    if (!k) return;
    setDraft((d) => ({ ...d, kpiKey: k.key, kpi: k.name, unit: k.unit, direction: k.direction, source: k.source }));
  };

  const autoBalance = () => {
    const out = rebalanceWeights([draft.weightage, ...others.map((o) => o.weightage)], 0);
    setOthers(others.map((o, i) => ({ ...o, weightage: out[i + 1] })));
  };

  const save = () => {
    const byId = new Map(others.map((o) => [o.id, o]));
    const list = isNew ? [...roleKras.map((k) => byId.get(k.id) ?? k), draft] : roleKras.map((k) => (k.id === draft.id ? draft : (byId.get(k.id) ?? k)));
    onSave(list);
  };

  return (
    <Modal
      open
      wide
      title={isNew ? `Add KRA · ${initial.role}` : `Edit KRA · ${initial.role}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid} onClick={save}>
            Save KRA
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Start from catalogue KPI" hint="Pre-fills unit, direction and data source; you can still edit them.">
          <select className="input" value={KPI_MAP[draft.kpiKey] ? draft.kpiKey : ''} onChange={(e) => pickCatalog(e.target.value)}>
            <option value="">Custom KPI…</option>
            {KPI_CATALOG.map((k) => (
              <option key={k.key} value={k.key}>
                {k.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="KRA (key result area)">
          <input className="input" value={draft.area} onChange={(e) => set('area', e.target.value)} placeholder="e.g. Production Volume" />
        </Field>
        <Field label="KPI name">
          <input className="input" value={draft.kpi} onChange={(e) => set('kpi', e.target.value)} placeholder="e.g. Forged tonnage output" />
        </Field>
        <Field label="Unit">
          <input className="input" value={draft.unit} onChange={(e) => set('unit', e.target.value)} placeholder="e.g. t / month" />
        </Field>
        <Field label="Direction">
          <select className="input" value={draft.direction} onChange={(e) => set('direction', e.target.value as Direction)}>
            <option value="higher">Higher is better</option>
            <option value="lower">Lower is better</option>
          </select>
        </Field>
        <Field label="Data source">
          <select className="input" value={draft.source} onChange={(e) => set('source', e.target.value as KpiSource)}>
            <option value="SAP">Synced from SAP S/4HANA</option>
            <option value="Manual">Manual entry</option>
          </select>
        </Field>
        <Field label="Target">
          <input className="input" type="number" step="any" value={draft.target} onChange={(e) => set('target', parseFloat(e.target.value) || 0)} />
        </Field>
        <Field label="Weightage (%)">
          <input className="input" type="number" min={1} max={100} value={draft.weightage} onChange={(e) => set('weightage', parseInt(e.target.value, 10) || 0)} />
        </Field>
      </div>

      <div className="mt-5 rounded-lg border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
          <div className="text-sm font-medium text-slate-800">Weightage balance for {initial.role}</div>
          <div className="flex items-center gap-2">
            <Chip tone={balanced ? 'green' : 'red'}>{balanced ? 'Total 100% ✓' : `Total ${total}%`}</Chip>
            <button className="btn btn-secondary !py-1" onClick={autoBalance} disabled={balanced}>
              Auto-balance others
            </button>
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {others.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-slate-700">{o.kpi}</span>
              <span className="flex items-center gap-1">
                <input
                  className="input !w-20 text-right"
                  type="number"
                  min={0}
                  max={100}
                  value={o.weightage}
                  onChange={(e) => setOthers((prev) => prev.map((x) => (x.id === o.id ? { ...x, weightage: parseInt(e.target.value, 10) || 0 } : x)))}
                />
                <span className="text-slate-400">%</span>
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 bg-accent-50/50 px-3 py-2 text-sm font-medium text-slate-900">
            <span>{draft.kpi || 'This KRA'}</span>
            <span className="tabular-nums">{draft.weightage}%</span>
          </li>
        </ul>
      </div>
    </Modal>
  );
}
