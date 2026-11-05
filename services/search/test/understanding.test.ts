import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { understandQuery, understandWithAi } from '../src/understanding';

const ctx = { locale: 'en' as const, country: 'KE', currency: 'KES' };

/** Fake SDK client: no network. Captures the request and returns a parsed output. */
function fakeClient(parsed: Record<string, unknown> | null, opts: { stop_reason?: string; fail?: boolean } = {}) {
  const parse = vi.fn(async () => {
    if (opts.fail) throw new Error('500 overloaded');
    return { stop_reason: opts.stop_reason ?? 'end_turn', parsed_output: parsed, content: [] };
  });
  return { client: { messages: { parse } } as unknown as Pick<Anthropic, 'messages'>, parse };
}

describe('query understanding', () => {
  it('uses rules (no client, no network) when ANTHROPIC_API_KEY is empty', async () => {
    const r = await understandQuery('simu nzuri chini ya 20,000 KES', ctx, { apiKey: '', model: 'm' });
    expect(r.source).toBe('rules');
  });

  it('calls messages.parse with structured output, low effort and a cached system prompt', async () => {
    const { client, parse } = fakeClient({ keywords: 'smartphone', category_hint: 'phones', max_price: 20000, currency: 'kes', max_days: null });
    const r = await understandWithAi('simu nzuri chini ya 20,000 KES', ctx, { apiKey: 'k', model: 'claude-haiku-5-5', client });
    expect(r).toEqual({ keywords: 'smartphone', category_hint: 'phones', max_price: 20000, currency: 'KES', max_days: null, source: 'ai' });
    const req = (parse.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.output_config.effort).toBe('low');
    expect(req.output_config.format).toBeTruthy();
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.tool_choice).toBeUndefined();
    expect(req.messages[0].content).toContain('Shopper currency: KES');
  });

  it('rejects unknown category slugs from the AI', async () => {
    const { client } = fakeClient({ keywords: 'x', category_hint: 'spaceships', max_price: null, currency: null, max_days: null });
    const r = await understandWithAi('x', ctx, { apiKey: 'k', model: 'm', client });
    expect(r.category_hint).toBeNull();
  });

  it('falls back to rules on API errors and refusals', async () => {
    const failing = fakeClient(null, { fail: true });
    const r1 = await understandQuery('earbuds under 3000 bob', ctx, { apiKey: 'k', model: 'm', client: failing.client });
    expect(r1).toMatchObject({ source: 'rules', max_price: 3000, currency: 'KES' });
    const refused = fakeClient(null, { stop_reason: 'refusal' });
    const r2 = await understandQuery('earbuds under 4000 bob', ctx, { apiKey: 'k', model: 'm', client: refused.client });
    expect(r2).toMatchObject({ source: 'rules', max_price: 4000 });
  });
});
