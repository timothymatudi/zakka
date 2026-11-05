import { NextResponse } from 'next/server';
import { setMockRules, type MarkupRule } from '@/lib/mock/admin';

const SCOPES = ['global', 'category', 'source', 'product'] as const;

/**
 * Mock save for markup rules.
 * TODO(auth): require an authenticated admin before accepting writes.
 * TODO(live): upsert into markup_rules with the service role once admin auth exists.
 */
export async function POST(req: Request) {
  let rules: MarkupRule[];
  try {
    rules = ((await req.json()) as { rules: MarkupRule[] }).rules;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!Array.isArray(rules)) return NextResponse.json({ error: 'invalid_rules' }, { status: 400 });
  for (const r of rules) {
    if (!SCOPES.includes(r.scope)) return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
    if ((r.scope === 'global') !== (r.scope_id == null || r.scope_id === '')) {
      return NextResponse.json({ error: 'scope_id_mismatch' }, { status: 400 });
    }
    if (![r.percent, r.fixed_usd, r.round_to, r.priority].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return NextResponse.json({ error: 'invalid_number' }, { status: 400 });
    }
  }
  setMockRules(rules.map((r) => ({ ...r, scope_id: r.scope === 'global' ? null : r.scope_id })));
  return NextResponse.json({ ok: true, mode: 'mock', count: rules.length });
}
