import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromMinor, header, toMinor, WebhookSignatureError, type PaymentEvent, type PaymentLinkInput, type PaymentProvider } from './types';

/** Verifies a Stripe-Signature header (t=...,v1=...) over `${t}.${rawBody}`. */
export function verifyStripeSignature(raw: Buffer | string, sigHeader: string | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2));
  const t = Number(parts.t);
  const v1s = sigHeader.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !v1s.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw.toString()}`).digest();
  return v1s.some((v) => {
    const given = Buffer.from(v, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Stripe Checkout Sessions via the REST API (no SDK). */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly mock = false;
  constructor(private secretKey: string, private webhookSecret: string) {}
  supportsCurrency() { return true; }

  async createPaymentLink(i: PaymentLinkInput) {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
      client_reference_id: i.orderId,
      'metadata[order_id]': i.orderId,
      'payment_intent_data[metadata][order_id]': i.orderId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': i.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(toMinor(i.amount, i.currency)),
      'line_items[0][price_data][product_data][name]': i.description.slice(0, 250),
    });
    if (i.customerEmail) form.set('customer_email', i.customerEmail);
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', body: form, signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `zakka-${i.orderId}` },
    });
    const json = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
    if (!res.ok || !json.url || !json.id) throw new Error(`Stripe checkout failed: ${json.error?.message ?? res.status}`);
    return { url: json.url, ref: json.id, amount: i.amount, currency: i.currency };
  }

  async parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<PaymentEvent | null> {
    if (!verifyStripeSignature(raw, header(headers, 'stripe-signature'), this.webhookSecret)) throw new WebhookSignatureError('bad Stripe signature');
    const evt = JSON.parse(raw.toString('utf8')) as { type: string; data: { object: { id: string; client_reference_id?: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: Record<string, string> } } };
    const s = evt.data.object;
    const base = { provider: this.name, ref: s.id, orderId: s.client_reference_id ?? s.metadata?.order_id ?? null,
      amount: s.amount_total !== undefined && s.currency ? fromMinor(s.amount_total, s.currency) : undefined, currency: s.currency?.toUpperCase() };
    if ((evt.type === 'checkout.session.completed' && s.payment_status === 'paid') || evt.type === 'checkout.session.async_payment_succeeded') {
      return { ...base, status: 'paid' };
    }
    if (evt.type === 'checkout.session.async_payment_failed' || evt.type === 'checkout.session.expired') return { ...base, status: 'failed' };
    return null;
  }
}
