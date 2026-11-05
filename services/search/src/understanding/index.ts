// Query understanding: Claude (official Anthropic SDK, structured outputs) when
// ANTHROPIC_API_KEY is set, otherwise -- or on any error/refusal -- the
// rule-based parser in rules.ts.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Locale, QueryUnderstanding } from '../types';
import { parseQueryRules } from './rules';
import { FIXTURE_CATEGORY_SLUGS } from '../sources/fixtures';

/** Small, fast model is enough for parsing; ANTHROPIC_MODEL overrides it. */
export const DEFAULT_UNDERSTANDING_MODEL = 'claude-haiku-5-5';

export interface UnderstandOptions {
  apiKey: string;
  model: string;
  /** Injected in tests; built from apiKey otherwise. */
  client?: Pick<Anthropic, 'messages'>;
  timeoutMs?: number;
  categorySlugs?: string[];
}

export interface UnderstandContext {
  locale: Locale;
  country: string;
  currency: string;
}

const IntentSchema = z.object({
  keywords: z.string(),
  category_hint: z.string().nullable(),
  max_price: z.number().nullable(),
  currency: z.string().nullable(),
  max_days: z.number().int().nullable(),
});

// Stable across requests (only the category list varies, per deployment), so it
// forms a cacheable prefix. Per-request context goes in the user message.
function systemPrompt(slugs: string[]): string {
  return [
    'You turn shopping search queries, written in any language, into structured search intent for an e-commerce catalog.',
    'Fields:',
    '- keywords: product search words in the catalog locale given below, translated if the query is in another language. Keep brand names, models and specs (e.g. "128GB"). Drop price, delivery-speed and filler words ("cheap", "good", "please").',
    `- category_hint: one of [${slugs.join(', ')}] when the query clearly names such a product, else null.`,
    '- max_price and currency: only when the shopper states a price cap. currency is an ISO 4217 code; use the shopper currency given below when the cap has no explicit currency.',
    '- max_days: only when the shopper asks for speed. "fast"/"quick"/"express" = 5, "tomorrow"/"next day" = 2, "within N days" = N.',
    'Never invent constraints the shopper did not state; use null.',
  ].join('\n');
}

const clients = new Map<string, Anthropic>();
function clientFor(opts: UnderstandOptions): Pick<Anthropic, 'messages'> {
  if (opts.client) return opts.client;
  let c = clients.get(opts.apiKey);
  if (!c) {
    // Search is latency-sensitive: short timeout, one retry, then the rules take over.
    c = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 4000, maxRetries: 1 });
    clients.set(opts.apiKey, c);
  }
  return c;
}

export async function understandWithAi(q: string, ctx: UnderstandContext, opts: UnderstandOptions): Promise<QueryUnderstanding> {
  const slugs = opts.categorySlugs ?? FIXTURE_CATEGORY_SLUGS;
  const response = await clientFor(opts).messages.parse({
    model: opts.model || DEFAULT_UNDERSTANDING_MODEL,
    max_tokens: 2048,
    system: [{ type: 'text', text: systemPrompt(slugs), cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Catalog locale: ${ctx.locale}\nShopper country: ${ctx.country}\nShopper currency: ${ctx.currency}\n\nQuery: ${q}`,
      },
    ],
    // Extraction task: low effort keeps latency and cost down.
    output_config: { effort: 'low', format: zodOutputFormat(IntentSchema) },
  });
  if (response.stop_reason === 'refusal') throw new Error('anthropic: refusal');
  const out = response.parsed_output;
  if (!out) throw new Error(`anthropic: no parsed output (stop_reason=${response.stop_reason})`);

  const hint = out.category_hint?.trim() || null;
  const positive = (n: number | null) => (n != null && Number.isFinite(n) && n > 0 ? n : null);
  return {
    keywords: out.keywords.trim(),
    category_hint: hint && slugs.includes(hint) ? hint : null,
    max_price: positive(out.max_price),
    currency: out.currency?.trim().toUpperCase() || null,
    max_days: positive(out.max_days),
    source: 'ai',
  };
}

const cache = new Map<string, QueryUnderstanding>();
const CACHE_MAX = 2000;

export async function understandQuery(q: string, ctx: UnderstandContext, opts: UnderstandOptions): Promise<QueryUnderstanding> {
  const rules = parseQueryRules(q, { country: ctx.country });
  if (!opts.apiKey && !opts.client) return rules;
  const key = `${ctx.locale}|${ctx.country}|${q.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const ai = await understandWithAi(q, ctx, opts);
    // The rules act as a backstop for anything the AI left empty.
    const merged: QueryUnderstanding = {
      ...ai,
      keywords: ai.keywords || rules.keywords,
      max_price: ai.max_price ?? rules.max_price,
      currency: ai.max_price != null ? ai.currency ?? ctx.currency : rules.currency,
      max_days: ai.max_days ?? rules.max_days,
      category_hint: ai.category_hint ?? rules.category_hint,
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, merged);
    return merged;
  } catch (err) {
    console.warn(`[understanding] AI unavailable, using rules: ${(err as Error).message}`);
    return rules;
  }
}
