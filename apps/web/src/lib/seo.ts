import 'server-only';
import { LOCALES, type Locale } from '@shared/types';
import { config } from './config';

/** Absolute storefront URL for a path that starts with "/". */
export function absUrl(path: string): string {
  return `${config.webBaseUrl}${path}`;
}

/**
 * Canonical + hreflang alternates for a locale-independent path (e.g. "/p/123", "" for home).
 * Every locale gets its own URL; x-default points at English.
 */
export function localeAlternates(locale: Locale, path: string) {
  const languages: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [l, absUrl(`/${l}${path}`)]));
  languages['x-default'] = absUrl(`/en${path}`);
  return { canonical: absUrl(`/${locale}${path}`), languages };
}

/** Contract: customer-facing output never names suppliers or partners. */
const PARTNER_RE =
  /\b(?:cj\s*dropshipping|aliexpress|spocket|printful|amazon(?:\.[a-z.]+)?|temu|shein|jumia(?:\.[a-z.]+)?|flipkart|noon\.com|noon|cj)\b/gi;

export function hasPartnerName(text: string | null | undefined): boolean {
  return !!text && new RegExp(PARTNER_RE.source, 'i').test(text);
}

/** Last line of defence for structured data and feeds (the catalog already scrubs stored copy). */
export function scrubPartnerNames(text: string): string {
  return text
    .replace(PARTNER_RE, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+([).,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-|/:;,]+|[\s\-|/:;,]+$/g, '');
}

/** Product brand for customers: never a partner name; "Zakka" when we are the seller and it is missing. */
export function customerBrand(brand: string | null | undefined, fallback: string | null = 'Zakka'): string | null {
  if (!brand || hasPartnerName(brand)) return fallback;
  return brand;
}

/**
 * delivery_days_min/max are door-to-door. Google and schema.org split them into handling and transit:
 * one day of handling, the rest transit (the same split as the catalog's merchant feed).
 */
export function deliverySplit(min: number | null, max: number | null) {
  if (min == null || max == null || min < 0 || max < min) return null;
  const handling = Math.min(1, min);
  return { handling, transitMin: min - handling, transitMax: max - handling };
}

/** Safe JSON for <script type="application/ld+json">: "<" can never close the script element. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Characters that are not allowed in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ' ');
}
