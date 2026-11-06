// Currency helpers for query understanding ("under 20,000 KES" -> USD filter).
// Rates are USD -> quote, same orientation as the fx_rates table (base is always USD).
// FALLBACK_FX is a mock used offline; when DATABASE_URL is reachable the server
// loads fx_rates and calls setFxRates().

const FALLBACK_FX: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.78, KES: 129, TZS: 2600, UGX: 3700, RWF: 1350, NGN: 1550, GHS: 15.5,
  ZAR: 18.2, EGP: 49, MAD: 10, AED: 3.6725, SAR: 3.75, QAR: 3.64, KWD: 0.307, OMR: 0.385, BHD: 0.376,
  INR: 84, PKR: 280, BDT: 120, IDR: 16000, CNY: 7.2, JPY: 150, BRL: 5.6, MXN: 19.5, CAD: 1.37, AUD: 1.52,
  TRY: 34, XOF: 605,
};

let fx: Record<string, number> = { ...FALLBACK_FX };

export function setFxRates(rates: Record<string, number>): void {
  fx = { ...FALLBACK_FX, ...rates, USD: 1 };
}

// Display decimals per currency: currencies.decimals from the DB when loaded,
// then the contract's offline table, then the ISO 4217 minor units Intl knows.
// Offline display decimals per the contract (whole units for these currencies).
const OFFLINE_DECIMALS: Record<string, number> = {
  KES: 0, IDR: 0, TZS: 0, UGX: 0, NGN: 0, JPY: 0, KRW: 0, VND: 0, CLP: 0, PKR: 0,
};
let dbDecimals: Record<string, number> = {};
export function setCurrencyDecimals(d: Record<string, number>): void {
  dbDecimals = { ...d };
}
export function currencyDecimals(currency: string): number {
  const code = currency.toUpperCase();
  if (dbDecimals[code] != null) return dbDecimals[code];
  if (OFFLINE_DECIMALS[code] != null) return OFFLINE_DECIMALS[code];
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** USD -> local currency, rounded to the currency's display decimals. Null if no rate. */
export function fromUsd(usd: number, currency: string): number | null {
  const rate = fx[currency.toUpperCase()];
  if (!rate) return null;
  const f = 10 ** currencyDecimals(currency);
  return Math.round(usd * rate * f) / f;
}

export function toUsd(amount: number, currency: string): number | null {
  const rate = fx[currency.toUpperCase()];
  if (!rate) return null;
  return Math.round((amount / rate) * 100) / 100;
}

export const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', PT: 'EUR', IE: 'EUR',
  KE: 'KES', TZ: 'TZS', UG: 'UGX', RW: 'RWF', NG: 'NGN', GH: 'GHS', ZA: 'ZAR', EG: 'EGP', MA: 'MAD',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', OM: 'OMR', BH: 'BHD', IN: 'INR', PK: 'PKR', BD: 'BDT',
  ID: 'IDR', CN: 'CNY', JP: 'JPY', BR: 'BRL', MX: 'MXN', CA: 'CAD', AU: 'AUD', TR: 'TRY', SN: 'XOF', CI: 'XOF',
};

export function currencyForCountry(country: string): string {
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? 'USD';
}

/** Price facet buckets, USD. */
export const PRICE_BUCKETS: { label: string; max: number }[] = [
  { label: '0-10', max: 10 },
  { label: '10-25', max: 25 },
  { label: '25-50', max: 50 },
  { label: '50-100', max: 100 },
  { label: '100-250', max: 250 },
  { label: '250+', max: Infinity },
];

export function priceBucket(usd: number): string {
  for (const b of PRICE_BUCKETS) if (usd < b.max) return b.label;
  return '250+';
}

export function ratingBucket(rating: number | null): string {
  if (rating == null) return 'unrated';
  if (rating >= 4.5) return '4.5+';
  if (rating >= 4) return '4.0-4.5';
  if (rating >= 3) return '3.0-4.0';
  return '<3.0';
}
