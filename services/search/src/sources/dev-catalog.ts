// Shared dev catalog written by the catalog service (packages/fixtures/dev-catalog.json).
// When present it replaces this service's own fixtures, so offer ids, prices and
// FX match what the catalog accepts at checkout.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, type Locale, type RawCategory, type RawProduct, type SearchOffer, type SourceCode, type SourceKind, type Translation } from '../types';
import { CategoryDirectory } from '../categories';

export interface DevCatalog {
  generated_at?: string;
  categories: { id: string; slug: string; parent_id: string | null; names: Partial<Record<string, string>> }[];
  sources?: { id: string; code: string; kind: SourceKind }[];
  products: {
    id: string;
    category_id: string | null;
    brand: string | null;
    gtin?: string | null;
    image_urls?: string[];
    rating: number | null;
    review_count?: number;
    popularity?: number;
    translations: Partial<Record<string, { title: string; description?: string | null; bullet_points?: string[] }>>;
  }[];
  offers: {
    id: string;
    product_id: string;
    source_code: string;
    kind?: SourceKind;
    external_id?: string;
    url: string | null;
    display_price_usd: number | null;
    list_price_local?: number | null;
    list_currency?: string | null;
    shipping_usd?: number | null;
    shipping_local?: number | null;
    ships_from: string | null;
    ships_to: string[];
    delivery_days_min: number | null;
    delivery_days_max: number | null;
    is_active?: boolean;
  }[];
  fx_rates?: Record<string, number>;
  currencies?: Record<string, number>;
}

/** services/search root (this file is src/sources/dev-catalog.ts). */
export const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_DEV_CATALOG_PATH = '../../packages/fixtures/dev-catalog.json';

/** DEV_CATALOG_PATH, resolved relative to services/search when not absolute. */
export function devCatalogPath(env: NodeJS.ProcessEnv = process.env): string {
  const p = env.DEV_CATALOG_PATH || DEFAULT_DEV_CATALOG_PATH;
  return isAbsolute(p) ? p : resolve(SERVICE_ROOT, p);
}

/** Parsed catalog, or null when the file is missing or unreadable (a warning is logged for the latter). */
export function loadDevCatalog(path = devCatalogPath()): DevCatalog | null {
  if (!existsSync(path)) return null;
  try {
    const cat = JSON.parse(readFileSync(path, 'utf8')) as DevCatalog;
    if (!Array.isArray(cat.products) || !Array.isArray(cat.offers) || !Array.isArray(cat.categories)) {
      throw new Error('missing categories/products/offers arrays');
    }
    return cat;
  } catch (err) {
    console.warn(`[dev-catalog] ignoring ${path}: ${(err as Error).message}`);
    return null;
  }
}

export function devCatalogCategories(cat: DevCatalog): RawCategory[] {
  return cat.categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id ?? null, names: c.names as Partial<Record<Locale, string>> }));
}

export function devCatalogRawProducts(cat: DevCatalog): RawProduct[] {
  const dir = new CategoryDirectory(devCatalogCategories(cat));
  const kindByCode = new Map((cat.sources ?? []).map((s) => [s.code, s.kind]));

  const offersByProduct = new Map<string, { offer: SearchOffer; local?: { currency: string; amount: number } }[]>();
  for (const o of cat.offers) {
    if (o.is_active === false || o.display_price_usd == null) continue;
    const kind = (o.kind ?? kindByCode.get(o.source_code) ?? 'dropship') as SourceKind;
    const offer: SearchOffer = {
      offer_id: o.id,
      source_code: o.source_code as SourceCode,
      kind,
      display_price_usd: Number(o.display_price_usd),
      delivery_days_min: o.delivery_days_min ?? null,
      delivery_days_max: o.delivery_days_max ?? null,
      ships_from: o.ships_from ?? null,
      ships_to: o.ships_to ?? [],
      url: o.url ?? null,
    };
    // Affiliate partners quote a price in their own currency; keep it so a shopper
    // paying in that currency sees the partner's exact price.
    const local =
      kind === 'affiliate' && o.list_currency && o.list_price_local != null
        ? { currency: o.list_currency.toUpperCase(), amount: Number(o.list_price_local) + Number(o.shipping_local ?? 0) }
        : undefined;
    const arr = offersByProduct.get(o.product_id) ?? [];
    arr.push({ offer, local });
    offersByProduct.set(o.product_id, arr);
  }

  return cat.products.map((p) => {
    const translations: Partial<Record<Locale, Translation>> = {};
    for (const [loc, t] of Object.entries(p.translations)) {
      if (!t?.title || !LOCALES.includes(loc as Locale)) continue;
      translations[loc as Locale] = { title: t.title, description: t.description ?? '', bullet_points: t.bullet_points ?? [] };
    }
    const offers = offersByProduct.get(p.id) ?? [];
    return {
      id: p.id,
      translations,
      brand: p.brand ?? null,
      gtin: p.gtin ?? null,
      categories: dir.chain(p.category_id),
      image: p.image_urls?.[0] ?? null,
      rating: p.rating ?? null,
      review_count: p.review_count ?? 0,
      popularity: p.popularity ?? 0,
      offers: offers.map((x) => x.offer),
      local_prices: offers.filter((x) => x.local).map((x) => ({ offer_id: x.offer.offer_id, ...x.local! })),
    };
  });
}
