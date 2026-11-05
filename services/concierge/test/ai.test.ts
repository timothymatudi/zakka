import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicSupport, type SupportContext } from '../src/ai/support';

/** Fake SDK client: replays scripted responses and records requests (no network). */
function fakeClient(responses: unknown[]) {
  const requests: Record<string, unknown>[] = [];
  const client = { beta: { messages: { create: async (req: Record<string, unknown>) => {
    requests.push(structuredClone(req));
    const r = responses.shift();
    if (!r) throw new Error('no scripted response');
    return r;
  } } } };
  return { client: client as unknown as Anthropic, requests };
}

const ctx: SupportContext = {
  question: 'Is my order on the way?', locale: 'sw', country: 'KE', products: [],
  orders: [{ ref: 'ZK-ABCD1234', status: 'imesafirishwa', total: 'KES 2,257', created_at: '2026-11-01', items: ['Mini Earbuds'], tracking_url: 'https://t.example/1' }],
};

describe('AnthropicSupport tool loop', () => {
  it('runs a lookup tool, then returns the reply_to_customer answer', async () => {
    const { client, requests } = fakeClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_order', input: { order_ref: 'zk-abcd1234' } }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'reply_to_customer', input: { reply: 'Oda ZK-ABCD1234 imesafirishwa.', handoff: false, reason: '' } }] },
    ]);
    const ai = new AnthropicSupport('k', 'claude-sonnet-5-5', client);
    const ans = await ai.answer(ctx);
    expect(ans).toEqual({ reply: 'Oda ZK-ABCD1234 imesafirishwa.', handoff: false, reason: undefined });
    expect(requests).toHaveLength(2);
    const second = requests[1]!;
    expect(second.model).toBe('claude-sonnet-5-5');
    expect(second.fallbacks).toBe('default');
    expect(second.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(JSON.stringify(second.messages)).toContain('imesafirishwa'); // tool result grounded in order data
    expect((second.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(second.tool_choice).toBeUndefined(); // forced tool_choice is rejected on current models
  });

  it('hands off on refusal and on API errors', async () => {
    const refused = new AnthropicSupport('k', 'claude-sonnet-5-5', fakeClient([{ stop_reason: 'refusal', stop_details: { category: 'general_harms' }, content: [] }]).client);
    expect(await refused.answer(ctx)).toMatchObject({ handoff: true, reason: 'refusal:general_harms' });
    const broken = new AnthropicSupport('k', 'claude-sonnet-5-5', fakeClient([]).client);
    expect(await broken.answer(ctx)).toMatchObject({ handoff: true, reason: 'ai_error' });
  });

  it('omits fallbacks for models that do not support them', async () => {
    const { client, requests } = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] }]);
    await new AnthropicSupport('k', 'claude-haiku-5-5', client).answer(ctx);
    expect(requests[0]!.fallbacks).toBeUndefined();
  });
});
