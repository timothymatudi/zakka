import { afterEach, describe, expect, it, vi } from 'vitest';
import { MpesaProvider } from '../src/payments/mpesa';
import { WebhookSignatureError } from '../src/payments/types';
import { makeApp } from './helpers';

const RETURN = 'http://localhost:3000/checkout/done?order=web-1';
const CANCEL = 'http://localhost:3000/cart';
const webOrder = (over: Record<string, unknown> = {}) => ({
  id: '11111111-2222-4333-8444-555555555555', customer_id: null, status: 'pending_payment', currency: 'KES',
  subtotal: 3095, shipping: 0, tax: 0, total: 3095, total_usd: 23.99, channel: 'web',
  shipping_address: { name: 'Amina Wanjiru', phone_e164: '+254712345678', line1: 'Kenyatta Ave 12', line2: null, city: 'Nairobi', region: null, postal_code: '00100', country_code: 'KE' },
  ...over,
});

describe('POST /internal/payments/checkout', () => {
  let t: Awaited<ReturnType<typeof makeApp>> | undefined;
  afterEach(async () => { await t?.app.close(); vi.unstubAllGlobals(); });
  const checkout = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    t!.app.inject({ method: 'POST', url: '/internal/payments/checkout', payload: body, headers });

  it('web order (sent as fallback object): picks provider by country, pays via mock-pay, forwards, redirects to return_url, no WhatsApp', async () => {
    t = await makeApp();
    const order = webOrder();
    const res = await checkout({ order_id: order.id, return_url: RETURN, cancel_url: CANCEL, order });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['payment_ref', 'payment_url', 'provider']);
    expect(body.provider).toBe('mpesa'); // KE from shipping_address
    expect(body.payment_ref).toMatch(/^mock_mpesa_/);
    expect(body.payment_url).toContain(`/mock-pay/mpesa/${body.payment_ref}`);
    expect(await t.store.getOrder(order.id)).toMatchObject({ payment_provider: 'mpesa', payment_ref: body.payment_ref, channel: 'web' });

    const url = new URL(body.payment_url);
    expect(url.searchParams.get('return')).toBe(RETURN);
    const page = await t.app.inject({ method: 'GET', url: url.pathname + url.search });
    expect(page.body).toContain(`href="${CANCEL}"`);
    const paid = await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'text/html' } });
    expect(paid.statusCode).toBe(303);
    expect(paid.headers.location).toBe(RETURN);
    expect((await t.store.getOrder(order.id))!.status).toBe('forwarded');
    expect(t.wa.outbox).toHaveLength(0); // web customer without a WhatsApp conversation
  });

  it('store-backed order with an explicit provider (stripe); JSON pay returns return_url', async () => {
    t = await makeApp();
    const o = await t.store.createOrder({
      customer_id: null, status: 'pending_payment', currency: 'USD', subtotal: 20, shipping: 0, tax: 0, total: 20, total_usd: 20,
      payment_provider: null, payment_ref: null, channel: 'web', shipping_address: null,
    }, []);
    const res = await checkout({ order_id: o.id, provider: 'stripe', return_url: RETURN, cancel_url: CANCEL });
    expect(res.json()).toMatchObject({ provider: 'stripe' });
    const url = new URL(res.json().payment_url);
    const paid = await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
    expect(paid.json()).toMatchObject({ ok: true, forwarded: true, return_url: RETURN });
  });

  it('M-Pesa (mock): KES only', async () => {
    t = await makeApp();
    const ok = await checkout({ order_id: webOrder().id, provider: 'mpesa', return_url: RETURN, cancel_url: CANCEL, order: webOrder() });
    expect(ok.json()).toMatchObject({ provider: 'mpesa', payment_ref: expect.stringMatching(/^mock_mpesa_/) });
    const usd = webOrder({ id: '11111111-2222-4333-8444-666666666666', currency: 'USD', total: 23.99 });
    const bad = await checkout({ order_id: usd.id, provider: 'mpesa', return_url: RETURN, cancel_url: CANCEL, order: usd });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('mpesa cannot charge USD');
  });

  it('sends the WhatsApp confirmation when the web customer has a WhatsApp conversation', async () => {
    t = await makeApp();
    await t.send('+254712345678', { text: 'hello' });
    const { customer } = await t.conv('+254712345678');
    const order = webOrder({ customer_id: customer.id });
    const res = await checkout({ order_id: order.id, return_url: RETURN, cancel_url: CANCEL, order });
    const url = new URL(res.json().payment_url);
    await t.app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
    expect(t.lastText()).toMatch(/ZK-11111111/);
  });

  it('validates input and order state', async () => {
    t = await makeApp();
    expect((await checkout({ order_id: 'nope', return_url: RETURN, cancel_url: CANCEL })).statusCode).toBe(404);
    expect((await checkout({ order_id: webOrder().id, return_url: 'javascript:alert(1)', cancel_url: CANCEL, order: webOrder() })).statusCode).toBe(400);
    expect((await checkout({ order_id: webOrder().id, provider: 'bitcoin', return_url: RETURN, cancel_url: CANCEL, order: webOrder() })).statusCode).toBe(400);
    expect((await checkout({ order_id: webOrder().id, return_url: RETURN, cancel_url: CANCEL, order: webOrder({ id: 'other' }) })).statusCode).toBe(400);
    const paidOrder = webOrder({ status: 'paid' });
    expect((await checkout({ order_id: paidOrder.id, return_url: RETURN, cancel_url: CANCEL, order: paidOrder })).statusCode).toBe(409);
  });

  it('requires x-internal-token when CONCIERGE_INTERNAL_TOKEN is set', async () => {
    t = await makeApp({ config: { internalToken: 'secret-token' } });
    const args = { order_id: webOrder().id, return_url: RETURN, cancel_url: CANCEL, order: webOrder() };
    expect((await checkout(args)).statusCode).toBe(401);
    expect((await checkout(args, { 'x-internal-token': 'wrong' })).statusCode).toBe(401);
    expect((await checkout(args, { 'x-internal-token': 'secret-token' })).statusCode).toBe(200);
  });
});

describe('MpesaProvider (real adapter, fetch stubbed)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const p = new MpesaProvider({ consumerKey: 'k', consumerSecret: 's', shortcode: '174379', passkey: 'pk', callbackUrl: 'https://x/cb?token=tok', callbackToken: 'tok', sandbox: true });

  it('STK push returns the return URL and the CheckoutRequestID', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(url.includes('oauth') ? { access_token: 'at' } : { ResponseCode: '0', CheckoutRequestID: 'ws_CO_123' }));
    });
    const link = await p.createPaymentLink({ orderId: 'o1', amount: 2257, currency: 'KES', description: 'd', customerPhone: '+254712345678', successUrl: RETURN, cancelUrl: CANCEL });
    expect(link).toEqual({ url: RETURN, ref: 'ws_CO_123', amount: 2257, currency: 'KES' });
    expect(calls[1]).toContain('/mpesa/stkpush/v1/processrequest');
  });

  it('callback requires the URL token and maps ResultCode', async () => {
    const raw = Buffer.from(JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_123', ResultCode: 0, CallbackMetadata: { Item: [{ Name: 'Amount', Value: 2257 }] } } } }));
    await expect(p.parseWebhook(raw, {})).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(p.parseWebhook(raw, { 'x-callback-token': 'tok' })).resolves.toMatchObject({ provider: 'mpesa', ref: 'ws_CO_123', status: 'paid', amount: 2257, currency: 'KES' });
  });
});
