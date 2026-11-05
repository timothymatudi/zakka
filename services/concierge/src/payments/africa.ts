import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromMinor, header, toMinor, WebhookSignatureError, type PaymentEvent, type PaymentLinkInput, type PaymentProvider } from './types';

const placeholderEmail = (phone: string) => `${phone.replace(/\D/g, '')}@wa.zakka.invalid`;

export function verifyPaystackSignature(raw: Buffer | string, sig: string | undefined, secretKey: string): boolean {
  if (!sig || !secretKey) return false;
  const expected = createHmac('sha512', secretKey).update(raw).digest();
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Paystack (NG, GH, ZA, KE, CI): transaction/initialize + HMAC-SHA512 webhooks. */
export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack' as const;
  readonly mock = false;
  constructor(private secretKey: string) {}
  supportsCurrency(c: string) { return ['NGN', 'GHS', 'ZAR', 'KES', 'XOF', 'USD'].includes(c); }

  async createPaymentLink(i: PaymentLinkInput) {
    const ref = `zakka_${i.orderId.replace(/-/g, '').slice(0, 20)}_${Date.now().toString(36)}`;
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: i.customerEmail || placeholderEmail(i.customerPhone), amount: toMinor(i.amount, i.currency), currency: i.currency,
        reference: ref, callback_url: i.successUrl, metadata: { order_id: i.orderId, phone: i.customerPhone },
      }),
    });
    const json = (await res.json()) as { status?: boolean; message?: string; data?: { authorization_url: string; reference: string } };
    if (!res.ok || !json.status || !json.data) throw new Error(`Paystack initialize failed: ${json.message ?? res.status}`);
    return { url: json.data.authorization_url, ref: json.data.reference, amount: i.amount, currency: i.currency };
  }

  async parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<PaymentEvent | null> {
    if (!verifyPaystackSignature(raw, header(headers, 'x-paystack-signature'), this.secretKey)) throw new WebhookSignatureError('bad Paystack signature');
    const evt = JSON.parse(raw.toString('utf8')) as { event: string; data: { reference: string; amount: number; currency: string; status: string; metadata?: { order_id?: string } } };
    const d = evt.data;
    const base = { provider: this.name, ref: d.reference, orderId: d.metadata?.order_id ?? null, amount: fromMinor(d.amount, d.currency), currency: d.currency };
    if (evt.event === 'charge.success' && d.status === 'success') return { ...base, status: 'paid' };
    if (evt.event === 'charge.failed') return { ...base, status: 'failed' };
    return null;
  }
}

/** Flutterwave Standard (rest of Africa): /v3/payments + verif-hash webhooks + server-side verification. */
export class FlutterwaveProvider implements PaymentProvider {
  readonly name = 'flutterwave' as const;
  readonly mock = false;
  constructor(private secretKey: string, private webhookHash: string) {}
  supportsCurrency(c: string) { return ['NGN', 'GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ZAR', 'XOF', 'XAF', 'ZMW', 'MWK', 'SLL', 'EGP', 'ETB', 'USD', 'EUR', 'GBP'].includes(c); }

  async createPaymentLink(i: PaymentLinkInput) {
    const ref = `zakka_${i.orderId}_${Date.now().toString(36)}`;
    const res = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        tx_ref: ref, amount: i.amount, currency: i.currency, redirect_url: i.successUrl,
        customer: { email: i.customerEmail || placeholderEmail(i.customerPhone), phonenumber: i.customerPhone },
        customizations: { title: 'Zakka', description: i.description.slice(0, 100) }, meta: { order_id: i.orderId },
      }),
    });
    const json = (await res.json()) as { status?: string; message?: string; data?: { link: string } };
    if (!res.ok || json.status !== 'success' || !json.data) throw new Error(`Flutterwave payment failed: ${json.message ?? res.status}`);
    return { url: json.data.link, ref, amount: i.amount, currency: i.currency };
  }

  async parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<PaymentEvent | null> {
    const given = header(headers, 'verif-hash') ?? '';
    const ok = !!this.webhookHash && given.length === this.webhookHash.length && timingSafeEqual(Buffer.from(given), Buffer.from(this.webhookHash));
    if (!ok) throw new WebhookSignatureError('bad Flutterwave verif-hash');
    const evt = JSON.parse(raw.toString('utf8')) as { event: string; data: { id: number; tx_ref: string; status: string; amount: number; currency: string } };
    if (evt.event !== 'charge.completed') return null;
    // Never trust the webhook body alone: re-verify the transaction with Flutterwave.
    const res = await fetch(`https://api.flutterwave.com/v3/transactions/${evt.data.id}/verify`, {
      headers: { authorization: `Bearer ${this.secretKey}` }, signal: AbortSignal.timeout(15000),
    });
    const v = (await res.json()) as { data?: { status: string; tx_ref: string; amount: number; currency: string; meta?: { order_id?: string } } };
    const d = v.data;
    if (!d || d.tx_ref !== evt.data.tx_ref) return null;
    const orderId = d.meta?.order_id ?? /^zakka_([0-9a-f-]{36})_/.exec(d.tx_ref)?.[1] ?? null;
    return { provider: this.name, ref: d.tx_ref, orderId, amount: d.amount, currency: d.currency, status: d.status === 'successful' ? 'paid' : 'failed' };
  }
}
