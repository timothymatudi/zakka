import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshEnv } from './helpers';
import type { StoredOrder } from '@/lib/orders';

const order: StoredOrder = {
  id: '11111111-2222-4333-8444-555555555555',
  customer_id: null,
  status: 'pending_payment',
  currency: 'KES',
  subtotal: 1000,
  shipping: 0,
  tax: 0,
  total: 1000,
  total_usd: 7.75,
  payment_provider: 'mpesa',
  payment_ref: null,
  channel: 'web',
  created_at: new Date().toISOString(),
  shipping_address: null,
  items: [],
  shipments: [],
};

const CONCIERGE = { CONCIERGE_PUBLIC_URL: 'https://concierge.test', CONCIERGE_INTERNAL_TOKEN: 'secret' };

async function start(env: Record<string, string>) {
  freshEnv(env);
  const { startPayment } = await import('@/lib/payments');
  return startPayment('mpesa', order, 'en');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('startPayment without a payment service', () => {
  it('settles with a mock payment in development', async () => {
    const out = await start({ NODE_ENV: 'development' });
    expect(out).toMatchObject({ ok: true, mode: 'mock', settled: true });
  });

  it('refuses to settle in production', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await start({ NODE_ENV: 'production' });
    expect(out).toEqual({ ok: false, error: 'provider_unavailable', status: 502 });
  });

  it('refuses in production when only the URL is set (no token)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await start({ NODE_ENV: 'production', CONCIERGE_PUBLIC_URL: 'https://concierge.test' });
    expect(out).toMatchObject({ ok: false, error: 'provider_unavailable' });
  });
});

describe('startPayment through the concierge', () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('returns the payment page and leaves the order unpaid', async () => {
    const fetchMock = reply(200, { payment_url: 'https://pay.test/abc', payment_ref: 'ref_1' });
    vi.stubGlobal('fetch', fetchMock);
    const out = await start({ NODE_ENV: 'production', ...CONCIERGE });
    expect(out).toEqual({ ok: true, mode: 'concierge', provider: 'mpesa', reference: 'ref_1', redirectUrl: 'https://pay.test/abc', settled: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://concierge.test/internal/payments/checkout');
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('secret');
    expect(JSON.parse(init.body as string)).toMatchObject({ order_id: order.id, provider: 'mpesa' });
  });

  it('never falls back to a mock payment when the concierge is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('down'))));
    for (const NODE_ENV of ['development', 'production']) {
      const out = await start({ NODE_ENV, ...CONCIERGE });
      expect(out).toEqual({ ok: false, error: 'provider_unavailable', status: 502 });
    }
  });

  it('rejects a payment link that is not http(s)', async () => {
    vi.stubGlobal('fetch', reply(200, { payment_url: 'javascript:alert(1)' }));
    expect(await start({ NODE_ENV: 'production', ...CONCIERGE })).toMatchObject({ ok: false, error: 'payment_error' });
  });

  it.each([
    [400, 'payment_rejected', 400],
    [409, 'payment_rejected', 409],
    [502, 'provider_unavailable', 502],
    [500, 'payment_error', 502],
  ])('maps concierge status %i to %s', async (status, error, outStatus) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', reply(status, {}));
    expect(await start({ NODE_ENV: 'production', ...CONCIERGE })).toEqual({ ok: false, error, status: outStatus });
  });
});
