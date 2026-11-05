import type { Config } from '../config';
import { FlutterwaveProvider, PaystackProvider } from './africa';
import { MockProvider } from './mock';
import { PayPalProvider } from './paypal';
import { StripeProvider } from './stripe';
import type { PaymentProvider, ProviderName } from './types';

const PAYSTACK = new Set(['NG', 'GH', 'ZA', 'KE', 'CI']);
const FLUTTERWAVE = new Set(['UG', 'TZ', 'RW', 'ZM', 'CM', 'SN', 'MW', 'SL', 'BF', 'BJ', 'TG', 'ML', 'CD', 'ET', 'EG']);
const PAYPAL = new Set(['DE', 'AT', 'IT', 'NL', 'PL', 'BR', 'MX']);

/** Picks the payment provider for a customer's country. Stripe Checkout is the default. */
export function providerForCountry(country: string | null | undefined): ProviderName {
  if (country && PAYSTACK.has(country)) return 'paystack';
  if (country && FLUTTERWAVE.has(country)) return 'flutterwave';
  if (country && PAYPAL.has(country)) return 'paypal';
  return 'stripe';
}

export type Providers = Record<ProviderName, PaymentProvider>;

/** Each provider runs in mock mode when its own keys are empty. */
export function createProviders(cfg: Config): Providers {
  const mock = (n: ProviderName) => new MockProvider(n, cfg.publicUrl);
  return {
    stripe: cfg.stripe.secretKey && cfg.stripe.webhookSecret ? new StripeProvider(cfg.stripe.secretKey, cfg.stripe.webhookSecret) : mock('stripe'),
    paystack: cfg.paystack.secretKey ? new PaystackProvider(cfg.paystack.secretKey) : mock('paystack'),
    flutterwave: cfg.flutterwave.secretKey && cfg.flutterwave.webhookHash ? new FlutterwaveProvider(cfg.flutterwave.secretKey, cfg.flutterwave.webhookHash) : mock('flutterwave'),
    paypal: cfg.paypal.clientId && cfg.paypal.clientSecret && cfg.paypal.webhookId
      ? new PayPalProvider(cfg.paypal.clientId, cfg.paypal.clientSecret, cfg.paypal.webhookId, cfg.paypal.sandbox) : mock('paypal'),
  };
}

export const PROVIDER_LABEL: Record<ProviderName, string> = { stripe: 'Stripe', paypal: 'PayPal', flutterwave: 'Flutterwave', paystack: 'Paystack' };
export type { PaymentProvider, ProviderName } from './types';
