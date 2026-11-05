import type { Locale } from '@shared/types';

/** Mirrors the countries/currencies tables. Mock until a reference-data endpoint exists. */
export interface Country {
  code: string;
  name: string;
  currency: string;
  defaultLocale: Locale;
}

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'United States', currency: 'USD', defaultLocale: 'en' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', defaultLocale: 'en' },
  { code: 'DE', name: 'Deutschland', currency: 'EUR', defaultLocale: 'de' },
  { code: 'FR', name: 'France', currency: 'EUR', defaultLocale: 'fr' },
  { code: 'ES', name: 'España', currency: 'EUR', defaultLocale: 'es' },
  { code: 'MX', name: 'México', currency: 'MXN', defaultLocale: 'es' },
  { code: 'BR', name: 'Brasil', currency: 'BRL', defaultLocale: 'pt' },
  { code: 'AE', name: 'الإمارات', currency: 'AED', defaultLocale: 'ar' },
  { code: 'SA', name: 'السعودية', currency: 'SAR', defaultLocale: 'ar' },
  { code: 'EG', name: 'مصر', currency: 'EGP', defaultLocale: 'ar' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', defaultLocale: 'en' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', defaultLocale: 'en' },
  { code: 'KE', name: 'Kenya', currency: 'KES', defaultLocale: 'sw' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', defaultLocale: 'sw' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', defaultLocale: 'en' },
  { code: 'IN', name: 'भारत (India)', currency: 'INR', defaultLocale: 'hi' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', defaultLocale: 'id' },
  { code: 'CN', name: '中国', currency: 'CNY', defaultLocale: 'zh' },
];

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

/** Mock fx_rates (base USD). Live display uses catalog prices; this is only for list cards and offline mode. */
export const FX_USD: Record<string, number> = {
  USD: 1, GBP: 0.79, EUR: 0.92, MXN: 18.5, BRL: 5.6, AED: 3.6725, SAR: 3.75, EGP: 49,
  NGN: 1550, GHS: 15.5, KES: 129, TZS: 2650, ZAR: 18.2, INR: 84.5, IDR: 16200, CNY: 7.2,
};

/** currencies.decimals */
// Display decimals (lead decision): these currencies show whole units; everything else shows 2.
export const CURRENCY_DECIMALS: Record<string, number> = {
  KES: 0, IDR: 0, TZS: 0, UGX: 0, NGN: 0, JPY: 0, KRW: 0, VND: 0, CLP: 0, PKR: 0,
};

export const LOCALE_DEFAULT_COUNTRY: Record<Locale, string> = {
  en: 'US', es: 'MX', fr: 'FR', pt: 'BR', ar: 'AE', zh: 'CN', hi: 'IN', sw: 'KE', de: 'DE', id: 'ID',
};

export const COUNTRY_COOKIE = 'zakka_country';

export function getCountryInfo(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

export interface Market {
  country: string;
  currency: string;
  rate: number;
  decimals: number;
}

export function marketFor(countryCode: string): Market {
  const c = getCountryInfo(countryCode);
  return {
    country: c.code,
    currency: c.currency,
    rate: FX_USD[c.currency] ?? 1,
    decimals: CURRENCY_DECIMALS[c.currency] ?? 2,
  };
}
