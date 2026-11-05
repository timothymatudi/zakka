import type { ShippingAddress } from '../store/types';

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const isPostal = (s: string) => /^[A-Z0-9][A-Z0-9 -]{1,9}$/i.test(s) && /\d/.test(s);
const MAX = 120;

/**
 * Parses the address the customer sends in reply to `address_prompt`:
 * one item per line - name, street, [street 2], city, [region], [postal code].
 * Comma-separated single lines are accepted too. Returns null when name, street or city is missing.
 */
export function parseAddress(text: string, phoneE164: string, countryCode: string): ShippingAddress | null {
  let parts = text.split(/\r?\n/).map(clean).filter(Boolean);
  if (parts.length < 3) parts = text.split(',').map(clean).filter(Boolean);
  if (parts.length < 3 || parts.some((p) => p.length > MAX)) return null;

  const [name, line1, ...rest] = parts as [string, string, ...string[]];
  let postal: string | null = null;
  if (rest.length > 1 && isPostal(rest[rest.length - 1]!)) postal = rest.pop()!;
  // rest is now: city | line2, city | city, region | line2, city, region
  let line2: string | null = null;
  let city: string;
  let region: string | null = null;
  if (rest.length === 1) city = rest[0]!;
  else if (rest.length === 2) [city, region] = rest as [string, string];
  else { line2 = rest[0]!; city = rest[1]!; region = rest.slice(2).join(', '); }

  if (name.length < 2 || line1.length < 3 || city.length < 2) return null;
  return { name, phone_e164: phoneE164, line1, line2, city, region, postal_code: postal, country_code: countryCode };
}

export function formatAddress(a: ShippingAddress): string {
  return [a.name, a.line1, a.line2, [a.city, a.region, a.postal_code].filter(Boolean).join(', '), a.country_code, a.phone_e164]
    .filter(Boolean).join('\n');
}
