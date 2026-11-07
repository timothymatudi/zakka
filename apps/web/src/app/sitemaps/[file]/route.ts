import { LOCALES, type Locale } from '@shared/types';
import { sitemapPaths, urlsetXml } from '@/lib/sitemap';

/** GET /sitemaps/{locale}.xml: home, categories, "best" landing pages and products, with hreflang alternates. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^([a-z]{2})\.xml$/.exec(file);
  if (!m || !(LOCALES as string[]).includes(m[1])) return new Response('Not found', { status: 404 });
  const locale = m[1] as Locale;
  return new Response(urlsetXml(locale, await sitemapPaths(locale)), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
