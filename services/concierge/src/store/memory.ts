import { randomUUID } from 'node:crypto';
import type { OrderStatus } from '../shared';
import type { Conversation, Customer, MessageRow, Order, OrderItem, Store, Tracking } from './types';

/** In-memory store used when DATABASE_URL is empty/unreachable, and by tests and the simulator. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  customers = new Map<string, Customer>();
  conversations = new Map<string, Conversation>();
  messages = new Map<string, (MessageRow & { created_at: string })[]>();
  waIds = new Set<string>();
  orders = new Map<string, Order>();
  items = new Map<string, OrderItem[]>();
  tracking = new Map<string, Tracking[]>();
  clicks: { customer_id: string | null; offer_id: string; country_code: string | null; locale: string | null; channel: string; clicked_at: string }[] = [];

  async getOrCreateCustomer(phone: string, d: { country_code: string | null; locale: Customer['locale'] }) {
    for (const c of this.customers.values()) if (c.phone_e164 === phone) return { ...c };
    const c: Customer = {
      id: randomUUID(), phone_e164: phone, locale: d.locale, country_code: d.country_code,
      whatsapp_opt_in: false, whatsapp_opt_in_at: null, marketing_opt_in: false,
    };
    this.customers.set(c.id, c);
    return { ...c };
  }
  async getCustomer(id: string) { const c = this.customers.get(id); return c ? { ...c } : null; }
  async updateCustomer(id: string, patch: Partial<Customer>) {
    const c = this.customers.get(id);
    if (c) this.customers.set(id, { ...c, ...patch, id });
  }

  async getOrCreateConversation(waId: string, customerId: string) {
    for (const c of this.conversations.values()) if (c.wa_id === waId) return structuredClone(c);
    const c: Conversation = {
      id: randomUUID(), customer_id: customerId, wa_id: waId, state: 'idle', context: {},
      last_inbound_at: null, last_outbound_at: null,
    };
    this.conversations.set(c.id, c);
    return structuredClone(c);
  }
  async getConversationByCustomer(customerId: string) {
    for (const c of this.conversations.values()) if (c.customer_id === customerId) return structuredClone(c);
    return null;
  }
  async updateConversation(id: string, patch: Partial<Conversation>) {
    const c = this.conversations.get(id);
    if (c) this.conversations.set(id, structuredClone({ ...c, ...patch, id }));
  }

  async insertMessage(conversationId: string, m: MessageRow) {
    if (m.wa_message_id) {
      if (this.waIds.has(m.wa_message_id)) return false;
      this.waIds.add(m.wa_message_id);
    }
    const list = this.messages.get(conversationId) ?? [];
    list.push({ ...m, created_at: new Date().toISOString() });
    this.messages.set(conversationId, list);
    return true;
  }
  async listMessages(conversationId: string) { return [...(this.messages.get(conversationId) ?? [])]; }

  async createOrder(o: Omit<Order, 'id' | 'created_at'>, items: OrderItem[]) {
    const order: Order = { ...o, id: randomUUID(), created_at: new Date().toISOString() };
    this.orders.set(order.id, order);
    this.items.set(order.id, items.map((i) => ({ ...i, order_id: order.id })));
    return { ...order };
  }
  async getOrder(id: string) { const o = this.orders.get(id); return o ? { ...o } : null; }
  async upsertOrder(order: Order) {
    if (!this.orders.has(order.id)) this.orders.set(order.id, { ...order });
  }
  async findOrderByPaymentRef(provider: string, ref: string) {
    for (const o of this.orders.values()) if (o.payment_provider === provider && o.payment_ref === ref) return { ...o };
    return null;
  }
  async getOrderItems(orderId: string) { return [...(this.items.get(orderId) ?? [])]; }
  async updateOrder(id: string, patch: Partial<Order>) {
    const o = this.orders.get(id);
    if (o) this.orders.set(id, { ...o, ...patch, id });
  }
  async transitionOrder(id: string, from: OrderStatus[], to: OrderStatus) {
    const o = this.orders.get(id);
    if (!o || !from.includes(o.status)) return false;
    this.orders.set(id, { ...o, status: to });
    return true;
  }
  async listOrders(customerId: string, limit = 5) {
    return [...this.orders.values()]
      .filter((o) => o.customer_id === customerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  async getTracking(orderId: string) { return this.tracking.get(orderId) ?? []; }
  async recordAffiliateClick(c: { customer_id: string | null; offer_id: string; country_code: string | null; locale: string | null; channel: string }) {
    this.clicks.push({ ...c, clicked_at: new Date().toISOString() });
  }
  async countryReference() { return null; }
  async close() {}
}
