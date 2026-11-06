import 'server-only';
import type { Locale, OfferPrice, SearchDocument } from '@shared/types';
import { config } from './config';
import { fetchJson } from './http';
import { findMockOffer, PRODUCTS, type MockProduct } from './mock/catalog';
import { localize } from './search';
import { marketFor } from './markets';
import { usdToLocal } from './money';

export type ProductView = SearchDocument &
  Partial<Pick<MockProduct, 'icon' | 'bullet_points' | 'category_slug'>>;

/**
 * Product by id, localised to a country (offers that do not ship there are dropped;
 * `offers` is empty when nothing ships there).
 * Contract request: the search API has no get-by-id route; we try
 * GET {SEARCH_API_URL}/products/{id}?locale&country and fall back to the mock catalog.
 */
export async function getProduct(id: string, locale: Locale, country: string): Promise<ProductView | null> {
  if (config.searchApiUrl) {
    const qs = new URLSearchParams({ locale, country });
    const live = await fetchJson<SearchDocument>(
      `${config.searchApiUrl}/products/${encodeURIComponent(id)}?${qs}`,
    );
    if (live?.id) return localize(live, country) ?? { ...live, offers: [] };
  }
  const mock = PRODUCTS.find((p) => p.id === id);
  if (!mock) return null;
  return localize(mock, country) ?? { ...mock, offers: [] };
}

/**
 * Authoritative local price for one offer from the catalog service (which owns markup, FX and rounding).
 * Mock: converts the mock display_price_usd with mock FX.
 */
export async function getOfferPrice(offerId: string, country: string): Promise<OfferPrice | null> {
  if (config.catalogApiUrl) {
    const live = await fetchJson<OfferPrice>(
      `${config.catalogApiUrl}/offers/${encodeURIComponent(offerId)}/price?country=${encodeURIComponent(country)}`,
    );
    if (live && typeof live.price === 'number') return live.ships_to_country === false ? null : live;
  }
  const found = findMockOffer(offerId);
  if (!found || !found.offer.ships_to.includes(country)) return null;
  const m = marketFor(country);
  return {
    offer_id: offerId,
    kind: found.offer.kind,
    ships_to_country: true,
    price: usdToLocal(found.offer.display_price_usd, m),
    currency: m.currency,
    price_usd: found.offer.display_price_usd,
    delivery_days_min: found.offer.delivery_days_min,
    delivery_days_max: found.offer.delivery_days_max,
  };
}

/**
 * Checkout-time price: asks the catalog to re-check the offer at the supplier when its data is
 * older than 1h (POST /offers/{id}/refresh), so customers never pay a stale price or for gone stock.
 * Returns null when the offer is no longer available. Offline (no catalog URL): the plain price.
 */
export async function getCheckoutPrice(offerId: string, country: string): Promise<OfferPrice | null> {
  if (!config.catalogApiUrl) return getOfferPrice(offerId, country);
  try {
    const res = await fetch(
      `${config.catalogApiUrl}/offers/${encodeURIComponent(offerId)}/refresh?country=${encodeURIComponent(country)}`,
      {
        method: 'POST',
        headers: config.catalogApiToken ? { authorization: `Bearer ${config.catalogApiToken}` } : {},
        signal: AbortSignal.timeout(8_000),
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { is_active?: boolean; price?: OfferPrice };
    if (!data.is_active || !data.price || data.price.ships_to_country === false) return null;
    return data.price;
  } catch {
    return null;
  }
}

/** Resolve an offer server-side (affiliate redirects and checkout validation). Never trusts a client URL. */
export async function resolveOffer(offerId: string, productId: string | null, locale: Locale, country: string) {
  if (productId) {
    const p = await getProduct(productId, locale, country);
    const offer = p?.offers.find((o) => o.offer_id === offerId);
    if (p && offer) return { product: p, offer };
  }
  const mock = findMockOffer(offerId);
  return mock ? { product: mock.product as ProductView, offer: mock.offer } : null;
}
