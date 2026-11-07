import { NextResponse } from 'next/server';
import { LOCALES, type Locale } from '@shared/types';
import { config } from '@/lib/config';
import { buildMockFeed } from '@/lib/feed';
import { COUNTRY_CODES } from '@/lib/markets';

const XML = 'application/xml; charset=utf-8';
const CACHE = 'public, max-age=3600';

/**
 * GET /feeds/{country}/{locale}.xml: the Google-format merchant feed for one market.
 * Live: streamed through from the catalog service (which builds it from the database and caches it 1h).
 * Offline (no CATALOG_API_URL): a sample feed from the web mock catalog. If the catalog is configured but
 * unreachable we answer 503 rather than publish sample products to merchant programs.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ country: string; file: string }> }) {
  const { country: rawCountry, file } = await params;
  const country = rawCountry.toUpperCase();
  const m = /^([a-z]{2})\.xml$/.exec(file);
  if (!/^[A-Z]{2}$/.test(country) || !m || !(LOCALES as string[]).includes(m[1])) {
    return new NextResponse('Not found', { status: 404 });
  }
  const locale = m[1] as Locale;

  if (config.catalogApiUrl) {
    // Time limit for the response headers only (the first build of a large feed can take a while);
    // once the catalog starts sending, the body streams through for as long as it takes.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    try {
      const res = await fetch(`${config.catalogApiUrl}/feeds/${country}/${locale}.xml`, {
        cache: 'no-store',
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (res.status === 404) return new NextResponse('Not found', { status: 404 });
      if (res.ok && res.body) {
        return new Response(res.body, { headers: { 'Content-Type': XML, 'Cache-Control': CACHE } });
      }
    } catch {
      // fall through to 503
    } finally {
      clearTimeout(timer);
    }
    return new NextResponse('Feed temporarily unavailable', { status: 503, headers: { 'Retry-After': '600' } });
  }

  if (!COUNTRY_CODES.includes(country)) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(await buildMockFeed(country, locale), {
    headers: { 'Content-Type': XML, 'Cache-Control': CACHE },
  });
}
