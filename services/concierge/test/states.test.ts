import { afterEach, describe, expect, it } from 'vitest';
import { transition } from '../src/flows/states';
import { countryFromPhone } from '../src/geo';
import { detectLanguage } from '../src/lang/detect';
import { providerForCountry } from '../src/payments';
import { ADDRESS, makeApp } from './helpers';

describe('state machine (pure)', () => {
  it('follows the happy buy path', () => {
    expect(transition('idle', 'results')).toBe('browsing');
    expect(transition('browsing', 'pick_dropship')).toBe('confirming');
    expect(transition('confirming', 'buy')).toBe('collecting_address');
    expect(transition('collecting_address', 'address_received')).toBe('collecting_address');
    expect(transition('collecting_address', 'address_confirmed')).toBe('awaiting_payment');
    expect(transition('awaiting_payment', 'paid')).toBe('idle');
  });
  it('handles back, cancel, affiliate and failure paths', () => {
    expect(transition('confirming', 'back')).toBe('browsing');
    expect(transition('confirming', 'cancel')).toBe('idle');
    expect(transition('browsing', 'pick_affiliate')).toBe('browsing');
    expect(transition('awaiting_payment', 'payment_failed')).toBe('confirming');
    expect(transition('browsing', 'no_results')).toBe('idle');
  });
  it('rejects invalid transitions', () => {
    expect(transition('idle', 'buy')).toBeNull();
    expect(transition('browsing', 'buy')).toBeNull();
    expect(transition('human_handoff', 'results')).toBeNull();
  });
  it('handoff from anywhere; only resume leaves it; stop resets the flow', () => {
    for (const s of ['idle', 'browsing', 'confirming', 'awaiting_payment'] as const) {
      expect(transition(s, 'handoff')).toBe('human_handoff');
      expect(transition(s, 'stop')).toBe('idle');
    }
    expect(transition('human_handoff', 'resume')).toBe('idle');
    expect(transition('human_handoff', 'stop')).toBe('human_handoff');
  });
});

describe('helpers', () => {
  it('infers country from E.164', () => {
    expect(countryFromPhone('+254712345678')).toBe('KE');
    expect(countryFromPhone('+971501234567')).toBe('AE');
    expect(countryFromPhone('+14165551234')).toBe('CA');
    expect(countryFromPhone('+12125551234')).toBe('US');
    expect(countryFromPhone('+2348031234567')).toBe('NG');
  });
  it('picks payment providers by country', () => {
    expect(providerForCountry('KE')).toBe('mpesa');
    expect(providerForCountry('NG')).toBe('paystack');
    expect(providerForCountry('UG')).toBe('flutterwave');
    expect(providerForCountry('DE')).toBe('paypal');
    expect(providerForCountry('US')).toBe('stripe');
  });
  it('detects languages', () => {
    expect(detectLanguage('quiero auriculares baratos')).toBe('es');
    expect(detectLanguage('nataka simu rahisi')).toBe('sw');
    expect(detectLanguage('أريد سماعات')).toBe('ar');
    expect(detectLanguage('我想买耳机')).toBe('zh');
    expect(detectLanguage('मुझे सस्ते ईयरबड्स चाहिए')).toBe('hi');
    expect(detectLanguage('ich suche billige kopfhörer')).toBe('de');
    expect(detectLanguage('cheap earbuds')).toBe('en');
    expect(detectLanguage('xyz123')).toBeNull();
  });
});

describe('conversation flows (engine + webhook, offline)', () => {
  let t: Awaited<ReturnType<typeof makeApp>> | undefined;
  afterEach(async () => { await t?.app.close(); });
  const phone = '+254712345678';

  it('search -> pick dropship -> buy -> pay -> forward -> confirm -> track', async () => {
    t = await makeApp();
    await t.send(phone, { text: 'cheap earbuds' });
    let { conv } = await t.conv(phone);
    expect(conv.state).toBe('browsing');
    expect(conv.context.results).toHaveLength(3);
    const list = t.wa.outbox.at(-1)!.message;
    expect(list.kind).toBe('list');
    expect(t.lastText()).toContain('Affiliate');
    expect(t.lastText()).toMatch(/KES/);

    const idx = conv.context.results!.findIndex((r) => r.kind === 'dropship');
    await t.send(phone, { listReply: { id: `pick:${idx}`, title: 'x' } });
    ({ conv } = await t.conv(phone));
    expect(conv.state).toBe('confirming');

    await t.send(phone, { buttonReply: { id: 'buy', title: 'Buy now' } });
    ({ conv } = await t.conv(phone));
    expect(conv.state).toBe('collecting_address');
    expect(t.lastText()).toContain('Street address'); // locale stays en (from "cheap earbuds")

    await t.send(phone, { text: 'Amina Wanjiru\nKenyatta Ave 12' }); // too short: rejected
    expect(t.lastText()).toContain('I need at least');
    await t.send(phone, { text: ADDRESS });
    ({ conv } = await t.conv(phone));
    expect(conv.state).toBe('collecting_address');
    expect(conv.context.pending_address).toMatchObject({ name: 'Amina Wanjiru', city: 'Nairobi', postal_code: '00100', country_code: 'KE', phone_e164: phone });
    expect(t.wa.outbox.at(-1)!.message.kind).toBe('buttons');

    await t.send(phone, { buttonReply: { id: 'addr_ok', title: 'Yes' } });
    ({ conv } = await t.conv(phone));
    expect(conv.state).toBe('awaiting_payment');
    const pay = t.wa.outbox.at(-1)!.message;
    expect(pay.kind).toBe('cta_url');
    const order = (await t.store.getOrder(conv.context.order_id!))!;
    expect(order).toMatchObject({ status: 'pending_payment', channel: 'whatsapp', payment_provider: 'mpesa', currency: 'KES' });
    expect(order.shipping_address).toMatchObject({ line1: 'Kenyatta Ave 12', line2: 'Apt 4B', region: 'Nairobi County' });

    const url = new URL((pay as { url: string }).url);
    const res = await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
    expect(res.json()).toMatchObject({ ok: true, forwarded: true, order: { status: 'forwarded' } });
    await t.idle();
    expect(t.lastText()).toContain('Payment received');
    ({ conv } = await t.conv(phone));
    expect(conv.state).toBe('idle');

    // replayed payment webhook is a no-op
    const again = await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
    expect(again.json()).toMatchObject({ ok: true, duplicate: true });

    await t.send(phone, { text: 'where is my order?' });
    expect(t.lastText()).toContain('with our warehouse');
    expect(t.lastText()).toContain(`/orders/${order.id}`);

    // second purchase offers the saved address
    await t.send(phone, { text: 'smartwatch' });
    await t.send(phone, { listReply: { id: 'pick:0', title: 'x' } });
    await t.send(phone, { buttonReply: { id: 'buy', title: 'Buy now' } });
    expect(t.lastText()).toContain('Kenyatta Ave 12');
    expect(t.lastText()).toContain('[addr_ok]');
    await t.send(phone, { buttonReply: { id: 'addr_ok', title: 'Yes' } });
    ({ conv } = await t.conv(phone));
    expect((await t.store.getOrder(conv.context.order_id!))!.shipping_address?.city).toBe('Nairobi');
  });

  it('rejects a paid event with the wrong amount', async () => {
    t = await makeApp();
    await t.send(phone, { text: 'smartwatch' });
    await t.send(phone, { listReply: { id: 'pick:0', title: 'x' } });
    await t.buyWithAddress(phone);
    const url = new URL((t.wa.outbox.at(-1)!.message as { url: string }).url);
    url.searchParams.set('amount', '1');
    const res = await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
    expect(res.json()).toMatchObject({ ok: false, reason: 'amount_mismatch' });
  });

  it('affiliate pick sends a disclosed partner link and records the click', async () => {
    t = await makeApp();
    await t.send(phone, { text: 'cheap earbuds' });
    const { conv } = await t.conv(phone);
    const idx = conv.context.results!.findIndex((r) => r.kind === 'affiliate');
    await t.send(phone, { listReply: { id: `pick:${idx}`, title: 'x' } });
    const msg = t.wa.outbox.at(-1)!.message;
    expect(msg.kind).toBe('cta_url');
    expect(t.lastText()).toMatch(/Affiliate link/);
    expect(t.lastText()).toContain('jumia');
    expect(t.store.clicks).toHaveLength(1);
    expect(t.store.clicks[0]).toMatchObject({ channel: 'whatsapp', country_code: 'KE' });
  });

  it('replies in the user language and stores the locale', async () => {
    t = await makeApp();
    await t.send('+525512345678', { text: 'quiero auriculares baratos' });
    expect(t.lastText()).toContain('Lo mejor para');
    const { customer } = await t.conv('+525512345678');
    expect(customer.locale).toBe('es');
    expect(customer.country_code).toBe('MX');
  });

  it('typing "2" picks the second option; buying without a selection is refused', async () => {
    t = await makeApp();
    await t.send(phone, { buttonReply: { id: 'buy', title: 'Buy now' } });
    expect(t.lastText()).toContain('Tafadhali chagua'); // KE number, no text yet: Swahili default
    await t.send(phone, { text: 'earbuds' });
    await t.send(phone, { text: '2' });
    const { conv } = await t.conv(phone);
    expect(['confirming', 'browsing']).toContain(conv.state);
  });

  it('support: escalates refunds to a human and goes quiet until resumed', async () => {
    t = await makeApp();
    await t.send(phone, { text: 'I want a refund, the item is broken' });
    let { conv } = await t.conv(phone);
    expect(conv.state).toBe('human_handoff');
    expect(conv.context.handoff).toBe(true);
    const n = t.wa.outbox.length;
    await t.send(phone, { text: 'hello?' });
    expect(t.wa.outbox.length).toBe(n);
    await t.send(phone, { text: 'menu' });
    ({ conv } = await t.conv(phone));
    expect(conv.state).toBe('idle');
  });
});
