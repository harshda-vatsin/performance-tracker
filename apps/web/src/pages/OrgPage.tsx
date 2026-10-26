import { Building, Factory, Network, Plus, SquarePen } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Card, Chip, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useToast } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { useAction, useAsync } from '../lib/hooks';
import type { OrgUnit } from '../lib/types';

const PARENT_TYPES: Record<string, string[]> = { PLANT: ['COMPANY'], DEPARTMENT: ['PLANT'], CELL: ['DEPARTMENT', 'PLANT'] };
const ICON = { COMPANY: Building, PLANT: Factory, DEPARTMENT: Network, CELL: Network } as const;

export function OrgPage() {
  const { can } = useAuth();
  const toast = useToast();
  const units = useAsync(() => get<{ units: OrgUnit[] }>('/org/units'), []);
  const plantTypes = useAsync(() => get<{ plantTypes: { id: string; code: string; name: string }[] }>('/config/plant-types'), []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OrgUnit>();
  const canWrite = can('org:write');

  return (
    <>
      <PageHeader
        title="Organisation"
        subtitle="Company, plants, departments and cells you can see. The scored level depends on the plant type."
        actions={
          canWrite && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add unit
            </button>
          )
        }
      />
      <Card pad={false}>
        {units.loading && !units.data ? (
          <Loading />
        ) : units.error ? (
          <div className="p-4">
            <ErrorBox onRetry={units.reload}>{units.error}</ErrorBox>
          </div>
        ) : !units.data?.units.length ? (
          <Empty title="No organisation units in your scope" />
        ) : (
          <ul className="divide-y divide-slate-100" aria-label="Organisation tree">
            {units.data.units.map((u) => {
              const depth = u.path.split('.').length - 1;
              const Icon = ICON[u.unitType];
              return (
                <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5" style={{ paddingLeft: `${1 + depth * 1.5}rem` }}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon size={16} className="shrink-0 text-slate-400" />
                    <span className="truncate text-sm font-medium text-slate-900">{u.name}</span>
                    <span className="muted">{u.code}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip tone={u.unitType === 'PLANT' ? 'accent' : 'slate'}>{u.unitType.toLowerCase()}</Chip>
                    {canWrite && u.unitType !== 'COMPANY' && (
                      <button className="btn btn-ghost !p-1.5" onClick={() => setEditing(u)} aria-label={`Edit ${u.code}`}>
                        <SquarePen size={14} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {adding && (
        <AddUnit
          units={units.data?.units ?? []}
          plantTypes={plantTypes.data?.plantTypes ?? []}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            toast('Unit added');
            units.reload();
          }}
        />
      )}
      {editing && (
        <EditUnit
          unit={editing}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            toast('Unit updated');
            units.reload();
          }}
        />
      )}
    </>
  );
}

function AddUnit({ units, plantTypes, onClose, onDone }: { units: OrgUnit[]; plantTypes: { id: string; code: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [unitType, setUnitType] = useState<'PLANT' | 'DEPARTMENT' | 'CELL'>('DEPARTMENT');
  const parents = units.filter((u) => PARENT_TYPES[unitType].includes(u.unitType));
  const [parentId, setParentId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [plantTypeId, setPlantTypeId] = useState('');
  const { busy, error, run } = useAction();

  const parent = parents.some((p) => p.id === parentId) ? parentId : (parents[0]?.id ?? '');
  const ready = code.trim() && name.trim() && parent && (unitType !== 'PLANT' || plantTypeId);

  return (
    <Modal
      open
      title="Add organisation unit"
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
              await post('/org/units', { unitType, parentId: parent, code: code.trim(), name: name.trim(), ...(unitType === 'PLANT' ? { plantTypeId } : {}) });
              onDone();
            })}
          >
            Add unit
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Type" htmlFor="u-type">
          <select id="u-type" className="input" value={unitType} onChange={(e) => setUnitType(e.target.value as typeof unitType)}>
            <option value="PLANT">Plant</option>
            <option value="DEPARTMENT">Department</option>
            <option value="CELL">Cell</option>
          </select>
        </Field>
        <Field label="Parent" htmlFor="u-parent">
          <select id="u-parent" className="input" value={parent} onChange={(e) => setParentId(e.target.value)}>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </Field>
        {unitType === 'PLANT' && (
          <Field label="Plant type" htmlFor="u-pt">
            <select id="u-pt" className="input" value={plantTypeId} onChange={(e) => setPlantTypeId(e.target.value)}>
              <option value="">Select…</option>
              {plantTypes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" htmlFor="u-code">
            <input id="u-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. TRY-FIN" />
          </Field>
          <Field label="Name" htmlFor="u-name">
            <input id="u-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finishing Shop" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function EditUnit({ unit, onClose, onDone }: { unit: OrgUnit; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(unit.name);
  const [active, setActive] = useState(true);
  const { busy, error, run } = useAction();
  return (
    <Modal
      open
      title={`Edit ${unit.code}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim() || busy}
            onClick={() => void run(async () => {
              await patch(`/org/units/${unit.id}`, { name: name.trim(), active });
              onDone();
            })}
          >
            Save
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Name" htmlFor="e-name">
          <input id="e-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (inactive units drop out of boards and new months)
        </label>
      </div>
    </Modal>
  );
}
