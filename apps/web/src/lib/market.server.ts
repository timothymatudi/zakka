import 'server-only';
import { cookies, headers } from 'next/headers';
import type { Locale } from '@shared/types';
import { COUNTRY_CODES, COUNTRY_COOKIE, LOCALE_DEFAULT_COUNTRY, marketFor, type Market } from './markets';

/** Country: cookie > edge geo header (if a host provides one) > locale default. */
export async function getMarket(locale: Locale): Promise<Market> {
  const jar = await cookies();
  const fromCookie = jar.get(COUNTRY_COOKIE)?.value?.toUpperCase();
  if (fromCookie && COUNTRY_CODES.includes(fromCookie)) return marketFor(fromCookie);
  const h = await headers();
  const geo = (h.get('x-vercel-ip-country') ?? h.get('cf-ipcountry') ?? '').toUpperCase();
  if (COUNTRY_CODES.includes(geo)) return marketFor(geo);
  return marketFor(LOCALE_DEFAULT_COUNTRY[locale] ?? 'US');
}
