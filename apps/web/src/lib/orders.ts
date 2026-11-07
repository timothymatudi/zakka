import 'server-only';
import type { OrderStatus } from '@shared/types';
import { dbInsert, dbSelect } from './db';
import { hasSupabase } from './config';
import { PRODUCTS } from './mock/catalog';

export interface StoredOrderItem {
  offer_id: string;
  product_id: string;
  title: string;
  qty: number;
  unit_price: number;
  unit_cost_usd: number | null;
}

export interface StoredShipment {
  carrier: string;
  tracking_number: string;
  tracking_url: string | null;
  status: string;
  last_event: string;
  updated_at: string;
}

/** Mirrors the `orders` row plus joined items/shipments. */
/** orders.shipping_address jsonb (contract update). */
export interface ShippingAddress {
  name: string;
  phone_e164: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country_code: string;
}

export interface StoredOrder {
  id: string;
  customer_id: string | null;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  total_usd: number;
  payment_provider: string | null;
  payment_ref: string | null;
  channel: 'web' | 'whatsapp';
  created_at: string;
  shipping_address: ShippingAddress | null;
  country_code?: string;
  items: StoredOrderItem[];
  shipments: StoredShipment[];
}

// In-memory mock store (per server process). Survives hot reloads via globalThis.
const g = globalThis as unknown as { __zakkaOrders?: Map<string, StoredOrder> };
function store(): Map<string, StoredOrder> {
  if (!g.__zakkaOrders) {
    g.__zakkaOrders = new Map(seedOrders().map((o) => [o.id, o]));
  }
  return g.__zakkaOrders;
}

function seedOrders(): StoredOrder[] {
  const day = 86_400_000;
  const now = Date.now();
  const mk = (
    n: number,
    status: OrderStatus,
    currency: string,
    total: number,
    total_usd: number,
    provider: string,
    channel: 'web' | 'whatsapp',
    ageDays: number,
    productIdx: number,
    shipment?: Partial<StoredShipment>,
  ): StoredOrder => {
    const p = PRODUCTS[productIdx];
    const offer = p.offers.find((o) => o.kind === 'dropship') ?? p.offers[0];
    return {
      id: `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      customer_id: null,
      status,
      currency,
      subtotal: total,
      shipping: 0,
      tax: 0,
      total,
      total_usd,
      payment_provider: provider,
      payment_ref: `mock_${provider}_${n}`,
      channel,
      created_at: new Date(now - ageDays * day).toISOString(),
      shipping_address: null,
      items: [{ offer_id: offer.offer_id, product_id: p.id, title: p.title, qty: 1, unit_price: total, unit_cost_usd: null }],
      shipments: shipment
        ? [
            {
              carrier: 'Mock Post',
              tracking_number: `ZK${100000 + n}`,
              tracking_url: null,
              status: 'in_transit',
              last_event: 'In transit',
              updated_at: new Date(now - day).toISOString(),
              ...shipment,
            },
          ]
        : [],
    };
  };
  return [
    mk(1, 'delivered', 'KES', 7095, 54.99, 'mpesa', 'whatsapp', 12, 20, { status: 'delivered', last_event: 'Delivered — Nairobi' }),
    mk(2, 'shipped', 'NGN', 27900, 17.99, 'paystack', 'web', 5, 5, { last_event: 'Arrived at Lagos hub' }),
    mk(3, 'forwarded', 'AED', 92, 24.99, 'stripe', 'web', 2, 0),
    mk(4, 'paid', 'INR', 1606, 18.99, 'paypal', 'web', 1, 35),
    mk(5, 'pending_payment', 'GHS', 233, 14.99, 'flutterwave', 'whatsapp', 0, 13),
  ];
}

export function newOrderId(): string {
  return crypto.randomUUID();
}

export async function saveOrder(order: StoredOrder): Promise<StoredOrder> {
  if (hasSupabase()) {
    const { items, shipments: _s, country_code: _c, ...row } = order;
    void _s;
    void _c;
    const inserted = await dbInsert('orders', row);
    if (inserted) {
      await dbInsert(
        'order_items',
        items.map((i) => ({
          order_id: order.id,
          offer_id: i.offer_id,
          product_id: i.product_id,
          qty: i.qty,
          unit_price: i.unit_price,
          unit_cost_usd: i.unit_cost_usd,
        })),
      );
      return order;
    }
  }
  store().set(order.id, order);
  return order;
}

export async function updateOrder(id: string, patch: Partial<StoredOrder>): Promise<void> {
  const existing = store().get(id);
  if (existing) store().set(id, { ...existing, ...patch });
  // TODO(live): PATCH orders via PostgREST once payment webhooks exist (concierge/payments owner).
}

export async function getOrder(id: string): Promise<StoredOrder | null> {
  const local = store().get(id);
  if (local) return local;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await dbSelect<StoredOrder & { order_items?: StoredOrderItem[] }>(
    'orders',
    // Explicit columns: cost columns are hidden from anon/authenticated roles (contract update),
    // so this query keeps working if it is ever moved off the service-role key.
    `id=eq.${id}&select=id,customer_id,status,currency,subtotal,shipping,tax,total,total_usd,payment_provider,payment_ref,channel,created_at,shipping_address,` +
      `order_items(offer_id,product_id,qty,unit_price),` +
      `supplier_orders(id,status,shipments(carrier,tracking_number,tracking_url,status,last_event,updated_at))`,
  );
  const row = rows?.[0];
  if (!row) return null;
  const so = (row as unknown as { supplier_orders?: { shipments: StoredShipment[] }[] }).supplier_orders ?? [];
  return {
    ...row,
    items: (row.order_items ?? []).map((i) => ({ ...i, title: i.title ?? '', unit_cost_usd: null })),
    shipments: so.flatMap((s) => s.shipments ?? []),
  };
}

/** Latest orders for the admin. Live: from Supabase (service role); mock: the in-memory store. */
export async function listOrders(limit = 200): Promise<StoredOrder[]> {
  if (hasSupabase()) {
    const rows = await dbSelect<Omit<StoredOrder, 'items' | 'shipments'>>(
      'orders',
      'select=id,customer_id,status,currency,subtotal,shipping,tax,total,total_usd,payment_provider,payment_ref,channel,created_at,shipping_address' +
        `&order=created_at.desc&limit=${limit}`,
    );
    if (rows) {
      return rows.map((r) => ({ ...r, total: Number(r.total), total_usd: Number(r.total_usd), items: [], shipments: [] }));
    }
  }
  return [...store().values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}
