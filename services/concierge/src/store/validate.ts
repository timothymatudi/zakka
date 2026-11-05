import type { OrderStatus } from '../shared';
import type { Order, ShippingAddress } from './types';

const STATUSES: OrderStatus[] = ['pending_payment', 'paid', 'forwarded', 'shipped', 'delivered', 'cancelled', 'refunded'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function parseAddress(v: unknown): ShippingAddress | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return undefined;
  const a = v as Record<string, unknown>;
  const name = str(a.name), line1 = str(a.line1), city = str(a.city), country = str(a.country_code);
  if (!name || !line1 || !city || !country || country.length !== 2) return undefined;
  return {
    name, phone_e164: str(a.phone_e164) ?? '', line1, line2: str(a.line2), city, region: str(a.region),
    postal_code: str(a.postal_code), country_code: country.toUpperCase(),
  };
}

/**
 * Validates an `order` object sent with POST /internal/payments/checkout (the web's in-memory
 * orders). Shape = the contract `orders` row. Returns null when it is not usable.
 */
export function parseOrderBody(v: unknown, orderId: string): Order | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const total = num(o.total), totalUsd = num(o.total_usd), currency = str(o.currency)?.toUpperCase() ?? null;
  const status = (str(o.status) ?? 'pending_payment') as OrderStatus;
  const address = parseAddress(o.shipping_address);
  if (o.id !== orderId || total === null || totalUsd === null || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  if (!STATUSES.includes(status) || address === undefined) return null;
  return {
    id: orderId, customer_id: str(o.customer_id), status, currency,
    subtotal: num(o.subtotal) ?? total, shipping: num(o.shipping) ?? 0, tax: num(o.tax) ?? 0, total, total_usd: totalUsd,
    payment_provider: str(o.payment_provider), payment_ref: str(o.payment_ref),
    channel: o.channel === 'whatsapp' ? 'whatsapp' : 'web', shipping_address: address,
    created_at: str(o.created_at) ?? new Date().toISOString(),
  };
}
