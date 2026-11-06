import type { Config } from '../config';
import { FlutterwaveProvider, PaystackProvider } from './africa';
import { MockProvider } from './mock';
import { MpesaProvider } from './mpesa';
import { PayPalProvider } from './paypal';
import { StripeProvider } from './stripe';
import { PROVIDER_NAMES, type PaymentProvider, type ProviderName } from './types';

const MPESA = new Set(['KE']);
const PAYSTACK = new Set(['NG', 'GH', 'ZA', 'CI']);
const FLUTTERWAVE = new Set(['UG', 'TZ', 'RW', 'ZM', 'CM', 'SN', 'MW', 'SL', 'BF', 'BJ', 'TG', 'ML', 'CD', 'ET', 'EG']);
const PAYPAL = new Set(['DE', 'AT', 'IT', 'NL', 'PL', 'BR', 'MX']);

/** Picks the payment provider for a customer's country. Stripe Checkout is the default. */
export function providerForCountry(country: string | null | undefined): ProviderName {
  if (country && MPESA.has(country)) return 'mpesa';
  if (country && PAYSTACK.has(country)) return 'paystack';
  if (country && FLUTTERWAVE.has(country)) return 'flutterwave';
  if (country && PAYPAL.has(country)) return 'paypal';
  return 'stripe';
}

export type Providers = Record<ProviderName, PaymentProvider>;

/** Unconfigured provider in a deployment where others are live. */
class DisabledProvider implements PaymentProvider {
  readonly mock = false;
  readonly disabled = true;
  constructor(readonly name: ProviderName) {}
  supportsCurrency() { return false; }
  async createPaymentLink(): Promise<never> { throw new Error(`${this.name} is not configured`); }
  async parseWebhook() { return null; }
}

/**
 * Providers run in mock mode only when NO provider has live keys (local development).
 * Once any provider is live, unconfigured ones are disabled: a public mock-pay page next to
 * real payments would let anyone mark orders paid for free.
 */
export function createProviders(cfg: Config): Providers {
  const built = buildProviders(cfg);
  if (!PROVIDER_NAMES.some((n) => !built[n].mock)) return built;
  for (const n of PROVIDER_NAMES) if (built[n].mock) built[n] = new DisabledProvider(n);
  return built;
}

/** The country's provider, or a live fallback (Stripe first) when that one is disabled. */
export function usableProvider(providers: Providers, preferred: ProviderName): ProviderName {
  if (!providers[preferred].disabled) return preferred;
  return (['stripe', ...PROVIDER_NAMES] as ProviderName[]).find((n) => !providers[n].disabled) ?? preferred;
}

function buildProviders(cfg: Config): Providers {
  const mock = (n: ProviderName) => new MockProvider(n, cfg.publicUrl);
  return {
    stripe: cfg.stripe.secretKey && cfg.stripe.webhookSecret ? new StripeProvider(cfg.stripe.secretKey, cfg.stripe.webhookSecret) : mock('stripe'),
    paystack: cfg.paystack.secretKey ? new PaystackProvider(cfg.paystack.secretKey) : mock('paystack'),
    flutterwave: cfg.flutterwave.secretKey && cfg.flutterwave.webhookHash ? new FlutterwaveProvider(cfg.flutterwave.secretKey, cfg.flutterwave.webhookHash) : mock('flutterwave'),
    paypal: cfg.paypal.clientId && cfg.paypal.clientSecret && cfg.paypal.webhookId
      ? new PayPalProvider(cfg.paypal.clientId, cfg.paypal.clientSecret, cfg.paypal.webhookId, cfg.paypal.sandbox) : mock('paypal'),
    mpesa: cfg.mpesa.consumerKey && cfg.mpesa.consumerSecret && cfg.mpesa.shortcode && cfg.mpesa.passkey && cfg.mpesa.callbackToken
      ? new MpesaProvider({
        ...cfg.mpesa,
        callbackUrl: `${cfg.publicUrl}/payments/webhook/mpesa?token=${encodeURIComponent(cfg.mpesa.callbackToken)}`,
      })
      : new MockProvider('mpesa', cfg.publicUrl, ['KES']),
  };
}

export const PROVIDER_LABEL: Record<ProviderName, string> = { stripe: 'Stripe', paypal: 'PayPal', flutterwave: 'Flutterwave', paystack: 'Paystack', mpesa: 'M-Pesa' };
export type { PaymentProvider, ProviderName } from './types';
