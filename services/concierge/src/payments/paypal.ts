import { header, WebhookSignatureError, type PaymentEvent, type PaymentLinkInput, type PaymentProvider } from './types';

const SUPPORTED = ['AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'SGD', 'SEK', 'CHF', 'THB', 'USD'];
const NO_DECIMALS = ['HUF', 'JPY', 'TWD'];

/** PayPal Orders v2 (approve link) with webhook verification via verify-webhook-signature. */
export class PayPalProvider implements PaymentProvider {
  readonly name = 'paypal' as const;
  readonly mock = false;
  private base: string;
  constructor(private clientId: string, private clientSecret: string, private webhookId: string, sandbox: boolean) {
    this.base = sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  }
  supportsCurrency(c: string) { return SUPPORTED.includes(c); }

  private async token(): Promise<string> {
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST', body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15000),
      headers: { authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    });
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('PayPal auth failed');
    return json.access_token;
  }

  private async api<T>(path: string, body: unknown, extra: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json', ...extra },
    });
    const json = (await res.json()) as T;
    if (!res.ok) throw new Error(`PayPal ${path} failed (${res.status})`);
    return json;
  }

  async createPaymentLink(i: PaymentLinkInput) {
    const value = NO_DECIMALS.includes(i.currency) ? String(Math.round(i.amount)) : i.amount.toFixed(2);
    const order = await this.api<{ id: string; links: { rel: string; href: string }[] }>('/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: i.orderId, custom_id: i.orderId, description: i.description.slice(0, 127), amount: { currency_code: i.currency, value } }],
      payment_source: { paypal: { experience_context: { return_url: i.successUrl, cancel_url: i.cancelUrl, user_action: 'PAY_NOW', brand_name: 'Zakka' } } },
    }, { 'paypal-request-id': `zakka-${i.orderId}` });
    const link = order.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    if (!link) throw new Error('PayPal returned no approval link');
    return { url: link.href, ref: order.id, amount: i.amount, currency: i.currency };
  }

  async parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<PaymentEvent | null> {
    const event = JSON.parse(raw.toString('utf8')) as { event_type: string; resource: { id: string; custom_id?: string; status?: string; amount?: { value: string; currency_code: string }; purchase_units?: { custom_id?: string }[]; supplementary_data?: { related_ids?: { order_id?: string } } } };
    const verify = await this.api<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
      auth_algo: header(headers, 'paypal-auth-algo'), cert_url: header(headers, 'paypal-cert-url'),
      transmission_id: header(headers, 'paypal-transmission-id'), transmission_sig: header(headers, 'paypal-transmission-sig'),
      transmission_time: header(headers, 'paypal-transmission-time'), webhook_id: this.webhookId, webhook_event: event,
    });
    if (verify.verification_status !== 'SUCCESS') throw new WebhookSignatureError('bad PayPal webhook signature');
    const r = event.resource;
    if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
      // Capture the approved order; PAYMENT.CAPTURE.COMPLETED then confirms it.
      await this.api(`/v2/checkout/orders/${r.id}/capture`, {}, { 'paypal-request-id': `capture-${r.id}` });
      return null;
    }
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      return { provider: this.name, ref: r.supplementary_data?.related_ids?.order_id ?? r.id, orderId: r.custom_id ?? null, status: 'paid',
        amount: r.amount ? Number(r.amount.value) : undefined, currency: r.amount?.currency_code };
    }
    if (event.event_type === 'PAYMENT.CAPTURE.DENIED') {
      return { provider: this.name, ref: r.supplementary_data?.related_ids?.order_id ?? r.id, orderId: r.custom_id ?? null, status: 'failed' };
    }
    return null;
  }
}
