import 'server-only';
import { config } from './config';
import type { PaymentMethod } from './payment-methods';
import type { StoredOrder } from './orders';

export type PaymentOutcome =
  | { ok: true; mode: 'concierge'; provider: PaymentMethod; reference: string; redirectUrl: string; settled: false }
  | { ok: true; mode: 'mock'; provider: PaymentMethod; reference: string; redirectUrl: string; settled: true }
  | { ok: false; error: 'payment_rejected' | 'provider_unavailable' | 'payment_error'; status: number };

/** The contract `orders` row plus shipping_address and items, as the concierge expects it. */
function orderPayload(order: StoredOrder) {
  return {
    id: order.id,
    customer_id: order.customer_id,
    status: order.status,
    currency: order.currency,
    subtotal: order.subtotal,
    shipping: order.shipping,
    tax: order.tax,
    total: order.total,
    total_usd: order.total_usd,
    payment_provider: order.payment_provider,
    payment_ref: order.payment_ref,
    channel: order.channel,
    created_at: order.created_at,
    shipping_address: order.shipping_address,
    items: order.items.map((i) => ({
      offer_id: i.offer_id,
      product_id: i.product_id,
      qty: i.qty,
      unit_price: i.unit_price,
      unit_cost_usd: i.unit_cost_usd,
    })),
  };
}

/**
 * Starts payment through the concierge (POST /internal/payments/checkout).
 * Concierge not configured: instant mock payment in development, so the flow works offline.
 * In production that would settle orders nobody paid for, so it fails as "provider unavailable".
 */
export async function startPayment(provider: PaymentMethod, order: StoredOrder, locale: string): Promise<PaymentOutcome> {
  const orderPage = `/${locale}/orders/${order.id}`;
  const mock: PaymentOutcome = {
    ok: true,
    mode: 'mock',
    provider,
    reference: `mock_${provider}_${order.id.slice(0, 8)}`,
    redirectUrl: `${orderPage}?placed=1`,
    settled: true,
  };
  if (!config.conciergeUrl || !config.conciergeToken) {
    if (process.env.NODE_ENV !== 'production') return mock;
    console.error('[payments] concierge is not configured; refusing to settle an order without payment');
    return { ok: false, error: 'provider_unavailable', status: 502 };
  }

  let res: Response;
  try {
    res = await fetch(`${config.conciergeUrl}/internal/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': config.conciergeToken },
      body: JSON.stringify({
        order_id: order.id,
        provider,
        return_url: `${config.webBaseUrl}${orderPage}?paid=1`,
        cancel_url: `${config.webBaseUrl}/${locale}/checkout`,
        order: orderPayload(order),
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
  } catch (err) {
    // Never settle a configured store's order without the payment service.
    console.error('[payments] concierge unreachable', err);
    return { ok: false, error: 'provider_unavailable', status: 502 };
  }

  if (res.ok) {
    const data = (await res.json().catch(() => null)) as { payment_url?: string; payment_ref?: string } | null;
    if (data?.payment_url && /^https?:\/\//.test(data.payment_url)) {
      return { ok: true, mode: 'concierge', provider, reference: data.payment_ref ?? '', redirectUrl: data.payment_url, settled: false };
    }
    return { ok: false, error: 'payment_error', status: 502 };
  }
  if (res.status === 400 || res.status === 409) return { ok: false, error: 'payment_rejected', status: res.status };
  if (res.status === 502) return { ok: false, error: 'provider_unavailable', status: 502 };
  console.error('[payments] concierge error', res.status, await res.text().catch(() => ''));
  return { ok: false, error: 'payment_error', status: 502 };
}
