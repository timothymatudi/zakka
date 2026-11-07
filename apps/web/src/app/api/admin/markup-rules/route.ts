import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { adminIsLive, getMarkupRules, saveMarkupRules } from '@/lib/admin-data';
import type { MarkupRule } from '@/lib/mock/admin';

const SCOPES = ['global', 'category', 'source', 'product'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ rules: await getMarkupRules(), mode: adminIsLive() ? 'live' : 'mock' });
}

/** Replaces the markup rule set (admin only). The catalog applies the rules (contract pricing rule). */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as { rules?: MarkupRule[] } | null;
  const rules = body?.rules;
  if (!Array.isArray(rules) || rules.length > 1000) return NextResponse.json({ error: 'invalid_rules' }, { status: 400 });
  for (const r of rules) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') return NextResponse.json({ error: 'invalid_rules' }, { status: 400 });
    if (!SCOPES.includes(r.scope)) return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
    const global = r.scope === 'global';
    if (global !== (r.scope_id == null || r.scope_id === '')) return NextResponse.json({ error: 'scope_id_mismatch' }, { status: 400 });
    if (!global && !UUID_RE.test(String(r.scope_id))) return NextResponse.json({ error: 'invalid_scope_id' }, { status: 400 });
    if (![r.percent, r.fixed_usd, r.round_to, r.priority].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return NextResponse.json({ error: 'invalid_number' }, { status: 400 });
    }
    if (r.percent < -100 || r.percent > 1000 || r.fixed_usd < 0 || r.round_to < 0 || !Number.isInteger(r.priority)) {
      return NextResponse.json({ error: 'out_of_range' }, { status: 400 });
    }
    if (typeof r.is_active !== 'boolean') return NextResponse.json({ error: 'invalid_rules' }, { status: 400 });
  }

  const clean = rules.map((r) => ({
    id: r.id,
    scope: r.scope,
    scope_id: r.scope === 'global' ? null : r.scope_id,
    percent: r.percent,
    fixed_usd: r.fixed_usd,
    round_to: r.round_to,
    priority: r.priority,
    is_active: r.is_active,
  }));
  if (!(await saveMarkupRules(clean))) return NextResponse.json({ error: 'save_failed' }, { status: 502 });
  return NextResponse.json({ ok: true, mode: adminIsLive() ? 'live' : 'mock', count: clean.length, rules: await getMarkupRules() });
}
