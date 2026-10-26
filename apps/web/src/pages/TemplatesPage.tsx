import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StateChip, TableWrap } from '../components/ui';
import { get, post } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { TemplateRow } from '../lib/types';

export function TemplatesPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useAsync(() => get<{ templates: TemplateRow[] }>('/templates'), []);
  const plantTypes = useAsync(() => (can('templates:write') ? get<{ plantTypes: { id: string; code: string; name: string }[] }>('/config/plant-types') : Promise.resolve({ plantTypes: [] })), []);
  const [adding, setAdding] = useState(false);
  const [plantTypeId, setPt] = useState('');
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  const pt = plantTypeId || plantTypes.data?.plantTypes[0]?.id || '';

  return (
    <>
      <PageHeader
        title="KRA templates"
        subtitle="The master set of KRAs per plant type. One person drafts, a different person approves (maker-checker)."
        actions={
          can('templates:write') && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> New template
            </button>
          )
        }
      />
      <Card pad={false}>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorBox onRetry={list.reload}>{list.error}</ErrorBox>
          </div>
        ) : !list.data?.templates.length ? (
          <Empty title="No templates yet" hint={can('templates:write') ? 'Create a draft template for a plant type to get started.' : 'Corporate HR creates templates; a Co-HR Head approves them.'} />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="th">Template</th>
                  <th className="th">Plant type</th>
                  <th className="th">Version</th>
                  <th className="th">KRAs</th>
                  <th className="th">Status</th>
                  <th className="th">Activated</th>
                </tr>
              </thead>
              <tbody>
                {list.data.templates.map((t) => (
                  <tr key={t.id} className="tr-hover">
                    <td className="td font-medium">
                      <Link className="text-accent-800 hover:underline" to={`/templates/${t.id}`}>
                        {t.name}
                      </Link>
                    </td>
                    <td className="td">{t.plantTypeCode}</td>
                    <td className="td">v{t.version}</td>
                    <td className="td">{t.kraCount}</td>
                    <td className="td">
                      <StateChip state={t.status} />
                    </td>
                    <td className="td">{t.activatedAt ? fmtDate(t.activatedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={adding}
        title="New template"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!pt || !name.trim() || busy}
              onClick={() => void run(async () => {
                const r = await post<{ id: string }>('/templates', { plantTypeId: pt, name: name.trim() });
                nav(`/templates/${r.id}`);
              })}
            >
              Create draft
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBox>{error}</ErrorBox>}
          <Field label="Plant type" htmlFor="t-pt">
            <select id="t-pt" className="input" value={pt} onChange={(e) => setPt(e.target.value)}>
              {(plantTypes.data?.plantTypes ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Template name" htmlFor="t-name">
            <input id="t-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Forge shop KRAs" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
