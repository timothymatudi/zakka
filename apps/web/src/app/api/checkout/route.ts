import { NextResponse } from 'next/server';
import type { Locale } from '@shared/types';
import { isLocale } from '@/i18n/routing';
import { COUNTRY_CODES, marketFor } from '@/lib/markets';
import { getOfferPrice, resolveOffer } from '@/lib/products';
import { newOrderId, saveOrder, updateOrder, type ShippingAddress, type StoredOrder, type StoredOrderItem } from '@/lib/orders';
import { startPayment } from '@/lib/payments';
import { isMethodAvailable } from '@/lib/payment-methods';

interface Body {
  locale?: string;
  country?: string;
  provider?: string;
  contact?: {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postal_code?: string;
  };
  items?: { offerId?: string; productId?: string; qty?: number }[];
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Creates an order (status pending_payment) from server-side prices, then starts payment.
 * Prices always come from the catalog service (or mock), never from the client.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad('invalid_json');
  }
  const locale = (body.locale && isLocale(body.locale) ? body.locale : 'en') as Locale;
  const country = (body.country ?? '').toUpperCase();
  if (!COUNTRY_CODES.includes(country)) return bad('invalid_country');
  if (!body.provider || !isMethodAvailable(body.provider, country)) return bad('invalid_provider');
  const provider = body.provider;
  const c = body.contact ?? {};
  const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const phone = str(c.phone, 32).replace(/[^\d+]/g, ''); // E.164: +<country code><number>
  if (!str(c.name) || !str(c.line1) || !str(c.city) || !/^\+[1-9]\d{6,14}$/.test(phone)) return bad('missing_contact');
  const shipping_address: ShippingAddress = {
    name: str(c.name),
    phone_e164: phone,
    line1: str(c.line1),
    line2: str(c.line2) || null,
    city: str(c.city, 100),
    region: str(c.region, 100) || null,
    postal_code: str(c.postal_code, 20) || null,
    country_code: country,
  };
  const reqItems = (body.items ?? []).filter((i) => i.offerId && i.productId).slice(0, 50);
  if (reqItems.length === 0) return bad('empty_cart');

  const market = marketFor(country);
  const items: StoredOrderItem[] = [];
  let totalUsd = 0;
  for (const it of reqItems) {
    const qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 1)));
    const resolved = await resolveOffer(it.offerId!, it.productId!, locale, country);
    if (!resolved) return bad('unknown_offer');
    if (resolved.offer.kind !== 'dropship') return bad('affiliate_not_purchasable');
    const price = await getOfferPrice(it.offerId!, country);
    if (!price) return bad('not_available_in_country');
    if (price.kind && price.kind !== 'dropship') return bad('affiliate_not_purchasable');
    if (price.currency !== market.currency) return bad('currency_mismatch');
    items.push({
      offer_id: it.offerId!,
      product_id: resolved.product.id,
      title: resolved.product.title,
      qty,
      unit_price: price.price,
      unit_cost_usd: null, // the catalog/forwarding service fills supplier cost
    });
    totalUsd += price.price_usd * qty;
  }

  const f = 10 ** market.decimals;
  const subtotal = Math.round(items.reduce((s, i) => s + i.unit_price * i.qty, 0) * f) / f;
  const order: StoredOrder = {
    id: newOrderId(),
    customer_id: null, // TODO: link to customers row once auth exists
    status: 'pending_payment',
    currency: market.currency,
    subtotal,
    shipping: 0, // shipping is included in offer prices (contract pricing rule)
    tax: 0,
    total: subtotal,
    total_usd: Math.round(totalUsd * 100) / 100,
    payment_provider: provider,
    payment_ref: null,
    channel: 'web',
    created_at: new Date().toISOString(),
    shipping_address,
    country_code: country,
    items,
    shipments: [],
  };
  await saveOrder(order);

  // Payments are owned by the concierge, which also handles webhooks and forwarding paid orders.
  const payment = await startPayment(provider, order, locale);
  if (!payment.ok) {
    await updateOrder(order.id, { status: 'cancelled' });
    return NextResponse.json({ error: payment.error, orderId: order.id }, { status: payment.status });
  }
  await updateOrder(order.id, { payment_ref: payment.reference, status: payment.settled ? 'paid' : 'pending_payment' });

  return NextResponse.json({ orderId: order.id, redirectUrl: payment.redirectUrl, mode: payment.mode });
}
