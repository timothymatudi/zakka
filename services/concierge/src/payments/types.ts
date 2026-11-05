export type ProviderName = 'stripe' | 'paypal' | 'flutterwave' | 'paystack';

export interface PaymentLinkInput {
  orderId: string;
  amount: number; // major units
  currency: string;
  description: string;
  customerPhone: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentLink { url: string; ref: string; amount: number; currency: string }

export interface PaymentEvent {
  provider: ProviderName;
  ref: string;
  orderId: string | null;
  status: 'paid' | 'failed';
  amount?: number; // major units
  currency?: string;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly mock: boolean;
  supportsCurrency(currency: string): boolean;
  createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink>;
  /** Verifies the webhook signature and returns the normalised event (null for irrelevant events). Throws on bad signature. */
  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<PaymentEvent | null>;
}

export class WebhookSignatureError extends Error {}

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
export const toMinor = (amount: number, currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100));
export const fromMinor = (minor: number, currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? minor : minor / 100);
export const header = (h: Record<string, string | string[] | undefined>, k: string) => {
  const v = h[k.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};
