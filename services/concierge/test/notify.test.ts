import { afterEach, describe, expect, it } from 'vitest';
import { makeApp } from './helpers';

const H = 60 * 60 * 1000;
const phone = '+12125551234'; // US number: English default locale

/** Runs search -> pick -> address -> pay so a forwarded order exists. */
async function paidOrder(t: Awaited<ReturnType<typeof makeApp>>, at: () => { timestamp: Date }) {
  await t.send(phone, { text: 'smartwatch' }, at());
  await t.send(phone, { listReply: { id: 'pick:0', title: 'x' } }, at());
  await t.buyWithAddress(phone, at());
  const { conv } = await t.conv(phone);
  const orderId = conv.context.order_id!;
  const url = new URL((t.wa.outbox.at(-1)!.message as { url: string }).url);
  await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
  return orderId;
}

describe('POST /internal/orders/:id/notify', () => {
  let t: Awaited<ReturnType<typeof makeApp>> | undefined;
  afterEach(async () => { await t?.app.close(); });
  let clock: Date;
  const setup = async () => {
    clock = new Date('2026-11-01T10:00:00Z');
    t = await makeApp({ now: () => clock });
    const orderId = await paidOrder(t, () => ({ timestamp: clock }));
    const notify = (body: Record<string, unknown>, id = orderId) =>
      t!.app.inject({ method: 'POST', url: `/internal/orders/${id}/notify`, payload: body });
    return { orderId, notify };
  };

  it('does not message on pending', async () => {
    const { notify } = await setup();
    const before = t!.wa.outbox.length;
    const res = await notify({ status: 'pending', carrier: 'DHL' });
    expect(res.json()).toEqual({ sent: false, reason: 'pending' });
    expect(t!.wa.outbox.length).toBe(before);
  });

  it('in_transit inside the window: free-form text using the posted carrier, tracking number, URL and event', async () => {
    const { notify } = await setup();
    const res = await notify({ status: 'in_transit', carrier: 'DHL', tracking_number: 'JD0146', tracking_url: 'https://track.example/JD0146', last_event: 'Departed Shenzhen hub' });
    expect(res.json()).toMatchObject({ sent: true, mode: 'freeform', template: 'shipping_update' });
    const text = t!.lastText();
    expect(text).toContain('shipped');
    expect(text).toContain('DHL JD0146');
    expect(text).toContain('Departed Shenzhen hub');
    expect(text).toContain('https://track.example/JD0146');
  });

  it('in_transit outside the window: shipping_update template with carrier and tracking number', async () => {
    const { orderId, notify } = await setup();
    clock = new Date(clock.getTime() + 30 * H);
    await notify({ status: 'in_transit', carrier: 'Aramex', tracking_number: 'AX99' });
    expect(t!.wa.outbox.at(-1)!.message).toMatchObject({
      kind: 'template', name: 'shipping_update', bodyParams: [expect.stringMatching(/^ZK-/), 'Aramex', 'AX99'], buttonUrlParam: orderId,
    });
  });

  it('delivered outside the window: delivery_update template', async () => {
    const { notify } = await setup();
    clock = new Date(clock.getTime() + 72 * H);
    const res = await notify({ status: 'delivered', last_event: 'Signed by A. Wanjiru' });
    expect(res.json()).toMatchObject({ sent: true, mode: 'template', template: 'delivery_update' });
    expect(t!.wa.outbox.at(-1)!.message).toMatchObject({ kind: 'template', name: 'delivery_update', bodyParams: [expect.stringMatching(/^ZK-/), 'delivered', 'Signed by A. Wanjiru'] });
  });

  it('exception uses delivery_update with the localized problem label', async () => {
    const { notify } = await setup();
    clock = new Date(clock.getTime() + 30 * H);
    await notify({ status: 'exception', last_event: 'Address not found' });
    expect(t!.wa.outbox.at(-1)!.message).toMatchObject({ name: 'delivery_update', bodyParams: [expect.any(String), 'delivery problem, our team is on it', 'Address not found'] });
  });

  it('falls back to the stored shipment and order when the body has no fields', async () => {
    const { orderId, notify } = await setup();
    t!.store.tracking.set(orderId, [{ carrier: 'UPS', tracking_number: '1Z999', tracking_url: 'https://ups.example/1Z999', status: 'in_transit', last_event: 'Arrived at facility' }]);
    await t!.store.updateOrder(orderId, { status: 'shipped' });
    const res = await notify({});
    expect(res.json()).toMatchObject({ sent: true, template: 'shipping_update' });
    expect(t!.lastText()).toContain('UPS 1Z999');
    expect(t!.lastText()).toContain('https://ups.example/1Z999');
  });

  it('with no body status and nothing shipped yet, it treats the order as pending', async () => {
    const { notify } = await setup();
    expect((await notify({})).json()).toEqual({ sent: false, reason: 'pending' });
  });

  it('rejects unknown statuses and unknown orders', async () => {
    const { notify } = await setup();
    expect((await notify({ status: 'lost_in_space' })).statusCode).toBe(400);
    expect((await notify({ status: 'delivered' }, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });
});
