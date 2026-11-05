import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { AnthropicSupport } from '../src/ai/support';
import { mentionsPartner, PARTNER_NAMES, scrubPartnerNames } from '../src/brand-safety';
import type { SearchClient } from '../src/clients/services';
import { FIXTURE_DOCS, fixtureSearch } from '../src/fixtures/products';
import { MESSAGES } from '../src/lang/messages';
import { LOCALES, type SearchDocument } from '../src/shared';
import { TEMPLATES } from '../src/templates/registry';
import type { Outbound } from '../src/whatsapp/client';
import { ADDRESS, makeApp } from './helpers';

/** Everything the customer can read in a message (button URLs are not shown as text). */
function visibleText(m: Outbound): string {
  switch (m.kind) {
    case 'text': return m.body.replace(/https?:\/\/\S+/g, '');
    case 'list': return [m.header, m.body, m.footer, m.button, ...m.rows.flatMap((r) => [r.title, r.description])].join('\n');
    case 'buttons': return [m.body, m.footer, ...m.buttons.map((b) => b.title)].join('\n');
    case 'cta_url': return [m.body, m.footer, m.displayText].join('\n');
    case 'template': return m.bodyParams.join('\n');
  }
}

describe('partner-name matcher', () => {
  it('matches names as whole words only', () => {
    for (const n of PARTNER_NAMES) expect(mentionsPartner(`buy at ${n} today`), n).toBe(true);
    expect(mentionsPartner('Ships via ALIEXPRESS')).toBe(true);
    expect(mentionsPartner('good afternoon, shipped with DHL')).toBe(false);
    expect(scrubPartnerNames('It ships from AliExpress.')).toBe('It ships from a partner store.');
  });
});

describe('no partner names in static copy', () => {
  it('message catalogue (all 10 locales)', () => {
    for (const l of LOCALES) for (const [k, v] of Object.entries(MESSAGES[l])) expect(mentionsPartner(v), `${l}.${k}: ${v}`).toBe(false);
  });
  it('WhatsApp templates and their examples (all 10 locales)', () => {
    for (const def of Object.values(TEMPLATES)) {
      for (const v of def.variables) expect(mentionsPartner(v.example), `${def.name}.${v.name}`).toBe(false);
      expect(mentionsPartner(def.buttonUrlExample)).toBe(false);
      for (const l of LOCALES) {
        const tr = def.translations[l];
        expect(mentionsPartner(tr.body) || mentionsPartner(tr.button), `${def.name}/${l}`).toBe(false);
      }
    }
  });
});

describe('no partner names in any outgoing WhatsApp message', () => {
  let t: Awaited<ReturnType<typeof makeApp>> | undefined;
  afterEach(async () => { await t?.app.close(); });

  // Fixtures (Jumia/Amazon/Temu/CJ/AliExpress offers) plus a hit whose title carries a partner house brand.
  const branded: SearchDocument = {
    ...FIXTURE_DOCS[0]!, id: '0b4a8c1e-1111-4a6f-9a10-0000000000aa', title: 'Amazon Basics Wireless Earbuds',
    offers: FIXTURE_DOCS[0]!.offers.map((o) => ({ ...o, display_price_local: 3095, currency: 'KES' })),
  };
  // Temu affiliate offer that ships everywhere, so every tested country sees an affiliate row.
  const temu = { ...FIXTURE_DOCS[5]!, offers: FIXTURE_DOCS[5]!.offers.map((o) => ({ ...o, display_price_local: 899, currency: 'KES' })) };
  const search: SearchClient = { search: async ({ q, country }) => ({ hits: [branded, temu, ...fixtureSearch(q, country, 4)], fixture: true }) };

  it.each(['+254712345678', '+12125551234', '+34612345678', '+971501234567'])('full flow for %s', async (phone) => {
    t = await makeApp({ search });
    await t.send(phone, { text: 'hi' });
    await t.send(phone, { text: 'earbuds' });
    let { conv } = await t.conv(phone);
    const results = conv.context.results!;
    expect(results.some((r) => r.kind === 'affiliate')).toBe(true);
    const aff = results.findIndex((r) => r.kind === 'affiliate');
    await t.send(phone, { listReply: { id: `pick:${aff}`, title: 'x' } });
    const drop = results.findIndex((r) => r.kind === 'dropship');
    await t.send(phone, { listReply: { id: `pick:${drop}`, title: 'x' } });
    await t.send(phone, { buttonReply: { id: 'buy', title: 'x' } });
    await t.send(phone, { text: ADDRESS });
    await t.send(phone, { buttonReply: { id: 'addr_ok', title: 'x' } });
    ({ conv } = await t.conv(phone));
    const url = new URL((t.wa.outbox.at(-1)!.message as { url: string }).url);
    await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
    await t.send(phone, { text: 'where is my order?' });
    await t.app.inject({ method: 'POST', url: `/internal/orders/${conv.context.order_id}/notify`, payload: { status: 'in_transit', carrier: 'DHL', tracking_number: 'JD1' } });
    await t.send(phone, { text: 'my item arrived broken' });

    expect(t.wa.outbox.length).toBeGreaterThan(8);
    for (const s of t.wa.outbox) {
      const text = visibleText(s.message);
      expect(mentionsPartner(text), text).toBe(false);
    }
    const all = t.wa.outbox.map((s) => visibleText(s.message)).join('\n');
    expect(all).toContain('DHL'); // carriers are allowed
    expect(all).toContain('Basics Wireless Earbuds'); // house brand stripped from the title
  });
});

describe('AI support replies', () => {
  it('scrubs partner names even if the model names one', async () => {
    const client = { beta: { messages: { create: async () => ({ stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 't', name: 'reply_to_customer', input: { reply: 'Your earbuds ship from our AliExpress warehouse via DHL.', handoff: false, reason: '' } },
    ] }) } } } as unknown as Anthropic;
    const ans = await new AnthropicSupport('k', 'claude-sonnet-5-5', client).answer({ question: 'where?', locale: 'en', country: 'KE', orders: [], products: [] });
    expect(mentionsPartner(ans.reply)).toBe(false);
    expect(ans.reply).toContain('DHL');
  });
});
