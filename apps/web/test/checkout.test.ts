import { beforeEach, describe, expect, it } from 'vitest';
import { freshEnv, jsonRequest, nextIp } from './helpers';

const URL_ = 'http://localhost:3000/api/checkout';
const contact = { name: 'Amina Otieno', phone: '+254 712 345 678', line1: '1 Kenyatta Ave', city: 'Nairobi' };

async function load() {
  const { POST } = await import('@/app/api/checkout/route');
  const { PRODUCTS } = await import('@/lib/mock/catalog');
  const { getOrder } = await import('@/lib/orders');
  const { getOfferPrice } = await import('@/lib/products');
  const all = PRODUCTS.flatMap((p) => p.offers.map((offer) => ({ product: p, offer })));
  const dropship = all.find((x) => x.offer.kind === 'dropship' && x.offer.ships_to.includes('KE'))!;
  const affiliate = all.find((x) => x.offer.kind === 'affiliate')!;
  const notToKenya = all.find((x) => x.offer.kind === 'dropship' && !x.offer.ships_to.includes('KE'));
  const item = (x: typeof dropship, qty = 1) => ({ offerId: x.offer.offer_id, productId: x.product.id, qty });
  return { POST, getOrder, getOfferPrice, dropship, affiliate, notToKenya, item };
}

const body = (over: Record<string, unknown> = {}) => ({ locale: 'en', country: 'KE', provider: 'mpesa', contact, ...over });

describe('POST /api/checkout', () => {
  beforeEach(() => freshEnv({ NODE_ENV: 'development' }));

  it('rejects requests from another site', async () => {
    const { POST, dropship, item } = await load();
    const res = await POST(jsonRequest(URL_, body({ items: [item(dropship)] }), { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'bad_origin' });
  });

  it('rejects a cross-site request that sends no Origin header', async () => {
    const { POST } = await load();
    const req = new Request(URL_, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' });
    expect((await POST(req)).status).toBe(403);
  });

  it.each([
    ['invalid_country', { country: 'XX' }],
    ['invalid_provider', { provider: 'bitcoin' }],
    ['invalid_provider', { country: 'DE', provider: 'mpesa' }],
    ['missing_contact', { contact: { ...contact, phone: '0712345678' } }],
    ['missing_contact', { contact: { ...contact, name: ' ' } }],
    ['empty_cart', { items: [] }],
    ['unknown_offer', { items: [{ offerId: 'nope', productId: 'nope', qty: 1 }] }],
  ])('answers %s for bad input', async (error, over) => {
    const { POST, dropship, item } = await load();
    const res = await POST(jsonRequest(URL_, body({ items: [item(dropship)], ...over })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it('answers invalid_json for a broken body', async () => {
    const { POST } = await load();
    const req = new Request(URL_, { method: 'POST', headers: { origin: 'http://localhost:3000', 'x-forwarded-for': nextIp() }, body: '{' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('will not sell an affiliate offer', async () => {
    const { POST, affiliate, item } = await load();
    const country = affiliate.offer.ships_to[0];
    const res = await POST(jsonRequest(URL_, body({ country, provider: 'stripe', items: [item(affiliate)] })));
    expect(await res.json()).toEqual({ error: 'affiliate_not_purchasable' });
  });

  it('will not sell an offer that does not ship to the country', async () => {
    const { POST, notToKenya, item } = await load();
    if (!notToKenya) return; // every mock dropship offer ships to Kenya
    const res = await POST(jsonRequest(URL_, body({ items: [item(notToKenya)] })));
    expect(await res.json()).toEqual({ error: 'not_available_in_country' });
  });

  it('creates a paid mock order priced by the server, ignoring any client price', async () => {
    const { POST, getOrder, getOfferPrice, dropship, item } = await load();
    const price = (await getOfferPrice(dropship.offer.offer_id, 'KE'))!;
    const res = await POST(jsonRequest(URL_, body({ items: [{ ...item(dropship, 2), price: 0.01, unit_price: 0.01 }] })));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { orderId: string; redirectUrl: string; mode: string };
    expect(out.mode).toBe('mock');
    expect(out.redirectUrl).toBe(`/en/orders/${out.orderId}?placed=1`);

    const order = (await getOrder(out.orderId))!;
    expect(order).toMatchObject({ status: 'paid', currency: 'KES', channel: 'web', customer_id: null, payment_provider: 'mpesa' });
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ qty: 2, unit_price: price.price });
    expect(order.total).toBe(price.price * 2);
    expect(order.shipping_address).toMatchObject({ phone_e164: '+254712345678', country_code: 'KE', city: 'Nairobi' });
  });

  it('clamps quantity to 1..99', async () => {
    const { POST, getOrder, dropship, item } = await load();
    for (const [sent, stored] of [[-5, 1], [1000, 99], ['abc', 1]] as const) {
      const res = await POST(jsonRequest(URL_, body({ items: [{ ...item(dropship), qty: sent }] })));
      const { orderId } = (await res.json()) as { orderId: string };
      expect((await getOrder(orderId))!.items[0].qty).toBe(stored);
    }
  });

  it('cancels the order when payment cannot start (production, no payment service)', async () => {
    freshEnv({ NODE_ENV: 'production' });
    const { POST, getOrder, dropship, item } = await load();
    const res = await POST(jsonRequest(URL_, body({ items: [item(dropship)] })));
    expect(res.status).toBe(502);
    const out = (await res.json()) as { error: string; orderId: string };
    expect(out.error).toBe('provider_unavailable');
    expect((await getOrder(out.orderId))!.status).toBe('cancelled');
  });

  it('limits one address to 10 checkouts a minute', async () => {
    const { POST } = await load();
    const ip = nextIp();
    const call = () => POST(jsonRequest(URL_, body({ items: [] }), { 'x-forwarded-for': ip }));
    for (let i = 0; i < 10; i++) expect((await call()).status).toBe(400);
    const res = await call();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
