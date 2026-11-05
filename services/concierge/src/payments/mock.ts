import { randomUUID } from 'node:crypto';
import type { PaymentEvent, PaymentLink, PaymentLinkInput, PaymentProvider, ProviderName } from './types';

/**
 * Mock provider (used when the real provider's keys are empty). The payment link points to the
 * local mock-pay route; confirming there POSTs a mock webhook to /payments/webhook/{provider}.
 */
export class MockProvider implements PaymentProvider {
  readonly mock = true;
  constructor(readonly name: ProviderName, private publicUrl: string) {}
  supportsCurrency() { return true; }
  async createPaymentLink(i: PaymentLinkInput): Promise<PaymentLink> {
    const ref = `mock_${this.name}_${randomUUID().slice(0, 8)}`;
    const qs = new URLSearchParams({ order: i.orderId, amount: String(i.amount), currency: i.currency });
    return { url: `${this.publicUrl}/mock-pay/${this.name}/${ref}?${qs}`, ref, amount: i.amount, currency: i.currency };
  }
  async parseWebhook(raw: Buffer): Promise<PaymentEvent | null> {
    const b = JSON.parse(raw.toString('utf8')) as { type?: string; ref?: string; order_id?: string; amount?: number; currency?: string };
    if (b.type !== 'mock.payment_succeeded' && b.type !== 'mock.payment_failed') return null;
    if (!b.ref) return null;
    return {
      provider: this.name, ref: b.ref, orderId: b.order_id ?? null,
      status: b.type === 'mock.payment_succeeded' ? 'paid' : 'failed', amount: b.amount, currency: b.currency,
    };
  }
}
