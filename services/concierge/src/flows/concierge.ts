import type { SupportAI } from '../ai/support';
import type { CatalogClient, SearchClient } from '../clients/services';
import type { Config } from '../config';
import { countryFromPhone, countryInfo, fallbackLocalPrice, formatMoney, ZERO_DECIMAL } from '../geo';
import { detectLanguage } from '../lang/detect';
import { countryName, t } from '../lang/messages';
import { log } from '../log';
import { PROVIDER_LABEL, providerForCountry, usableProvider, type ProviderName, type Providers } from '../payments';
import type { PaymentEvent } from '../payments/types';
import type { Locale, SearchDocument } from '../shared';
import type { Conversation, ConvContext, Customer, Order, ResultItem, Store } from '../store/types';
import { TEMPLATES, type TemplateName } from '../templates/registry';
import type { Inbound } from '../whatsapp/parse';
import { NotOptedInError, WindowClosedError, type Messenger } from '../whatsapp/messenger';
import { formatAddress, parseAddress } from './address';
import { isCancel, isGreeting, isHumanRequest, isResumeBot, isStart, isStop, isSupport, isTracking, pickIndex } from './intents';
import { transition, type FlowEvent } from './states';
import { scrubPartnerNames } from '../brand-safety';

/** Product titles from search may contain a partner name (e.g. a store's house brand): drop it. */
const cleanTitle = (title: string) =>
  scrubPartnerNames(title, '').replace(/\s*[-–|:,]\s*(?=[-–|:,]|$)/g, '').replace(/^[\s\-–|:,]+/, '').replace(/\s{2,}/g, ' ').trim() || 'Zakka pick';

const chargeAmount = (amount: number, currency: string) => (ZERO_DECIMAL.has(currency) ? Math.ceil(amount - 1e-9) : amount);

/** Customer-facing seller label. Never the supplier/partner name (owner rule, see brand-safety.ts). */
export function sellerLabel(kind: ResultItem['kind'], locale: Locale): string {
  return kind === 'dropship' ? t(locale, 'sold_by') : `${t(locale, 'partner_store')} · ${t(locale, 'affiliate_label')}`;
}

export const SHIPMENT_STATUSES = ['pending', 'in_transit', 'delivered', 'exception', 'cancelled'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export interface ShipmentUpdate {
  status?: ShipmentStatus;
  carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  last_event?: string | null;
}
const asShipmentStatus = (s: string | null | undefined): ShipmentStatus | undefined =>
  (SHIPMENT_STATUSES as readonly string[]).includes(s ?? '') ? (s as ShipmentStatus) : undefined;
const ORDER_TO_SHIPMENT: Partial<Record<Order['status'], ShipmentStatus>> = { shipped: 'in_transit', delivered: 'delivered', cancelled: 'cancelled' };
const SHIPMENT_TO_ORDER: Record<Exclude<ShipmentStatus, 'exception'>, Order['status']> = {
  pending: 'forwarded', in_transit: 'shipped', delivered: 'delivered', cancelled: 'cancelled',
};

/** Thrown by checkout with an HTTP status for the internal API. */
export class CheckoutError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const orderRef = (id: string) => `ZK-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export interface Deps {
  config: Config;
  store: Store;
  messenger: Messenger;
  search: SearchClient;
  catalog: CatalogClient;
  providers: Providers;
  ai: SupportAI;
}

interface Turn { customer: Customer; conv: Conversation; locale: Locale; country: string; currency: string }

export class Concierge {
  constructor(private d: Deps) {}

  // ------------------------------------------------------------------ inbound

  async handleInbound(m: Inbound): Promise<{ duplicate: boolean; state?: string }> {
    const { store } = this.d;
    const phone = `+${m.from}`;
    const phoneCountry = countryFromPhone(phone);
    const ref = phoneCountry ? await store.countryReference(phoneCountry).catch(() => null) : null;
    const defaults = countryInfo(phoneCountry);
    const customer = await store.getOrCreateCustomer(phone, { country_code: phoneCountry, locale: ref?.default_locale ?? defaults.locale });
    const conv = await store.getOrCreateConversation(m.from, customer.id);

    const fresh = await store.insertMessage(conv.id, { direction: 'in', type: m.type, body: m.text || null, wa_message_id: m.waMessageId });
    if (!fresh) {
      log.info('duplicate inbound ignored', { wa_message_id: m.waMessageId });
      return { duplicate: true };
    }
    const inboundAt = m.timestamp.toISOString();
    if (!conv.last_inbound_at || inboundAt > conv.last_inbound_at) conv.last_inbound_at = inboundAt;
    await store.updateConversation(conv.id, { last_inbound_at: conv.last_inbound_at });

    // Language: detect from free text only; persist on the customer when it changes.
    // (addresses are proper nouns: don't let them flip the stored language)
    const detected = m.replyId || conv.state === 'collecting_address' ? null : detectLanguage(m.text);
    if (detected && detected !== customer.locale) {
      customer.locale = detected;
      await store.updateCustomer(customer.id, { locale: detected });
    }
    const locale: Locale = detected ?? customer.locale ?? conv.context.locale ?? defaults.locale;
    const country = customer.country_code ?? phoneCountry ?? 'US';
    const currency = ref?.currency ?? countryInfo(country).currency;
    conv.context = { ...conv.context, locale, country };
    const turn: Turn = { customer, conv, locale, country, currency };

    try {
      await this.route(turn, m);
    } catch (e) {
      log.error('flow error', { error: (e as Error).stack ?? String(e), wa_id: m.from });
      if (!(e instanceof WindowClosedError)) await this.reply(turn, { kind: 'text', body: t(locale, 'error') }).catch(() => {});
    }
    await store.updateConversation(conv.id, { state: conv.state, context: conv.context });
    return { duplicate: false, state: conv.state };
  }

  private async route(turn: Turn, m: Inbound) {
    const text = m.text.trim();
    const { conv } = turn;

    // Opt-out / opt-in always win, in any state.
    if (!m.replyId && isStop(text)) return this.optOut(turn);
    if (!m.replyId && isStart(text)) return this.optIn(turn);

    if (conv.state === 'human_handoff') {
      if (isResumeBot(text)) {
        this.go(turn, 'resume');
        conv.context.handoff = false;
        return this.reply(turn, { kind: 'text', body: t(turn.locale, 'welcome') });
      }
      log.info('handoff.inbound (waiting for a human agent)', { wa_id: conv.wa_id, text });
      return;
    }

    const id = m.replyId ?? '';
    if (id.startsWith('pick:')) return this.pick(turn, Number(id.slice(5)));
    if (id === 'buy') return this.askAddress(turn);
    if (id === 'addr_ok') return this.payWithAddress(turn);
    if (id === 'addr_edit') return this.askAddress(turn, true);
    if (id === 'back') return this.showResults(turn, 'back');
    if (id === 'cancel' || isCancel(text)) return this.cancel(turn);
    if (conv.state === 'collecting_address' && text && !id) return this.receiveAddress(turn, text);

    const idx = pickIndex(text);
    if (idx !== null && conv.context.results?.[idx]) return this.pick(turn, idx);
    if (isTracking(text)) return this.track(turn);
    if (isHumanRequest(text)) return this.handoff(turn, 'customer_request');
    if (isSupport(text)) return this.support(turn, text);
    if (isGreeting(text) || !text) {
      this.go(turn, 'greeting');
      return this.reply(turn, { kind: 'text', body: `${t(turn.locale, 'welcome')}\n\n${t(turn.locale, 'opt_in_hint')}` });
    }
    return this.search(turn, text);
  }

  private go(turn: Turn, event: FlowEvent): boolean {
    const next = transition(turn.conv.state, event);
    if (!next) return false;
    turn.conv.state = next;
    return true;
  }

  private reply(turn: Turn, msg: Parameters<Messenger['send']>[1]) {
    return this.d.messenger.send(turn.conv, msg);
  }

  // ------------------------------------------------------------------ opt-in / out

  private async optOut(turn: Turn) {
    await this.d.store.updateCustomer(turn.customer.id, { whatsapp_opt_in: false, marketing_opt_in: false });
    turn.customer.whatsapp_opt_in = false;
    turn.customer.marketing_opt_in = false;
    this.go(turn, 'stop');
    turn.conv.context = { locale: turn.locale, country: turn.country, opted_out_at: new Date().toISOString() };
    log.info('customer opted out', { customer_id: turn.customer.id });
    await this.reply(turn, { kind: 'text', body: t(turn.locale, 'stopped') });
  }

  private async optIn(turn: Turn) {
    const now = new Date().toISOString();
    await this.d.store.updateCustomer(turn.customer.id, { whatsapp_opt_in: true, whatsapp_opt_in_at: now, marketing_opt_in: true });
    turn.customer.whatsapp_opt_in = true;
    this.go(turn, 'start');
    await this.reply(turn, { kind: 'text', body: t(turn.locale, 'started') });
  }

  // ------------------------------------------------------------------ search

  private days(locale: Locale, min: number | null, max: number | null) {
    if (min === null && max === null) return '-';
    return t(locale, 'days', { min: min ?? max!, max: max ?? min! });
  }

  private async toItem(doc: SearchDocument, turn: Turn): Promise<ResultItem | null> {
    const offer = doc.offers
      .filter((o) => !o.ships_to?.length || o.ships_to.includes(turn.country))
      .sort((a, b) => a.display_price_usd - b.display_price_usd)[0];
    if (!offer) return null;
    const priced = await this.d.catalog.price(offer.offer_id, turn.country).catch(() => null);
    if (priced?.ships_to_country === false) return null;
    // Catalog price first, then the search hit's own local price, then a dev-only FX approximation.
    const local = priced ? { price: priced.price, currency: priced.currency }
      : offer.currency && typeof offer.display_price_local === 'number' && Number.isFinite(offer.display_price_local)
        ? { price: offer.display_price_local, currency: offer.currency }
        : fallbackLocalPrice(offer.display_price_usd, turn.currency);
    return {
      product_id: doc.id, offer_id: offer.offer_id, title: cleanTitle(doc.title), kind: offer.kind, source_code: offer.source_code,
      price: local.price, currency: local.currency, price_usd: priced?.price_usd ?? offer.display_price_usd,
      days_min: priced?.delivery_days_min ?? offer.delivery_days_min, days_max: priced?.delivery_days_max ?? offer.delivery_days_max,
      url: offer.url,
    };
  }

  private async search(turn: Turn, q: string) {
    const { hits } = await this.d.search.search({ q, locale: turn.locale, country: turn.country, perPage: 5 });
    const items: ResultItem[] = [];
    for (const h of hits) {
      if (items.length >= 3) break;
      const it = await this.toItem(h, turn);
      if (it) items.push(it);
    }
    turn.conv.context.last_query = q;
    if (!items.length) {
      this.go(turn, 'no_results');
      turn.conv.context.results = [];
      return this.reply(turn, { kind: 'text', body: t(turn.locale, 'no_results', { q, country: countryName(turn.country, turn.locale) }) });
    }
    turn.conv.context.results = items;
    delete turn.conv.context.selected;
    return this.showResults(turn, 'results');
  }

  private describe(turn: Turn, it: ResultItem): string {
    return [formatMoney(it.price, it.currency, turn.locale), this.days(turn.locale, it.days_min, it.days_max), sellerLabel(it.kind, turn.locale)].join(' · ');
  }

  private async showResults(turn: Turn, event: 'results' | 'back') {
    const items = turn.conv.context.results ?? [];
    if (!items.length) return this.reply(turn, { kind: 'text', body: t(turn.locale, 'welcome') });
    this.go(turn, event);
    const q = turn.conv.context.last_query ?? '';
    const lines = items.map((it, i) => `${i + 1}. ${it.title}\n   ${this.describe(turn, it)}`);
    await this.reply(turn, {
      kind: 'list',
      header: t(turn.locale, 'results_header'),
      body: `${t(turn.locale, 'results_body', { q, country: countryName(turn.country, turn.locale) })}\n\n${lines.join('\n')}`,
      button: t(turn.locale, 'results_button'),
      rows: items.map((it, i) => ({ id: `pick:${i}`, title: `${i + 1}. ${it.title}`, description: this.describe(turn, it) })),
    });
  }

  // ------------------------------------------------------------------ pick / buy / affiliate

  private async pick(turn: Turn, index: number) {
    const it = turn.conv.context.results?.[index];
    if (!it) return this.reply(turn, { kind: 'text', body: t(turn.locale, 'pick_again') });
    const price = formatMoney(it.price, it.currency, turn.locale);
    const days = this.days(turn.locale, it.days_min, it.days_max);

    if (it.kind === 'affiliate') {
      this.go(turn, 'pick_affiliate');
      await this.d.store.recordAffiliateClick({
        customer_id: turn.customer.id, offer_id: it.offer_id, country_code: turn.country, locale: turn.locale, channel: 'whatsapp',
      }).catch((e) => log.warn('affiliate click not recorded', { error: (e as Error).message }));
      return this.reply(turn, {
        kind: 'cta_url', body: t(turn.locale, 'affiliate_body', { title: it.title, price, days }),
        displayText: t(turn.locale, 'affiliate_btn'), url: it.url ?? this.d.config.webBaseUrl, footer: t(turn.locale, 'affiliate_label'),
      });
    }

    this.go(turn, 'pick_dropship');
    turn.conv.context.selected = it;
    return this.reply(turn, {
      kind: 'buttons', body: t(turn.locale, 'confirm_body', { title: it.title, price, days }),
      buttons: [
        { id: 'buy', title: t(turn.locale, 'buy_btn') },
        { id: 'back', title: t(turn.locale, 'back_btn') },
        { id: 'cancel', title: t(turn.locale, 'cancel_btn') },
      ],
    });
  }

  private phone(turn: Turn) { return turn.customer.phone_e164 ?? `+${turn.conv.wa_id}`; }

  private addressButtons(turn: Turn, body: string, editLabel: 'address_edit_btn' | 'address_new_btn') {
    return this.reply(turn, {
      kind: 'buttons', body,
      buttons: [
        { id: 'addr_ok', title: t(turn.locale, 'address_ok_btn') },
        { id: 'addr_edit', title: t(turn.locale, editLabel) },
        { id: 'cancel', title: t(turn.locale, 'cancel_btn') },
      ],
    });
  }

  /** "Buy now" (or "Change address"): offer the last saved address, otherwise ask for one. */
  private async askAddress(turn: Turn, forceNew = false) {
    const { conv } = turn;
    const it = conv.context.selected;
    const valid = it?.kind === 'dropship' && (conv.state === 'confirming' || conv.state === 'collecting_address');
    if (!valid) return this.reply(turn, { kind: 'text', body: t(turn.locale, 'pick_again') });
    if (conv.state === 'confirming') this.go(turn, 'buy');
    delete conv.context.pending_address;

    if (!forceNew) {
      const saved = (await this.d.store.listOrders(turn.customer.id, 5)).find((o) => o.shipping_address?.country_code === turn.country)?.shipping_address;
      if (saved) {
        conv.context.pending_address = { ...saved, phone_e164: this.phone(turn) };
        return this.addressButtons(turn, t(turn.locale, 'address_saved', { address: formatAddress(conv.context.pending_address) }), 'address_new_btn');
      }
    }
    return this.reply(turn, { kind: 'text', body: t(turn.locale, 'address_prompt') });
  }

  private async receiveAddress(turn: Turn, text: string) {
    const address = parseAddress(text, this.phone(turn), turn.country);
    if (!address) {
      return this.reply(turn, { kind: 'text', body: `${t(turn.locale, 'address_invalid')}\n\n${t(turn.locale, 'address_prompt')}` });
    }
    this.go(turn, 'address_received');
    turn.conv.context.pending_address = address;
    return this.addressButtons(turn, t(turn.locale, 'address_confirm', { address: formatAddress(address) }), 'address_edit_btn');
  }

  /** Address confirmed: create the order (with shipping_address) and send the payment link. */
  private async payWithAddress(turn: Turn) {
    const it = turn.conv.context.selected;
    const address = turn.conv.context.pending_address;
    if (turn.conv.state !== 'collecting_address' || !it || it.kind !== 'dropship') {
      return this.reply(turn, { kind: 'text', body: t(turn.locale, 'pick_again') });
    }
    if (!address) return this.askAddress(turn, true);
    // Re-check price and stock at the supplier before charging; never sell a stale or gone offer.
    const fresh = await this.d.catalog.checkoutPrice?.(it.offer_id, turn.country);
    if (fresh === null) return this.reply(turn, { kind: 'text', body: t(turn.locale, 'pick_again') });
    if (fresh && fresh.currency === it.currency) Object.assign(it, { price: fresh.price, price_usd: fresh.price_usd });
    const { store, config } = this.d;
    const providerName = usableProvider(this.d.providers, providerForCountry(turn.country));
    const order = await store.createOrder({
      customer_id: turn.customer.id, status: 'pending_payment', currency: it.currency,
      subtotal: it.price, shipping: 0, tax: 0, total: it.price, total_usd: it.price_usd,
      payment_provider: providerName, payment_ref: null, channel: 'whatsapp', shipping_address: address,
    }, [{ offer_id: it.offer_id, product_id: it.product_id, qty: 1, unit_price: it.price, unit_cost_usd: null, title: it.title }]);

    const link = await this.startPayment(order, providerName, {
      description: `Zakka ${orderRef(order.id)}: ${it.title}`, phone: this.phone(turn),
      returnUrl: `${config.webBaseUrl}/orders/${order.id}?paid=1`, cancelUrl: `${config.webBaseUrl}/orders/${order.id}?cancelled=1`,
    });
    this.go(turn, 'address_confirmed');
    delete turn.conv.context.pending_address;
    turn.conv.context.order_id = order.id;
    turn.conv.context.order_days = this.days(turn.locale, it.days_min, it.days_max);
    return this.reply(turn, {
      kind: 'cta_url',
      body: t(turn.locale, 'pay_body', { ref: orderRef(order.id), price: formatMoney(link.amount, link.currency, turn.locale), provider: PROVIDER_LABEL[providerName] }),
      displayText: t(turn.locale, 'pay_btn'), url: link.url,
    });
  }

  /**
   * Creates the provider payment for an order (both channels) and stores provider + payment_ref.
   * Charges in the order currency when the provider supports it, else in USD (orders.total_usd).
   */
  private async startPayment(order: Order, providerName: ProviderName, o: { description: string; phone: string; returnUrl: string; cancelUrl: string }) {
    const provider = this.d.providers[providerName];
    // Zero-decimal currencies (KES, ...) are charged in whole units, rounded up, matching the displayed price.
    const charge = provider.supportsCurrency(order.currency) ? { amount: chargeAmount(order.total, order.currency), currency: order.currency }
      : provider.supportsCurrency('USD') ? { amount: order.total_usd, currency: 'USD' } : null;
    if (!charge) throw new CheckoutError(400, `${providerName} cannot charge ${order.currency}`);
    const link = await provider.createPaymentLink({
      orderId: order.id, amount: charge.amount, currency: charge.currency, description: o.description,
      customerPhone: o.phone, successUrl: o.returnUrl, cancelUrl: o.cancelUrl,
    });
    await this.d.store.updateOrder(order.id, { payment_provider: providerName, payment_ref: link.ref });
    log.info('payment started', { order_id: order.id, channel: order.channel, provider: providerName, mock: provider.mock, ref: link.ref });
    return link;
  }

  /**
   * POST /internal/payments/checkout (web + any channel). Loads the order from the store, or accepts
   * `fallbackOrder` (same id) when the store does not have it, e.g. the web's in-memory mock.
   */
  async checkout(input: { orderId: string; provider?: ProviderName; returnUrl: string; cancelUrl: string; fallbackOrder?: Order }) {
    const { store } = this.d;
    let order = await store.getOrder(input.orderId);
    if (!order && input.fallbackOrder) {
      await store.upsertOrder(input.fallbackOrder);
      order = await store.getOrder(input.orderId);
    }
    if (!order) throw new CheckoutError(404, 'order not found');
    if (order.status !== 'pending_payment') throw new CheckoutError(409, `order is ${order.status}, not pending_payment`);
    const customer = order.customer_id ? await store.getCustomer(order.customer_id) : null;
    const country = order.shipping_address?.country_code ?? customer?.country_code ?? null;
    if (input.provider && this.d.providers[input.provider].disabled) throw new CheckoutError(400, `${input.provider} is not available`);
    const providerName = input.provider ?? usableProvider(this.d.providers, providerForCountry(country));
    const items = await store.getOrderItems(order.id);
    const link = await this.startPayment(order, providerName, {
      description: `Zakka ${orderRef(order.id)}${items[0]?.title ? `: ${items[0].title}` : ''}`,
      phone: order.shipping_address?.phone_e164 ?? customer?.phone_e164 ?? '',
      returnUrl: input.returnUrl, cancelUrl: input.cancelUrl,
    });
    return { provider: providerName, payment_url: link.url, payment_ref: link.ref };
  }

  private async cancel(turn: Turn) {
    const orderId = turn.conv.context.order_id;
    if (orderId && turn.conv.state === 'awaiting_payment') {
      await this.d.store.transitionOrder(orderId, ['pending_payment'], 'cancelled');
    }
    this.go(turn, 'cancel');
    delete turn.conv.context.selected;
    delete turn.conv.context.order_id;
    delete turn.conv.context.pending_address;
    return this.reply(turn, { kind: 'text', body: t(turn.locale, 'cancelled') });
  }

  // ------------------------------------------------------------------ tracking / support

  private async orderSummaries(customerId: string, locale: Locale, limit = 3) {
    const orders = await this.d.store.listOrders(customerId, limit);
    return Promise.all(orders.map(async (o) => {
      const tracking = await this.d.store.getTracking(o.id);
      const items = await this.d.store.getOrderItems(o.id);
      return {
        order: o, tracking,
        summary: {
          ref: orderRef(o.id), status: t(locale, `status_${o.status}`), total: formatMoney(o.total, o.currency, locale),
          created_at: o.created_at, items: items.map((i) => i.title ?? i.product_id),
          tracking_url: tracking[0]?.tracking_url ?? `${this.d.config.webBaseUrl}/orders/${o.id}`,
        },
      };
    }));
  }

  private async track(turn: Turn) {
    this.go(turn, 'tracking');
    const [latest] = await this.orderSummaries(turn.customer.id, turn.locale, 1);
    if (!latest) return this.reply(turn, { kind: 'text', body: t(turn.locale, 'no_orders') });
    const tr = latest.tracking[0];
    const lines = [t(turn.locale, 'track_status', { ref: latest.summary.ref, status: latest.summary.status })];
    if (tr?.carrier || tr?.tracking_number) lines.push([tr.carrier, tr.tracking_number].filter(Boolean).join(' '));
    if (tr?.last_event) lines.push(tr.last_event);
    lines.push(t(turn.locale, 'track_link', { url: latest.summary.tracking_url! }));
    return this.reply(turn, { kind: 'text', body: lines.join('\n'), previewUrl: true });
  }

  private async support(turn: Turn, question: string) {
    const orders = await this.orderSummaries(turn.customer.id, turn.locale);
    const products = (turn.conv.context.results ?? []).map((r) => ({
      title: r.title, price: formatMoney(r.price, r.currency, turn.locale), delivery: this.days(turn.locale, r.days_min, r.days_max),
      sold_by: r.kind === 'dropship' ? 'Zakka' : 'a partner store', affiliate: r.kind === 'affiliate',
    }));
    const searchProducts = async (q: string) => {
      const { hits } = await this.d.search.search({ q, locale: turn.locale, country: turn.country, perPage: 3 });
      const items = (await Promise.all(hits.map((h) => this.toItem(h, turn)))).filter((x): x is ResultItem => !!x);
      return items.map((r) => ({
        title: r.title, price: formatMoney(r.price, r.currency, turn.locale), delivery: this.days(turn.locale, r.days_min, r.days_max),
        sold_by: r.kind === 'dropship' ? 'Zakka' : 'a partner store', affiliate: r.kind === 'affiliate',
      }));
    };
    const ans = await this.d.ai.answer({ question, locale: turn.locale, country: turn.country, orders: orders.map((o) => o.summary), products, searchProducts });
    if (ans.handoff || !ans.reply) return this.handoff(turn, ans.reason ?? 'ai_unsure');
    this.go(turn, 'support');
    return this.reply(turn, { kind: 'text', body: ans.reply });
  }

  private async handoff(turn: Turn, reason: string) {
    this.go(turn, 'handoff');
    turn.conv.context.handoff = true;
    turn.conv.context.handoff_reason = reason;
    turn.conv.context.handoff_at = new Date().toISOString();
    log.warn('handoff.requested', { wa_id: turn.conv.wa_id, customer_id: turn.customer.id, reason });
    return this.reply(turn, { kind: 'text', body: t(turn.locale, 'handoff') });
  }

  // ------------------------------------------------------------------ payments

  /** Idempotent: a repeated "paid" event for an already-paid order is a no-op. */
  async handlePaymentEvent(evt: PaymentEvent): Promise<{ ok: boolean; duplicate?: boolean; order?: Order; forwarded?: boolean; forward?: { ok: boolean; mock: boolean; status?: number; detail?: string }; reason?: string }> {
    const { store, catalog } = this.d;
    let order = evt.orderId ? await store.getOrder(evt.orderId) : null;
    if (!order) order = await store.findOrderByPaymentRef(evt.provider, evt.ref);
    if (!order) return { ok: false, reason: 'order_not_found' };
    if (order.payment_provider !== evt.provider || !order.payment_ref || order.payment_ref !== evt.ref) {
      log.error('payment event does not match order', { order_id: order.id, provider: evt.provider, ref: evt.ref });
      return { ok: false, reason: 'ref_mismatch' };
    }
    if (evt.status === 'failed') {
      log.warn('payment failed', { order_id: order.id, provider: evt.provider });
      return { ok: true, order };
    }
    if (evt.amount === undefined || !evt.currency) {
      log.error('payment event without amount/currency', { order_id: order.id, provider: evt.provider });
      return { ok: false, reason: 'amount_missing' };
    }
    const amountMatches = (evt.currency.toUpperCase() === order.currency
        && (Math.abs(evt.amount - order.total) < 0.01 || evt.amount === chargeAmount(order.total, order.currency)))
      || (evt.currency.toUpperCase() === 'USD' && Math.abs(evt.amount - order.total_usd) < 0.01);
    if (!amountMatches) {
      log.error('paid amount does not match order total', { order_id: order.id, amount: evt.amount, currency: evt.currency });
      return { ok: false, reason: 'amount_mismatch' };
    }
    // A cancelled order is never revived: the shopper may already have re-ordered. Refund it instead.
    if (order.status === 'cancelled') {
      log.error('payment received for cancelled order; needs refund', { order_id: order.id, provider: evt.provider, ref: evt.ref });
      return { ok: false, order, reason: 'order_cancelled_refund_needed' };
    }
    const moved = await store.transitionOrder(order.id, ['pending_payment'], 'paid');
    if (!moved) return { ok: true, duplicate: true, order };
    log.info('order paid', { order_id: order.id, provider: evt.provider, ref: evt.ref });

    const paidOrder = (await store.getOrder(order.id)) ?? order;
    const items = (await store.getOrderItems(order.id)).map(({ title: _t, ...i }) => i);
    const fwd = await catalog.forward(order.id, order.shipping_address, { order: paidOrder, items });
    log.info('order forward attempt', { order_id: order.id, ok: fwd.ok, mock: fwd.mock, status: fwd.status, detail: fwd.detail });
    if (fwd.ok) await store.transitionOrder(order.id, ['paid'], 'forwarded');

    await this.notifyPaid(order, fwd.ok).catch((e) => log.error('paid notification failed', { order_id: order!.id, error: (e as Error).message }));
    return { ok: true, order: (await store.getOrder(order.id)) ?? order, forwarded: fwd.ok, forward: fwd };
  }

  private async notifyPaid(order: Order, forwarded: boolean) {
    if (!order.customer_id) return;
    const { store, messenger } = this.d;
    const customer = await store.getCustomer(order.customer_id);
    const conv = await store.getConversationByCustomer(order.customer_id);
    if (!customer || !conv) return;
    const locale: Locale = customer.locale ?? conv.context.locale ?? 'en';
    const ref = orderRef(order.id);
    const total = formatMoney(order.total, order.currency, locale);
    const ctx: ConvContext = conv.context;
    const days = (ctx.order_id === order.id ? (ctx.order_days as string | undefined) : undefined) ?? '-';
    const body = `${t(locale, 'paid', { ref })}\n${t(locale, forwarded ? 'forwarded' : 'forward_pending')}`;
    const mode = await messenger.sendOrTemplate(conv, customer, {
      kind: 'cta_url', body, displayText: TEMPLATES.order_confirmation.translations[locale].button,
      url: `${this.d.config.webBaseUrl}/orders/${order.id}`,
    }, { name: 'order_confirmation', locale, params: [ref, total, days], buttonUrlParam: order.id });
    log.info('customer notified of payment', { order_id: order.id, mode });

    if (ctx.order_id === order.id) {
      const next = transition(conv.state, 'paid');
      const { order_id: _o, selected: _s, ...rest } = ctx;
      await store.updateConversation(conv.id, { state: next ?? conv.state, context: { ...rest, last_order_id: order.id } });
    }
  }

  // ------------------------------------------------------------------ proactive (templates)

  /** Order status notifications (shipping/delivery) from catalog/fulfilment. Utility templates outside the window. */
  /**
   * Shipment notification from catalog (POST /internal/orders/:id/notify). Fields missing from the
   * update are filled from the stored shipment/order. `pending` sends nothing; `delivered` sends
   * delivery_update; `in_transit` with tracking sends shipping_update; anything else delivery_update.
   */
  async notifyOrderUpdate(orderId: string, update: ShipmentUpdate = {}): Promise<{ sent: boolean; mode?: string; template?: TemplateName; reason?: string }> {
    const { store, messenger, config } = this.d;
    const order = await store.getOrder(orderId);
    if (!order?.customer_id) return { sent: false, reason: 'order_not_found' };
    const tr = (await store.getTracking(order.id))[0];
    const status = update.status ?? asShipmentStatus(tr?.status) ?? ORDER_TO_SHIPMENT[order.status] ?? 'pending';
    if (status === 'pending') return { sent: false, reason: 'pending' };

    const customer = await store.getCustomer(order.customer_id);
    const conv = await store.getConversationByCustomer(order.customer_id);
    if (!customer || !conv) return { sent: false, reason: 'no_conversation' };
    const locale: Locale = customer.locale ?? conv.context.locale ?? 'en';
    const ref = orderRef(order.id);
    const carrier = update.carrier || tr?.carrier || null;
    const trackingNumber = update.tracking_number || tr?.tracking_number || null;
    const lastEvent = update.last_event || tr?.last_event || null;
    const url = update.tracking_url || tr?.tracking_url || `${config.webBaseUrl}/orders/${order.id}`;
    const label = status === 'exception' ? t(locale, 'ship_exception') : t(locale, `status_${SHIPMENT_TO_ORDER[status]}`);

    const text = [
      t(locale, 'track_status', { ref, status: label }),
      carrier || trackingNumber ? [carrier, trackingNumber].filter(Boolean).join(' ') : null,
      lastEvent,
      t(locale, 'track_link', { url }),
    ].filter(Boolean).join('\n');
    const template: { name: TemplateName; params: string[] } = status === 'in_transit' && (carrier || trackingNumber)
      ? { name: 'shipping_update', params: [ref, carrier ?? '-', trackingNumber ?? '-'] }
      : { name: 'delivery_update', params: [ref, label, lastEvent ?? '-'] };
    const mode = await messenger.sendOrTemplate(conv, customer, { kind: 'text', body: text, previewUrl: true },
      { name: template.name, locale, params: template.params, buttonUrlParam: order.id });
    return { sent: true, mode, template: template.name };
  }

  /** Marketing template (price_drop_alert / weekly_deals). Only for whatsapp_opt_in customers. */
  async sendMarketing(customerId: string, name: 'price_drop_alert' | 'weekly_deals', params: string[], buttonUrlParam: string): Promise<{ sent: boolean; reason?: string }> {
    const customer = await this.d.store.getCustomer(customerId);
    const conv = customer && (await this.d.store.getConversationByCustomer(customerId));
    if (!customer || !conv) return { sent: false, reason: 'no_conversation' };
    try {
      await this.d.messenger.sendTemplate(conv, customer, name, customer.locale ?? 'en', params, buttonUrlParam);
      return { sent: true };
    } catch (e) {
      if (e instanceof NotOptedInError) return { sent: false, reason: 'not_opted_in' };
      throw e;
    }
  }

  /** Human agent reply during hand-off (free-form; only inside the 24h window). */
  async agentReply(waId: string, text: string, resume = false): Promise<{ sent: boolean; reason?: string }> {
    const customer = await this.d.store.getOrCreateCustomer(`+${waId}`, { country_code: countryFromPhone(`+${waId}`), locale: null });
    const conv = await this.d.store.getOrCreateConversation(waId, customer.id);
    try {
      if (text) await this.d.messenger.send(conv, { kind: 'text', body: text });
    } catch (e) {
      if (e instanceof WindowClosedError) return { sent: false, reason: 'window_closed' };
      throw e;
    }
    if (resume) await this.d.store.updateConversation(conv.id, { state: 'idle', context: { ...conv.context, handoff: false } });
    return { sent: true };
  }
}
