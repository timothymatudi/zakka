import 'server-only';
import { CATEGORIES, SOURCES } from './catalog';

/** Mirrors a markup_rules row. */
export interface MarkupRule {
  id: string;
  scope: 'global' | 'category' | 'source' | 'product';
  scope_id: string | null;
  percent: number;
  fixed_usd: number;
  round_to: number;
  priority: number;
  is_active: boolean;
}

const g = globalThis as unknown as { __zakkaRules?: MarkupRule[] };

const SEED: MarkupRule[] = [
  { id: 'r1', scope: 'global', scope_id: null, percent: 35, fixed_usd: 1.5, round_to: 0.99, priority: 0, is_active: true },
  { id: 'r2', scope: 'category', scope_id: CATEGORIES.find((c) => c.slug === 'electronics')!.id, percent: 25, fixed_usd: 2, round_to: 0.99, priority: 10, is_active: true },
  { id: 'r3', scope: 'source', scope_id: SOURCES.find((s) => s.code === 'printful')!.id, percent: 45, fixed_usd: 0, round_to: 1, priority: 20, is_active: true },
];

export function getMockRules(): MarkupRule[] {
  g.__zakkaRules ??= SEED.map((r) => ({ ...r }));
  return g.__zakkaRules;
}

export function setMockRules(rules: MarkupRule[]) {
  g.__zakkaRules = rules;
}
