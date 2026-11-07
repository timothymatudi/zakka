import { sitemapIndexXml } from '@/lib/sitemap';

/** GET /sitemap.xml: index of the per-locale sitemaps. */
export function GET() {
  return new Response(sitemapIndexXml(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
