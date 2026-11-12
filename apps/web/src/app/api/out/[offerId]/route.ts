import { NextResponse, type NextRequest } from 'next/server';
import type { Locale } from '@shared/types';
import { isLocale } from '@/i18n/routing';
import { COUNTRY_CODES, COUNTRY_COOKIE } from '@/lib/markets';
import { resolveOffer } from '@/lib/products';
import { recordAffiliateClick } from '@/lib/clicks';
import { currentCustomerId } from '@/lib/auth';

/**
 * Affiliate outbound link: records a row in affiliate_clicks, then 302s to the partner URL.
 * The destination is looked up server-side from the offer id (never taken from the query),
 * so this cannot be used as an open redirect.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const l = sp.get('l') ?? 'en';
  const locale = (isLocale(l) ? l : 'en') as Locale;
  const c = (sp.get('c') ?? req.cookies.get(COUNTRY_COOKIE)?.value ?? '').toUpperCase();
  const country = COUNTRY_CODES.includes(c) ? c : 'US';

  const resolved = await resolveOffer(offerId, sp.get('p'), locale, country);
  if (!resolved || resolved.offer.kind !== 'affiliate' || !resolved.offer.url) {
    return NextResponse.redirect(new URL(`/${locale}`, req.url));
  }
  let target: URL;
  try {
    target = new URL(resolved.offer.url);
    if (target.protocol !== 'https:') throw new Error('insecure');
  } catch {
    return NextResponse.redirect(new URL(`/${locale}`, req.url));
  }

  await recordAffiliateClick({
    customer_id: await currentCustomerId(), // null for guests; a click never creates a customer row
    offer_id: resolved.offer.offer_id,
    country_code: country,
    locale,
    channel: 'web',
  });

  const res = NextResponse.redirect(target, 302);
  res.headers.set('Referrer-Policy', 'no-referrer-when-downgrade');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}
