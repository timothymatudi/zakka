import { mockConfig } from '../src/config';
import { buildApp } from '../src/server';
import { MemoryStore } from '../src/store/memory';
import { MockWhatsAppClient, renderText } from '../src/whatsapp/client';
import { inboundPayload } from '../src/whatsapp/payloads';
import { signPayload } from '../src/whatsapp/signature';

export const APP_SECRET = 'test-app-secret';
export const ADDRESS = 'Amina Wanjiru\nKenyatta Ave 12\nApt 4B\nNairobi\nNairobi County\n00100';

process.env.CONCIERGE_SILENT = '1';

export async function makeApp(opts: { now?: () => Date } = {}) {
  const config = mockConfig({
    offline: true,
    whatsapp: { phoneNumberId: '', accessToken: '', verifyToken: 'verify-me', appSecret: APP_SECRET, graphVersion: 'v23.0' },
  });
  const store = new MemoryStore();
  const wa = new MockWhatsAppClient();
  const built = await buildApp(config, { store, whatsapp: wa, now: opts.now });

  async function send(phone: string, msg: Parameters<typeof inboundPayload>[1], o: Parameters<typeof inboundPayload>[2] = {}) {
    const body = JSON.stringify(inboundPayload(phone, msg, o));
    const res = await built.app.inject({
      method: 'POST', url: '/webhooks/whatsapp', payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(body, APP_SECRET) },
    });
    await built.idle();
    return res;
  }
  const lastText = () => { const m = wa.outbox.at(-1)?.message; return m ? renderText(m) : ''; };
  const conv = async (phone: string) => {
    const c = await store.getOrCreateCustomer(phone, { country_code: null, locale: null });
    return { customer: c, conv: (await store.getConversationByCustomer(c.id))! };
  };
  /** Buy now -> send address -> confirm (state ends in awaiting_payment, last message is the payment link). */
  async function buyWithAddress(phone: string, o: Parameters<typeof inboundPayload>[2] = {}) {
    await send(phone, { buttonReply: { id: 'buy', title: 'Buy now' } }, o);
    await send(phone, { text: ADDRESS }, o);
    await send(phone, { buttonReply: { id: 'addr_ok', title: 'Yes' } }, o);
  }
  return { ...built, config, store, wa, send, lastText, conv, buyWithAddress };
}
