import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { PRODUCTS } from '@/lib/mock/catalog';
import { xmlEscape } from '@/lib/seo';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /img/{productId}/{n}: the n-th product image. Live: 302 to the catalog's stored image
 * (catalog GET /images/{id}/{n}). Offline: an SVG tile for mock products.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ productId: string; n: string }> }) {
  const { productId, n } = await params;
  const index = Number(n);
  if (!UUID_RE.test(productId) || !Number.isInteger(index) || index < 0 || index > 10) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (config.catalogApiUrl) {
    try {
      const res = await fetch(`${config.catalogApiUrl}/images/${productId}/${index}`, {
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(2500),
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location && /^https?:\/\//i.test(location)) {
        return NextResponse.redirect(location, { status: 302, headers: { 'Cache-Control': 'public, max-age=86400' } });
      }
    } catch {
      // catalog unreachable: fall through to the offline tile
    }
  }
  const mock = PRODUCTS.find((p) => p.id === productId.toLowerCase());
  if (!mock || index !== 0) return new NextResponse('Not found', { status: 404 });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">` +
    `<rect width="800" height="800" fill="#E3F1EF"/>` +
    `<text x="400" y="470" font-size="320" text-anchor="middle">${xmlEscape(mock.icon)}</text></svg>`;
  return new NextResponse(svg, {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}
