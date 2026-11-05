import type { Locale } from './shared';

/** E.164 calling code -> ISO country. Longest prefix wins. NANP (+1) defaults to US. */
const CALLING_CODES: Record<string, string> = {
  '1': 'US', '1204': 'CA', '1236': 'CA', '1250': 'CA', '1289': 'CA', '1306': 'CA', '1343': 'CA', '1365': 'CA',
  '1403': 'CA', '1416': 'CA', '1418': 'CA', '1438': 'CA', '1450': 'CA', '1506': 'CA', '1514': 'CA', '1519': 'CA',
  '1587': 'CA', '1604': 'CA', '1613': 'CA', '1647': 'CA', '1705': 'CA', '1709': 'CA', '1778': 'CA', '1780': 'CA',
  '1807': 'CA', '1819': 'CA', '1867': 'CA', '1902': 'CA', '1905': 'CA',
  '1876': 'JM', '1868': 'TT',
  '7': 'RU', '20': 'EG', '27': 'ZA', '30': 'GR', '31': 'NL', '32': 'BE', '33': 'FR', '34': 'ES', '36': 'HU',
  '39': 'IT', '40': 'RO', '41': 'CH', '43': 'AT', '44': 'GB', '45': 'DK', '46': 'SE', '47': 'NO', '48': 'PL',
  '49': 'DE', '51': 'PE', '52': 'MX', '53': 'CU', '54': 'AR', '55': 'BR', '56': 'CL', '57': 'CO', '58': 'VE',
  '60': 'MY', '61': 'AU', '62': 'ID', '63': 'PH', '64': 'NZ', '65': 'SG', '66': 'TH', '81': 'JP', '82': 'KR',
  '84': 'VN', '86': 'CN', '90': 'TR', '91': 'IN', '92': 'PK', '93': 'AF', '94': 'LK', '95': 'MM', '98': 'IR',
  '211': 'SS', '212': 'MA', '213': 'DZ', '216': 'TN', '218': 'LY', '220': 'GM', '221': 'SN', '223': 'ML',
  '224': 'GN', '225': 'CI', '226': 'BF', '227': 'NE', '228': 'TG', '229': 'BJ', '230': 'MU', '231': 'LR',
  '232': 'SL', '233': 'GH', '234': 'NG', '235': 'TD', '236': 'CF', '237': 'CM', '238': 'CV', '240': 'GQ',
  '241': 'GA', '242': 'CG', '243': 'CD', '244': 'AO', '249': 'SD', '250': 'RW', '251': 'ET', '252': 'SO',
  '253': 'DJ', '254': 'KE', '255': 'TZ', '256': 'UG', '257': 'BI', '258': 'MZ', '260': 'ZM', '261': 'MG',
  '263': 'ZW', '264': 'NA', '265': 'MW', '266': 'LS', '267': 'BW', '268': 'SZ', '351': 'PT', '352': 'LU',
  '353': 'IE', '354': 'IS', '358': 'FI', '380': 'UA', '420': 'CZ', '421': 'SK', '852': 'HK', '853': 'MO',
  '880': 'BD', '886': 'TW', '960': 'MV', '961': 'LB', '962': 'JO', '963': 'SY', '964': 'IQ', '965': 'KW',
  '966': 'SA', '967': 'YE', '968': 'OM', '970': 'PS', '971': 'AE', '972': 'IL', '973': 'BH', '974': 'QA',
  '977': 'NP',
};

export function countryFromPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  for (let len = 4; len >= 1; len--) {
    const c = CALLING_CODES[digits.slice(0, len)];
    if (c) return c;
  }
  return null;
}

export interface CountryInfo { currency: string; locale: Locale }

/**
 * Fallback country reference data, used when the `countries` table is unavailable.
 * The database (Agent 1's seed) is authoritative when present.
 */
const COUNTRIES: Record<string, CountryInfo> = {
  US: { currency: 'USD', locale: 'en' }, CA: { currency: 'CAD', locale: 'en' }, GB: { currency: 'GBP', locale: 'en' },
  IE: { currency: 'EUR', locale: 'en' }, AU: { currency: 'AUD', locale: 'en' }, NZ: { currency: 'NZD', locale: 'en' },
  DE: { currency: 'EUR', locale: 'de' }, AT: { currency: 'EUR', locale: 'de' }, CH: { currency: 'CHF', locale: 'de' },
  FR: { currency: 'EUR', locale: 'fr' }, BE: { currency: 'EUR', locale: 'fr' }, ES: { currency: 'EUR', locale: 'es' },
  IT: { currency: 'EUR', locale: 'en' }, NL: { currency: 'EUR', locale: 'en' }, PT: { currency: 'EUR', locale: 'pt' },
  MX: { currency: 'MXN', locale: 'es' }, AR: { currency: 'ARS', locale: 'es' }, CO: { currency: 'COP', locale: 'es' },
  CL: { currency: 'CLP', locale: 'es' }, PE: { currency: 'PEN', locale: 'es' }, BR: { currency: 'BRL', locale: 'pt' },
  AE: { currency: 'AED', locale: 'ar' }, SA: { currency: 'SAR', locale: 'ar' }, EG: { currency: 'EGP', locale: 'ar' },
  QA: { currency: 'QAR', locale: 'ar' }, KW: { currency: 'KWD', locale: 'ar' }, MA: { currency: 'MAD', locale: 'ar' },
  JO: { currency: 'JOD', locale: 'ar' }, BH: { currency: 'BHD', locale: 'ar' }, OM: { currency: 'OMR', locale: 'ar' },
  IN: { currency: 'INR', locale: 'hi' }, PK: { currency: 'PKR', locale: 'en' }, BD: { currency: 'BDT', locale: 'en' },
  CN: { currency: 'CNY', locale: 'zh' }, HK: { currency: 'HKD', locale: 'zh' }, TW: { currency: 'TWD', locale: 'zh' },
  SG: { currency: 'SGD', locale: 'en' }, MY: { currency: 'MYR', locale: 'en' }, ID: { currency: 'IDR', locale: 'id' },
  PH: { currency: 'PHP', locale: 'en' }, KE: { currency: 'KES', locale: 'sw' }, TZ: { currency: 'TZS', locale: 'sw' },
  UG: { currency: 'UGX', locale: 'en' }, RW: { currency: 'RWF', locale: 'en' }, NG: { currency: 'NGN', locale: 'en' },
  GH: { currency: 'GHS', locale: 'en' }, ZA: { currency: 'ZAR', locale: 'en' }, CI: { currency: 'XOF', locale: 'fr' },
  SN: { currency: 'XOF', locale: 'fr' }, CM: { currency: 'XAF', locale: 'fr' }, TR: { currency: 'TRY', locale: 'en' },
  JP: { currency: 'JPY', locale: 'en' }, KR: { currency: 'KRW', locale: 'en' },
};

export function countryInfo(country: string | null | undefined): CountryInfo {
  return (country && COUNTRIES[country]) || { currency: 'USD', locale: 'en' };
}

/**
 * Approximate USD->X rates used ONLY when the catalog price API is unreachable
 * (fixture fallback in dev). Real prices come from GET /offers/{id}/price.
 */
const FALLBACK_FX: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.78, CAD: 1.37, AUD: 1.52, NZD: 1.66, CHF: 0.88, MXN: 18.5, ARS: 980, COP: 4100,
  CLP: 940, PEN: 3.75, BRL: 5.4, AED: 3.6725, SAR: 3.75, EGP: 48.5, QAR: 3.64, KWD: 0.307, MAD: 9.9, JOD: 0.709,
  BHD: 0.376, OMR: 0.385, INR: 84, PKR: 278, BDT: 120, CNY: 7.2, HKD: 7.8, TWD: 32, SGD: 1.34, MYR: 4.6,
  IDR: 15800, PHP: 57, KES: 129, TZS: 2700, UGX: 3700, RWF: 1350, NGN: 1600, GHS: 15.5, ZAR: 18, XOF: 605,
  XAF: 605, TRY: 34, JPY: 150, KRW: 1380,
};
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'UGX', 'RWF', 'XOF', 'XAF', 'CLP', 'IDR', 'TZS', 'COP']);

/** Dev-only approximation of the catalog's price: convert and round UP (x.99 or whole units). */
export function fallbackLocalPrice(usd: number, currency: string): { price: number; currency: string } {
  const rate = FALLBACK_FX[currency];
  if (!rate) return { price: Math.ceil(usd * 100) / 100, currency: 'USD' };
  const raw = usd * rate;
  if (ZERO_DECIMAL.has(currency) || rate >= 50) return { price: Math.ceil(raw), currency };
  const x99 = Math.floor(raw) + 0.99;
  return { price: Math.round(x99 * 100) / 100, currency };
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, currencyDisplay: 'code',
      maximumFractionDigits: ZERO_DECIMAL.has(currency) || Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
