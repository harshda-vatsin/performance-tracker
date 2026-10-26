import { CheckCircle2, Copy, Library, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useMe } from '../auth/AuthContext';
import { Card, Chip, ErrorBox, Loading, Modal, Notice, PageHeader, StateChip, TableWrap, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { humanize } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import type { Direction, Kpi, Kra, Level, TemplateHead, Validation } from '../lib/types';
import { parseNum, PQCDSM, validateTemplate, type DraftKra } from '../lib/validate';

interface Detail {
  template: TemplateHead;
  levels: Level[];
  kras: (Kra & { id: string })[];
  validation: Validation;
}

/** Editor rows keep what was typed as text, so a half-typed "-" or "" never turns into a surprise 0. */
interface EditKra {
  key: number;
  kpiId: string | null;
  nameEn: string;
  nameTa: string | null;
  pqcdsm: string;
  direction: Direction;
  unit: string;
  presentLevel: string;
  targets: string[];
  weights: Record<string, string>;
}

let keySeq = 0;
const toEdit = (k: Kra): EditKra => ({
  key: ++keySeq,
  kpiId: k.kpiId,
  nameEn: k.nameEn,
  nameTa: k.nameTa,
  pqcdsm: k.pqcdsm,
  direction: k.direction,
  unit: k.unit,
  presentLevel: String(k.presentLevel),
  targets: k.targets.map(String),
  weights: Object.fromEntries(Object.entries(k.weights).map(([c, w]) => [c, String(w)])),
});

const num = (s: string) => {
  const n = parseNum(s);
  return n === null || Number.isNaN(n) ? 0 : n;
};
const bad = (s: string) => Number.isNaN(parseNum(s));

function toDraft(e: EditKra): DraftKra {
  return { nameEn: e.nameEn, pqcdsm: e.pqcdsm, direction: e.direction, presentLevel: num(e.presentLevel), targets: e.targets.map(num), weights: Object.fromEntries(Object.entries(e.weights).map(([c, w]) => [c, num(w)])) };
}

export function TemplateDetailPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const detail = useAsync(() => get<Detail>(`/templates/${id}`), [id]);
  const kpis = useAsync(() => (can('kpi:read') ? get<{ items: Kpi[] }>('/kpi-library') : Promise.resolve({ items: [] })), []);
  const [rows, setRows] = useState<EditKra[] | null>(null);
  const [picker, setPicker] = useState(false);
  const save = useAction();
  const act = useAction();
  const [saved, setSaved] = useState<Validation>();

  const d = detail.data;
  const t = d?.template;
  const isMaker = !!t && t.makerId === me.user.userId;
  const editing = rows !== null;
  const canEdit = !!t && t.status === 'DRAFT' && isMaker && can('templates:write');
  const canActivate = !!t && t.status === 'DRAFT' && !isMaker && can('templates:approve');
  const codes = useMemo(() => (d?.levels ?? []).map((l) => l.code), [d]);

  const live = useMemo(() => {
    if (!d) return undefined;
    if (rows) return validateTemplate(codes, rows.map(toDraft));
    return saved ?? d.validation;
  }, [d, rows, codes, saved]);

  if (detail.loading && !d) return <Loading />;
  if (detail.error || !d || !t) return <ErrorBox onRetry={detail.reload}>{detail.error ?? 'Template not found'}</ErrorBox>;

  const shown: EditKra[] = rows ?? d.kras.map(toEdit);
  const patchRow = (key: number, p: Partial<EditKra>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const hasBadNumber = rows?.some((r) => bad(r.presentLevel) || r.targets.some(bad) || Object.values(r.weights).some(bad) || !r.nameEn.trim() || !r.unit.trim());

  async function saveDraft() {
    const ok = await save.run(async () => {
      const res = await put<{ saved: number; validation: Validation }>(`/templates/${id}/kras`, {
        kras: rows!.map((r) => ({
          kpiId: r.kpiId,
          nameEn: r.nameEn.trim(),
          nameTa: r.nameTa,
          pqcdsm: r.pqcdsm,
          direction: r.direction,
          unit: r.unit.trim(),
          presentLevel: num(r.presentLevel),
          targets: r.targets.map(num),
          weights: Object.fromEntries(Object.entries(r.weights).filter(([, w]) => w.trim() !== '').map(([c, w]) => [c, num(w)])),
        })),
      });
      setSaved(res.validation);
      return res;
    });
    if (ok) {
      toast(`Draft saved (${ok.saved} KRAs)`);
      setRows(null);
      detail.reload();
    }
  }

  return (
    <>
      <PageHeader
        title={`${t.name} · v${t.version}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link to="/templates" className="text-accent-800 hover:underline">
              All templates
            </Link>
            <span>·</span>
            <span>{t.plantTypeCode}</span>
            <StateChip state={t.status} />
            {isMaker && t.status === 'DRAFT' && <Chip tone="blue">You are the author</Chip>}
          </span>
        }
        actions={
          <>
            {canEdit && !editing && (
              <button className="btn btn-primary" onClick={() => setRows(d.kras.map(toEdit))}>
                Edit KRAs
              </button>
            )}
            {editing && (
              <>
                <button className="btn btn-secondary" onClick={() => setRows(null)}>
                  Discard changes
                </button>
                <button className="btn btn-primary" disabled={save.busy || !!hasBadNumber} onClick={() => void saveDraft()}>
                  <Save size={15} /> Save draft
                </button>
              </>
            )}
            {canActivate && !editing && (
              <button
                className="btn btn-primary"
                disabled={act.busy}
                onClick={() => void act.run(async () => {
                  await post(`/templates/${id}/activate`);
                  toast('Template activated');
                  detail.reload();
                })}
              >
                <CheckCircle2 size={15} /> Approve and activate
              </button>
            )}
            {t.status !== 'DRAFT' && can('templates:write') && (
              <button
                className="btn btn-secondary"
                disabled={act.busy}
                onClick={() => void act.run(async () => {
                  const r = await post<{ id: string }>(`/templates/${id}/new-version`);
                  toast('New draft version created');
                  nav(`/templates/${r.id}`);
                })}
              >
                <Copy size={15} /> New version
              </button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {act.error && <ErrorBox>{act.error}</ErrorBox>}
        {save.error && <ErrorBox>{save.error}</ErrorBox>}
        {t.status === 'DRAFT' && !isMaker && can('templates:approve') && (
          <Notice>You can approve this draft because you are not its author. Activation checks every rule below.</Notice>
        )}
        {t.status === 'DRAFT' && isMaker && <Notice>A different Corporate HR user must approve this draft before it goes live. Drafts can be saved incomplete.</Notice>}

        <Card title="Checks" subtitle={editing ? 'Updated as you type' : 'As last saved'}>
          {live && live.errors.length === 0 && live.warnings.length === 0 && <p className="text-sm text-emerald-700">All checks pass.</p>}
          {live && live.errors.length > 0 && (
            <ul className="mb-2 space-y-1" aria-label="Errors">
              {live.errors.map((e, i) => (
                <li key={i} className="text-sm text-red-700">
                  ✕ {e.message}
                </li>
              ))}
            </ul>
          )}
          {live && live.warnings.length > 0 && (
            <ul className="space-y-1" aria-label="Warnings">
              {live.warnings.map((w, i) => (
                <li key={i} className="text-sm text-amber-800">
                  ! {w.message}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="KRAs"
          subtitle="Targets are quarterly (Q1 = Apr to Jun). Weights are per people level and must total 100 for each level."
          pad={false}
          action={
            editing && (
              <div className="flex gap-2">
                <button className="btn btn-secondary !py-1 text-xs" onClick={() => setPicker(true)} disabled={!kpis.data?.items.length}>
                  <Library size={13} /> From KPI library
                </button>
                <button
                  className="btn btn-secondary !py-1 text-xs"
                  onClick={() => setRows((rs) => [...rs!, { key: ++keySeq, kpiId: null, nameEn: '', nameTa: null, pqcdsm: 'P', direction: 'HIGHER_BETTER', unit: '%', presentLevel: '0', targets: ['0', '0', '0', '0'], weights: {} }])}
                >
                  <Plus size={13} /> Blank KRA
                </button>
              </div>
            )
          }
        >
          {shown.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No KRAs yet.{editing ? ' Add some from the KPI library.' : ''}</p>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[980px]" aria-label="KRAs">
                <thead>
                  <tr>
                    <th className="th">Cat</th>
                    <th className="th">KRA</th>
                    <th className="th">Better</th>
                    <th className="th">Unit</th>
                    <th className="th">Present</th>
                    {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                      <th key={q} className="th">
                        {q}
                      </th>
                    ))}
                    {d.levels.map((l) => (
                      <th key={l.id} className="th" title={l.nameEn}>
                        W · {l.code}
                      </th>
                    ))}
                    {editing && <th className="th" />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} className="align-top">
                      <td className="td">
                        {editing ? (
                          <select className="input !w-16" aria-label="Category" value={r.pqcdsm} onChange={(e) => patchRow(r.key, { pqcdsm: e.target.value })}>
                            {PQCDSM.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        ) : (
                          <Chip tone="accent">{r.pqcdsm}</Chip>
                        )}
                      </td>
                      <td className="td min-w-[200px]">
                        {editing ? <input className={`input ${!r.nameEn.trim() ? 'input-invalid' : ''}`} aria-label="KRA name" value={r.nameEn} onChange={(e) => patchRow(r.key, { nameEn: e.target.value })} /> : <span className="font-medium text-slate-900">{r.nameEn}</span>}
                      </td>
                      <td className="td">
                        {editing ? (
                          <select className="input !w-28" aria-label="Direction" value={r.direction} onChange={(e) => patchRow(r.key, { direction: e.target.value as Direction })}>
                            <option value="HIGHER_BETTER">Higher</option>
                            <option value="LOWER_BETTER">Lower</option>
                          </select>
                        ) : (
                          humanize(r.direction === 'HIGHER_BETTER' ? 'higher' : 'lower')
                        )}
                      </td>
                      <td className="td">{editing ? <input className="input !w-20" aria-label="Unit" value={r.unit} onChange={(e) => patchRow(r.key, { unit: e.target.value })} /> : r.unit}</td>
                      <td className="td">
                        {editing ? <NumInput label="Present level" value={r.presentLevel} onChange={(v) => patchRow(r.key, { presentLevel: v })} /> : r.presentLevel}
                      </td>
                      {r.targets.map((tv, i) => (
                        <td key={i} className="td">
                          {editing ? <NumInput label={`Q${i + 1} target`} value={tv} onChange={(v) => patchRow(r.key, { targets: r.targets.map((x, j) => (j === i ? v : x)) })} /> : tv}
                        </td>
                      ))}
                      {d.levels.map((l) => (
                        <td key={l.id} className="td">
                          {editing ? <NumInput label={`Weight ${l.code}`} value={r.weights[l.code] ?? ''} onChange={(v) => patchRow(r.key, { weights: { ...r.weights, [l.code]: v } })} /> : (r.weights[l.code] ?? '—')}
                        </td>
                      ))}
                      {editing && (
                        <td className="td">
                          <button className="btn btn-ghost !p-1.5 text-red-700" aria-label={`Remove ${r.nameEn || 'KRA'}`} onClick={() => setRows((rs) => rs!.filter((x) => x.key !== r.key))}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="bg-slate-50">
                    <td className="td font-semibold" colSpan={9}>
                      Weight total per level
                    </td>
                    {d.levels.map((l) => {
                      const total = Math.round(shown.reduce((s, r) => s + num(r.weights[l.code] ?? '') * 100, 0)) / 100;
                      return (
                        <td key={l.id} className={`td font-semibold tabular-nums ${total === 100 ? 'text-emerald-700' : 'text-red-700'}`} data-testid={`weight-total-${l.code}`}>
                          {total}
                        </td>
                      );
                    })}
                    {editing && <td className="td" />}
                  </tr>
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      {picker && (
        <Modal open title="Add from KPI library" onClose={() => setPicker(false)}>
          <ul className="divide-y divide-slate-100">
            {(kpis.data?.items ?? [])
              .filter((k) => k.active)
              .map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{k.nameEn}</div>
                    <div className="muted">
                      {k.pqcdsm} · {k.direction === 'HIGHER_BETTER' ? 'higher' : 'lower'} is better · {k.unit}
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary !py-1 text-xs"
                    onClick={() => {
                      setRows((rs) => [...rs!, { key: ++keySeq, kpiId: k.id, nameEn: k.nameEn, nameTa: k.nameTa, pqcdsm: k.pqcdsm, direction: k.direction, unit: k.unit, presentLevel: '0', targets: ['0', '0', '0', '0'], weights: {} }]);
                      setPicker(false);
                    }}
                  >
                    Add
                  </button>
                </li>
              ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <input className={`input !w-20 text-right tabular-nums ${bad(value) ? 'input-invalid' : ''}`} inputMode="decimal" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />;
}
