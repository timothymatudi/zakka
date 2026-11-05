/** Shared (client + server) payment method metadata. */
export const PAYMENT_METHODS = ['stripe', 'paypal', 'flutterwave', 'paystack', 'mpesa'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Countries where each method is offered. `null` = everywhere. */
const AVAILABILITY: Record<PaymentMethod, string[] | null> = {
  stripe: null,
  paypal: null,
  flutterwave: ['NG', 'GH', 'KE', 'TZ', 'ZA', 'EG'],
  paystack: ['NG', 'GH', 'ZA', 'KE'],
  mpesa: ['KE', 'TZ'],
};

/** Methods for a country, local ones first. */
export function methodsFor(country: string): PaymentMethod[] {
  const local = PAYMENT_METHODS.filter((m) => AVAILABILITY[m]?.includes(country));
  const global = PAYMENT_METHODS.filter((m) => AVAILABILITY[m] === null);
  return [...local, ...global];
}

export function isMethodAvailable(method: string, country: string): method is PaymentMethod {
  return (methodsFor(country) as string[]).includes(method);
}
