import 'server-only';
import type { SearchDocument } from '@shared/types';
import { PRODUCTS } from './mock/catalog';

/**
 * Public image paths for a product. Feeds and structured data link images through the storefront's
 * own /img/{productId}/{n} route instead of raw storage URLs (mirrored object paths start with the
 * source code, and customer-facing output never names suppliers). Mock products get a placeholder tile.
 */
export function productImagePaths(product: Pick<SearchDocument, 'id' | 'image'>): string[] {
  const known = product.image || PRODUCTS.some((p) => p.id === product.id);
  return known ? [`/img/${encodeURIComponent(product.id)}/0`] : [];
}
