import 'server-only';
import { config } from './config';
import { PAYMENT_METHODS, type PaymentMethod } from './payment-methods';

export interface PaymentInit {
  orderId: string;
  amount: number;
  currency: string;
  locale: string;
  email?: string;
  phone?: string;
}

export interface PaymentResult {
  mode: 'mock' | 'live';
  provider: PaymentMethod;
  reference: string;
  /** Where to send the browser next (provider-hosted page in live mode, order page in mock mode). */
  redirectUrl: string;
  /** Mock mode settles immediately so the full flow can be demoed offline. */
  settled: boolean;
}

/**
 * Payment provider stubs. Each provider runs in mock mode until its keys are set.
 * Live integrations are TODO here; the contract places payments with the concierge service,
 * so these may later proxy to it instead (see README "Contract requests").
 */
export async function createPayment(provider: PaymentMethod, init: PaymentInit): Promise<PaymentResult> {
  if (!PAYMENT_METHODS.includes(provider)) throw new Error('unknown provider');
  const hasKey = Boolean(config.payments[provider]);
  const orderPage = `/${init.locale}/orders/${init.orderId}`;
  if (hasKey) {
    // TODO(live): Stripe Checkout Session / PayPal Orders v2 / Flutterwave Standard /
    // Paystack initialize / M-Pesa STK push. Until implemented, behave like mock but do not settle.
    console.warn(`[payments] ${provider} key present but live integration not implemented; using mock`);
    return { mode: 'mock', provider, reference: `pending_${provider}_${init.orderId.slice(0, 8)}`, redirectUrl: orderPage, settled: false };
  }
  return {
    mode: 'mock',
    provider,
    reference: `mock_${provider}_${init.orderId.slice(0, 8)}`,
    redirectUrl: `${orderPage}?placed=1`,
    settled: true,
  };
}
