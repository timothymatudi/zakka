'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MarkupRule } from '@/lib/mock/admin';

type Target = { id: string; label: string };
type Targets = Record<'category' | 'source' | 'product', Target[]>;
const SCOPES: MarkupRule['scope'][] = ['global', 'category', 'source', 'product'];

export function MarkupEditor({ initial, targets, live }: { initial: MarkupRule[]; targets: Targets; live: boolean }) {
  const t = useTranslations('admin');
  const [rules, setRules] = useState<MarkupRule[]>(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const patch = (i: number, p: Partial<MarkupRule>) => {
    setStatus('idle');
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  };
  const numField = (i: number, key: 'percent' | 'fixed_usd' | 'round_to' | 'priority', step: string) => (
    <input
      type="number"
      step={step}
      value={rules[i][key]}
      onChange={(e) => patch(i, { [key]: Number(e.target.value) })}
      className="field w-24 py-1"
      aria-label={key}
    />
  );

  async function save() {
    setStatus('saving');
    const res = await fetch('/api/admin/markup-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { rules?: MarkupRule[] } | null;
    // New rules get their database ids back, so the next save updates instead of inserting again.
    if (res?.ok && data?.rules) setRules(data.rules);
    setStatus(res?.ok ? 'saved' : 'error');
  }

  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-sand text-xs uppercase tracking-wide text-muted">
            <tr>
              {[t('cols.scope'), t('cols.scopeId'), t('cols.percent'), t('cols.fixed'), t('cols.roundTo'), t('cols.priority'), t('cols.active'), ''].map((h, i) => (
                <th key={i} className="px-3 py-2 text-start font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2">
                  <select
                    value={r.scope}
                    onChange={(e) => {
                      const scope = e.target.value as MarkupRule['scope'];
                      patch(i, { scope, scope_id: scope === 'global' ? null : targets[scope][0]?.id ?? null });
                    }}
                    className="field py-1"
                  >
                    {SCOPES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {r.scope === 'global' ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <select value={r.scope_id ?? ''} onChange={(e) => patch(i, { scope_id: e.target.value })} className="field max-w-56 py-1">
                      {targets[r.scope].map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-3 py-2">{numField(i, 'percent', '0.5')}</td>
                <td className="px-3 py-2">{numField(i, 'fixed_usd', '0.01')}</td>
                <td className="px-3 py-2">{numField(i, 'round_to', '0.01')}</td>
                <td className="px-3 py-2">{numField(i, 'priority', '1')}</td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={r.is_active} onChange={(e) => patch(i, { is_active: e.target.checked })} className="h-4 w-4 accent-teal" />
                </td>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="text-xs font-bold text-coral">
                    {t('delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-outline"
          onClick={() =>
            setRules((rs) => [
              ...rs,
              { id: `new-${Date.now()}`, scope: 'category', scope_id: targets.category[0]?.id ?? null, percent: 30, fixed_usd: 0, round_to: 0.99, priority: 10, is_active: true },
            ])
          }
        >
          {t('addRule')}
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={status === 'saving'}>
          {t('saveRules')}
        </button>
        {status === 'saved' && <span className="text-sm font-bold text-teal">{live ? t('savedLive') : t('saved')}</span>}
        {status === 'error' && <span className="text-sm font-bold text-coral">{t('saveError')}</span>}
      </div>
    </div>
  );
}
