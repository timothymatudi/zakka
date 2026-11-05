import { timingSafeEqual } from 'node:crypto';
import { header, WebhookSignatureError, type PaymentEvent, type PaymentLink, type PaymentLinkInput, type PaymentProvider } from './types';

/**
 * M-Pesa (Safaricom Daraja) STK push. The customer approves the charge on their phone, so there is
 * no hosted checkout page: `url` is the return URL (the storefront shows "check your phone").
 * Daraja callbacks are not signed; the order is matched by CheckoutRequestID (payment_ref) and the
 * amount is checked in Concierge.handlePaymentEvent, and the callback URL carries a secret path token.
 */
export class MpesaProvider implements PaymentProvider {
  readonly name = 'mpesa' as const;
  readonly mock = false;
  private base: string;
  constructor(private o: { consumerKey: string; consumerSecret: string; shortcode: string; passkey: string; callbackUrl: string; callbackToken: string; sandbox: boolean }) {
    this.base = o.sandbox ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
  }
  supportsCurrency(c: string) { return c === 'KES'; }

  private async token(): Promise<string> {
    const res = await fetch(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { authorization: 'Basic ' + Buffer.from(`${this.o.consumerKey}:${this.o.consumerSecret}`).toString('base64') },
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('M-Pesa auth failed');
    return json.access_token;
  }

  async createPaymentLink(i: PaymentLinkInput): Promise<PaymentLink> {
    if (i.currency !== 'KES') throw new Error('M-Pesa charges KES only');
    const phone = i.customerPhone.replace(/\D/g, '');
    if (!/^2547\d{8}$|^2541\d{8}$/.test(phone)) throw new Error('M-Pesa needs a Kenyan mobile number');
    const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const res = await fetch(`${this.base}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: this.o.shortcode, Password: Buffer.from(this.o.shortcode + this.o.passkey + ts).toString('base64'),
        Timestamp: ts, TransactionType: 'CustomerPayBillOnline', Amount: Math.ceil(i.amount), PartyA: phone, PartyB: this.o.shortcode,
        PhoneNumber: phone, CallBackURL: this.o.callbackUrl, AccountReference: i.orderId.slice(0, 12), TransactionDesc: 'Zakka order',
      }),
    });
    const json = (await res.json()) as { CheckoutRequestID?: string; ResponseCode?: string; errorMessage?: string };
    if (!res.ok || json.ResponseCode !== '0' || !json.CheckoutRequestID) throw new Error(`M-Pesa STK push failed: ${json.errorMessage ?? res.status}`);
    return { url: i.successUrl, ref: json.CheckoutRequestID, amount: Math.ceil(i.amount), currency: 'KES' };
  }

  async parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<PaymentEvent | null> {
    // The webhook route copies ?token= from the callback URL into this pseudo-header.
    const given = header(headers, 'x-callback-token') ?? '';
    const ok = given.length === this.o.callbackToken.length && timingSafeEqual(Buffer.from(given), Buffer.from(this.o.callbackToken));
    if (!ok) throw new WebhookSignatureError('bad M-Pesa callback token');
    const b = JSON.parse(raw.toString('utf8')) as { Body?: { stkCallback?: { CheckoutRequestID: string; ResultCode: number; CallbackMetadata?: { Item: { Name: string; Value?: number | string }[] } } } };
    const cb = b.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) return null;
    const amount = cb.CallbackMetadata?.Item.find((x) => x.Name === 'Amount')?.Value;
    return {
      provider: this.name, ref: cb.CheckoutRequestID, orderId: null, status: cb.ResultCode === 0 ? 'paid' : 'failed',
      amount: amount !== undefined ? Number(amount) : undefined, currency: 'KES',
    };
  }
}

