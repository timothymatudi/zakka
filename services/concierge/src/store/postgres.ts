import pg from 'pg';
import type { Locale, OrderStatus } from '../shared';
import type { Conversation, Customer, MessageRow, Order, OrderItem, Store, Tracking } from './types';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);

function toOrder(r: Record<string, unknown>): Order {
  return {
    id: r.id as string, customer_id: (r.customer_id as string) ?? null, status: r.status as OrderStatus,
    currency: String(r.currency).trim(), subtotal: num(r.subtotal), shipping: num(r.shipping), tax: num(r.tax),
    total: num(r.total), total_usd: num(r.total_usd), payment_provider: (r.payment_provider as string) ?? null,
    payment_ref: (r.payment_ref as string) ?? null, channel: r.channel as Order['channel'],
    shipping_address: (r.shipping_address as Order['shipping_address']) ?? null,
    created_at: iso(r.created_at) ?? new Date().toISOString(),
  };
}
function toCustomer(r: Record<string, unknown>): Customer {
  return {
    id: r.id as string, phone_e164: (r.phone_e164 as string) ?? null, locale: (r.locale as Locale) ?? null,
    country_code: r.country_code ? String(r.country_code).trim() : null, whatsapp_opt_in: !!r.whatsapp_opt_in,
    whatsapp_opt_in_at: iso(r.whatsapp_opt_in_at), marketing_opt_in: !!r.marketing_opt_in,
  };
}
function toConv(r: Record<string, unknown>): Conversation {
  return {
    id: r.id as string, customer_id: (r.customer_id as string) ?? null, wa_id: r.wa_id as string,
    state: r.state as Conversation['state'], context: (r.context as Conversation['context']) ?? {},
    last_inbound_at: iso(r.last_inbound_at), last_outbound_at: iso(r.last_outbound_at),
  };
}

const JSONB = new Set(['context', 'shipping_address']);

function setClause(patch: Record<string, unknown>, start = 2): { sql: string; values: unknown[] } {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  return {
    sql: keys.map((k, i) => `${k} = $${i + start}${JSONB.has(k) ? '::jsonb' : ''}`).join(', '),
    values: keys.map((k) => (JSONB.has(k) && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k])),
  };
}

/** Postgres store over the contract tables (0001_core.sql). Uses only existing columns. */
export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  constructor(private pool: pg.Pool) {}

  static async connect(url: string, timeoutMs = 2500): Promise<PostgresStore> {
    const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: timeoutMs, max: 5 });
    pool.on('error', () => { /* idle client errors must not crash the service */ });
    await pool.query('select 1 from whatsapp_conversations limit 1');
    return new PostgresStore(pool);
  }

  private q(sql: string, values: unknown[] = []) { return this.pool.query(sql, values); }

  async getOrCreateCustomer(phone: string, d: { country_code: string | null; locale: Locale | null }) {
    const found = await this.q('select * from customers where phone_e164 = $1', [phone]);
    if (found.rows[0]) return toCustomer(found.rows[0]);
    const insert = (country: string | null, locale: string | null) => this.q(
      `insert into customers (phone_e164, country_code, locale) values ($1, $2, $3)
       on conflict (phone_e164) do update set phone_e164 = excluded.phone_e164 returning *`,
      [phone, country, locale]);
    try {
      return toCustomer((await insert(d.country_code, d.locale)).rows[0]);
    } catch (e) {
      // Country/locale not seeded yet (FK violation): store the customer without them.
      if ((e as { code?: string }).code !== '23503') throw e;
      return toCustomer((await insert(null, null)).rows[0]);
    }
  }
  async getCustomer(id: string) {
    const r = await this.q('select * from customers where id = $1', [id]);
    return r.rows[0] ? toCustomer(r.rows[0]) : null;
  }
  async updateCustomer(id: string, patch: Partial<Customer>) {
    const { sql, values } = setClause(patch as Record<string, unknown>);
    if (!sql) return;
    try {
      await this.q(`update customers set ${sql} where id = $1`, [id, ...values]);
    } catch (e) {
      if ((e as { code?: string }).code !== '23503') throw e;
      const { country_code: _c, locale: _l, ...rest } = patch;
      await this.updateCustomer(id, rest);
    }
  }

  async getOrCreateConversation(waId: string, customerId: string) {
    const r = await this.q(
      `insert into whatsapp_conversations (wa_id, customer_id) values ($1, $2)
       on conflict (wa_id) do update set customer_id = coalesce(whatsapp_conversations.customer_id, excluded.customer_id)
       returning *`, [waId, customerId]);
    return toConv(r.rows[0]);
  }
  async getConversationByCustomer(customerId: string) {
    const r = await this.q('select * from whatsapp_conversations where customer_id = $1 limit 1', [customerId]);
    return r.rows[0] ? toConv(r.rows[0]) : null;
  }
  async updateConversation(id: string, patch: Partial<Conversation>) {
    const { sql, values } = setClause(patch as Record<string, unknown>);
    if (sql) await this.q(`update whatsapp_conversations set ${sql} where id = $1`, [id, ...values]);
  }

  async insertMessage(conversationId: string, m: MessageRow) {
    const r = await this.q(
      `insert into whatsapp_messages (conversation_id, direction, type, body, template_name, wa_message_id)
       values ($1, $2, $3, $4, $5, $6) on conflict (wa_message_id) do nothing returning id`,
      [conversationId, m.direction, m.type, m.body, m.template_name ?? null, m.wa_message_id ?? null]);
    return (r.rowCount ?? 0) > 0;
  }
  async listMessages(conversationId: string) {
    const r = await this.q('select * from whatsapp_messages where conversation_id = $1 order by id', [conversationId]);
    return r.rows.map((x) => ({ ...x, created_at: iso(x.created_at)! }));
  }

  async createOrder(o: Omit<Order, 'id' | 'created_at'>, items: OrderItem[]) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const r = await client.query(
        `insert into orders (customer_id, status, currency, subtotal, shipping, tax, total, total_usd, payment_provider, payment_ref, channel, shipping_address)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) returning *`,
        [o.customer_id, o.status, o.currency, o.subtotal, o.shipping, o.tax, o.total, o.total_usd, o.payment_provider, o.payment_ref, o.channel,
          o.shipping_address ? JSON.stringify(o.shipping_address) : null]);
      const order = toOrder(r.rows[0]);
      for (const i of items) {
        await client.query(
          'insert into order_items (order_id, offer_id, product_id, qty, unit_price, unit_cost_usd) values ($1,$2,$3,$4,$5,$6)',
          [order.id, i.offer_id, i.product_id, i.qty, i.unit_price, i.unit_cost_usd]);
      }
      await client.query('commit');
      return order;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  async getOrder(id: string) {
    const r = await this.q('select * from orders where id = $1', [id]);
    return r.rows[0] ? toOrder(r.rows[0]) : null;
  }
  async upsertOrder(o: Order) {
    await this.q(
      `insert into orders (id, customer_id, status, currency, subtotal, shipping, tax, total, total_usd, payment_provider, payment_ref, channel, shipping_address)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) on conflict (id) do nothing`,
      [o.id, o.customer_id, o.status, o.currency, o.subtotal, o.shipping, o.tax, o.total, o.total_usd, o.payment_provider, o.payment_ref, o.channel,
        o.shipping_address ? JSON.stringify(o.shipping_address) : null]);
  }
  async findOrderByPaymentRef(provider: string, ref: string) {
    const r = await this.q('select * from orders where payment_provider = $1 and payment_ref = $2 limit 1', [provider, ref]);
    return r.rows[0] ? toOrder(r.rows[0]) : null;
  }
  async getOrderItems(orderId: string) {
    const r = await this.q(
      `select oi.*, pt.title from order_items oi
       left join product_translations pt on pt.product_id = oi.product_id and pt.locale = 'en'
       where oi.order_id = $1`, [orderId]);
    return r.rows.map((x) => ({
      order_id: x.order_id, offer_id: x.offer_id, product_id: x.product_id, qty: x.qty,
      unit_price: num(x.unit_price), unit_cost_usd: x.unit_cost_usd === null ? null : num(x.unit_cost_usd), title: x.title ?? undefined,
    }));
  }
  async updateOrder(id: string, patch: Partial<Order>) {
    const { sql, values } = setClause(patch as Record<string, unknown>);
    if (sql) await this.q(`update orders set ${sql} where id = $1`, [id, ...values]);
  }
  async transitionOrder(id: string, from: OrderStatus[], to: OrderStatus) {
    const r = await this.q('update orders set status = $2 where id = $1 and status = any($3::text[])', [id, to, from]);
    return (r.rowCount ?? 0) > 0;
  }
  async listOrders(customerId: string, limit = 5) {
    const r = await this.q('select * from orders where customer_id = $1 order by created_at desc limit $2', [customerId, limit]);
    return r.rows.map(toOrder);
  }
  async getTracking(orderId: string): Promise<Tracking[]> {
    const r = await this.q(
      `select s.carrier, s.tracking_number, s.tracking_url, s.status, s.last_event
       from shipments s join supplier_orders so on so.id = s.supplier_order_id
       where so.order_id = $1 order by s.updated_at desc`, [orderId]);
    return r.rows as Tracking[];
  }
  async recordAffiliateClick(c: { customer_id: string | null; offer_id: string; country_code: string | null; locale: string | null; channel: string }) {
    await this.q('insert into affiliate_clicks (customer_id, offer_id, country_code, locale, channel) values ($1,$2,$3,$4,$5)',
      [c.customer_id, c.offer_id, c.country_code, c.locale, c.channel]);
  }
  async countryReference(code: string) {
    const r = await this.q('select currency, default_locale from countries where code = $1 and is_active', [code]);
    return r.rows[0] ? { currency: String(r.rows[0].currency).trim(), default_locale: r.rows[0].default_locale as Locale } : null;
  }
  async close() { await this.pool.end(); }
}
