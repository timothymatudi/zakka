import type { Locale, OrderStatus, SourceCode, SourceKind } from '../shared';

/** Row shapes mirror supabase/migrations/0001_core.sql (only the columns this service uses). */
export interface Customer {
  id: string;
  phone_e164: string | null;
  locale: Locale | null;
  country_code: string | null;
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null;
  marketing_opt_in: boolean;
}

export type ConvState = 'idle' | 'browsing' | 'confirming' | 'collecting_address' | 'awaiting_payment' | 'human_handoff';

/** orders.shipping_address (migration 0005). */
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

/** One product option shown to the user (stored in conversation context). */
export interface ResultItem {
  product_id: string;
  offer_id: string;
  title: string;
  kind: SourceKind;
  source_code: SourceCode;
  price: number;
  currency: string;
  price_usd: number;
  days_min: number | null;
  days_max: number | null;
  url: string | null;
}

export interface ConvContext {
  locale?: Locale;
  country?: string;
  last_query?: string;
  results?: ResultItem[];
  selected?: ResultItem;
  order_id?: string;
  pending_address?: ShippingAddress;
  handoff?: boolean;
  handoff_reason?: string;
  [k: string]: unknown;
}

export interface Conversation {
  id: string;
  customer_id: string | null;
  wa_id: string;
  state: ConvState;
  context: ConvContext;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
}

export interface MessageRow {
  direction: 'in' | 'out';
  type: string;
  body: string | null;
  template_name?: string | null;
  wa_message_id?: string | null;
}

export interface Order {
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
  shipping_address: ShippingAddress | null;
  created_at: string;
}

export interface OrderItem {
  order_id?: string;
  offer_id: string;
  product_id: string;
  qty: number;
  unit_price: number;
  unit_cost_usd: number | null;
  /** Not a DB column: carried in memory for message rendering. */
  title?: string;
}

export interface Tracking {
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  status: string | null;
  last_event: string | null;
}

export interface Store {
  readonly kind: 'postgres' | 'memory';
  getOrCreateCustomer(phone: string, defaults: { country_code: string | null; locale: Locale | null }): Promise<Customer>;
  getCustomer(id: string): Promise<Customer | null>;
  updateCustomer(id: string, patch: Partial<Omit<Customer, 'id'>>): Promise<void>;
  getOrCreateConversation(waId: string, customerId: string): Promise<Conversation>;
  getConversationByCustomer(customerId: string): Promise<Conversation | null>;
  updateConversation(id: string, patch: Partial<Omit<Conversation, 'id' | 'wa_id'>>): Promise<void>;
  /** Inserts an inbound/outbound message. Returns false when wa_message_id was already stored (idempotency). */
  insertMessage(conversationId: string, msg: MessageRow): Promise<boolean>;
  listMessages(conversationId: string): Promise<(MessageRow & { created_at: string })[]>;
  createOrder(order: Omit<Order, 'id' | 'created_at'>, items: OrderItem[]): Promise<Order>;
  getOrder(id: string): Promise<Order | null>;
  findOrderByPaymentRef(provider: string, ref: string): Promise<Order | null>;
  /** Stores an order created elsewhere (web checkout) under its own id; no-op if it already exists. */
  upsertOrder(order: Order): Promise<void>;
  getOrderItems(orderId: string): Promise<OrderItem[]>;
  updateOrder(id: string, patch: Partial<Omit<Order, 'id'>>): Promise<void>;
  /** Atomically moves an order from one status to another. Returns false if it was not in `from`. */
  transitionOrder(id: string, from: OrderStatus[], to: OrderStatus): Promise<boolean>;
  listOrders(customerId: string, limit?: number): Promise<Order[]>;
  getTracking(orderId: string): Promise<Tracking[]>;
  recordAffiliateClick(c: { customer_id: string | null; offer_id: string; country_code: string | null; locale: string | null; channel: string }): Promise<void>;
  countryReference(code: string): Promise<{ currency: string; default_locale: Locale } | null>;
  close(): Promise<void>;
}
