import { afterEach, describe, expect, it } from 'vitest';
import { isStart, isStop } from '../src/flows/intents';
import { makeApp } from './helpers';

describe('STOP / START keywords', () => {
  it.each(['STOP', 'stop', ' Stop. ', 'UNSUBSCRIBE', 'opt out', 'baja', 'arrêt', 'parar', 'توقف', '退订', 'रोकें', 'acha', 'jiondoe', 'stopp', 'abmelden', 'berhenti'])(
    'recognises %s', (w) => expect(isStop(w)).toBe(true));
  it.each(['stop light', 'non stop earbuds', 'where is my order', 'unsubscribe me from nothing please buy'])(
    'does not treat "%s" as STOP', (w) => expect(isStop(w)).toBe(false));
  it('recognises START variants', () => {
    for (const w of ['START', 'subscribe', 'anza', 'mulai', '订阅']) expect(isStart(w)).toBe(true);
  });
});

describe('opt-out flow', () => {
  let t: Awaited<ReturnType<typeof makeApp>> | undefined;
  afterEach(async () => { await t?.app.close(); });
  const phone = '+12125551234'; // US number: English default locale

  it('STOP opts out, confirms, resets the flow and blocks marketing; START re-enables', async () => {
    t = await makeApp();
    await t.send(phone, { text: 'START' });
    let { customer } = await t.conv(phone);
    expect(customer.whatsapp_opt_in).toBe(true);
    expect(customer.whatsapp_opt_in_at).toBeTruthy();

    expect(await t.concierge.sendMarketing(customer.id, 'weekly_deals', ['Earbuds from KES 1,999'], 'wa_weekly')).toEqual({ sent: true });
    expect(t.wa.outbox.at(-1)!.message).toMatchObject({ kind: 'template', name: 'weekly_deals', language: 'en' });

    await t.send(phone, { text: 'earbuds' });
    await t.send(phone, { text: 'STOP' });
    let conv;
    ({ customer, conv } = await t.conv(phone));
    expect(customer.whatsapp_opt_in).toBe(false);
    expect(customer.marketing_opt_in).toBe(false);
    expect(conv.state).toBe('idle');
    expect(conv.context.results).toBeUndefined();
    expect(t.lastText()).toContain("You're unsubscribed");

    const before = t.wa.outbox.length;
    expect(await t.concierge.sendMarketing(customer.id, 'price_drop_alert', ['Earbuds', 'KES 1,999', 'KES 2,499', 'Kenya'], 'p1'))
      .toEqual({ sent: false, reason: 'not_opted_in' });
    expect(t.wa.outbox.length).toBe(before);

    await t.send(phone, { text: 'START' });
    ({ customer } = await t.conv(phone));
    expect(customer.whatsapp_opt_in).toBe(true);
  });

  it('confirms STOP in the user language', async () => {
    t = await makeApp();
    await t.send('+34612345678', { text: 'hola quiero auriculares' });
    await t.send('+34612345678', { text: 'BAJA' });
    expect(t.lastText()).toContain('Te has dado de baja');
  });

  it('STOP works even during a human hand-off', async () => {
    t = await makeApp();
    await t.send(phone, { text: 'talk to a human agent' });
    await t.send(phone, { text: 'stop' });
    const { customer } = await t.conv(phone);
    expect(customer.whatsapp_opt_in).toBe(false);
    expect(t.lastText()).toContain('unsubscribed');
  });
});
