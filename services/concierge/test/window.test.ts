import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory';
import { MockWhatsAppClient } from '../src/whatsapp/client';
import { Messenger, NotOptedInError, WindowClosedError } from '../src/whatsapp/messenger';
import { isWithinServiceWindow, SERVICE_WINDOW_MS, windowRemainingMs } from '../src/whatsapp/window';
import { makeApp } from './helpers';

const H = 60 * 60 * 1000;

describe('24-hour customer service window', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('is open right after an inbound message and just before 24h', () => {
    expect(isWithinServiceWindow(new Date(now.getTime() - 1000).toISOString(), now)).toBe(true);
    expect(isWithinServiceWindow(new Date(now.getTime() - SERVICE_WINDOW_MS + 1).toISOString(), now)).toBe(true);
  });
  it('is closed at exactly 24h and after', () => {
    expect(isWithinServiceWindow(new Date(now.getTime() - SERVICE_WINDOW_MS).toISOString(), now)).toBe(false);
    expect(isWithinServiceWindow(new Date(now.getTime() - 25 * H).toISOString(), now)).toBe(false);
  });
  it('is closed when the user never wrote, or the timestamp is invalid', () => {
    expect(isWithinServiceWindow(null, now)).toBe(false);
    expect(isWithinServiceWindow('not a date', now)).toBe(false);
  });
  it('reports remaining time', () => {
    expect(windowRemainingMs(new Date(now.getTime() - 23 * H).toISOString(), now)).toBe(H);
    expect(windowRemainingMs(new Date(now.getTime() - 30 * H).toISOString(), now)).toBe(0);
  });
});

describe('Messenger enforcement', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const setup = async (lastInboundHoursAgo: number | null, optIn = false) => {
    const store = new MemoryStore();
    const wa = new MockWhatsAppClient();
    const m = new Messenger(wa, store, () => now);
    const customer = await store.getOrCreateCustomer('+254700000001', { country_code: 'KE', locale: 'en' });
    if (optIn) await store.updateCustomer(customer.id, { whatsapp_opt_in: true });
    const conv = await store.getOrCreateConversation('254700000001', customer.id);
    conv.last_inbound_at = lastInboundHoursAgo === null ? null : new Date(now.getTime() - lastInboundHoursAgo * H).toISOString();
    return { store, wa, m, conv, customer: (await store.getCustomer(customer.id))! };
  };

  it('sends free-form inside the window and records it', async () => {
    const { m, wa, store, conv } = await setup(2);
    await m.send(conv, { kind: 'text', body: 'hi' });
    expect(wa.outbox).toHaveLength(1);
    expect((await store.listMessages(conv.id))[0]).toMatchObject({ direction: 'out', type: 'text', body: 'hi' });
  });
  it('refuses free-form outside the window', async () => {
    const { m, wa, conv } = await setup(25);
    await expect(m.send(conv, { kind: 'text', body: 'hi' })).rejects.toBeInstanceOf(WindowClosedError);
    expect(wa.outbox).toHaveLength(0);
  });
  it('falls back to an approved utility template outside the window', async () => {
    const { m, wa, conv, customer } = await setup(48);
    const mode = await m.sendOrTemplate(conv, customer, { kind: 'text', body: 'paid!' },
      { name: 'order_confirmation', locale: 'sw', params: ['ZK-1', 'KES 100', 'siku 5-9'], buttonUrlParam: 'abc' });
    expect(mode).toBe('template');
    expect(wa.outbox[0]!.message).toMatchObject({ kind: 'template', name: 'order_confirmation', language: 'sw', bodyParams: ['ZK-1', 'KES 100', 'siku 5-9'] });
  });
  it('marketing templates require opt-in even inside the window', async () => {
    const { m, conv, customer } = await setup(1, false);
    await expect(m.sendTemplate(conv, customer, 'weekly_deals', 'en', ['x'], 'y')).rejects.toBeInstanceOf(NotOptedInError);
    const ok = await setup(1, true);
    await expect(ok.m.sendTemplate(ok.conv, ok.customer, 'weekly_deals', 'en', ['x'], 'y')).resolves.toMatch(/^wamid/);
  });
});

describe('payment confirmation after the window closed', () => {
  let t: Awaited<ReturnType<typeof makeApp>> | undefined;
  afterEach(async () => { await t?.app.close(); });

  it('uses the order_confirmation template when the user paid >24h after their last message', async () => {
    let clock = new Date('2026-11-01T10:00:00Z');
    t = await makeApp({ now: () => clock });
    const phone = '+2348031234567';
    const at = (min: number) => ({ timestamp: new Date(clock.getTime() + min * 60_000) });
    await t.send(phone, { text: 'smartwatch' }, at(0));
    await t.send(phone, { listReply: { id: 'pick:0', title: 'x' } }, at(1));
    await t.buyWithAddress(phone, at(2));
    const url = new URL((t.wa.outbox.at(-1)!.message as { url: string }).url);
    expect(url.pathname).toContain('/mock-pay/paystack/');

    clock = new Date(clock.getTime() + 26 * H);
    const res = await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
    expect(res.json()).toMatchObject({ ok: true });
    expect(t.wa.outbox.at(-1)!.message).toMatchObject({ kind: 'template', name: 'order_confirmation' });
  });
});
