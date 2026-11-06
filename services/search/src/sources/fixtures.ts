import { CATEGORIES, PRODUCTS } from '../../fixtures/catalog';
import type { Locale, RawCategory, RawProduct, SourceCode, SourceKind, Translation } from '../types';

const DROPSHIP: SourceCode[] = ['cj', 'aliexpress_ds', 'spocket', 'printful'];
export const sourceKind = (code: SourceCode): SourceKind => (DROPSHIP.includes(code) ? 'dropship' : 'affiliate');

const uuid = (group: string, n: number) => `00000000-0000-4000-${group}-${String(n).padStart(12, '0')}`;
export const fixtureProductId = (n: number) => uuid('a000', n);

export const FIXTURE_CATEGORIES: RawCategory[] = CATEGORIES.map((c, i) => ({
  id: uuid('c000', i + 1),
  slug: c.slug,
  parent_id: c.parent ? uuid('c000', CATEGORIES.findIndex((p) => p.slug === c.parent) + 1) : null,
  names: c.names,
}));
const bySlug = new Map(FIXTURE_CATEGORIES.map((c) => [c.slug, c]));
const byId = new Map(FIXTURE_CATEGORIES.map((c) => [c.id, c]));

function chain(slug: string): RawCategory[] {
  const out: RawCategory[] = [];
  let c = bySlug.get(slug);
  while (c) {
    out.unshift(c);
    c = c.parent_id ? byId.get(c.parent_id) : undefined;
  }
  return out;
}

/** This service's own sample products (all translations per product). */
export function fixtureRawProducts(): RawProduct[] {
  return PRODUCTS.map((p) => {
    const translations: Partial<Record<Locale, Translation>> = {};
    for (const [loc, t] of Object.entries(p.t)) {
      if (!t) continue;
      translations[loc as Locale] = { title: t[0], description: t[1], bullet_points: t[2] ?? (loc === 'en' ? [] : p.t.en?.[2] ?? []) };
    }
    return {
      id: fixtureProductId(p.n),
      translations,
      brand: p.brand,
      gtin: `20000000${String(p.n).padStart(5, '0')}`,
      categories: chain(p.cat),
      image: `https://picsum.photos/seed/zakka-${p.n}/600/600`,
      rating: p.rating,
      review_count: p.reviews,
      popularity: p.pop,
      offers: p.offers.map((o, i) => {
        const kind = sourceKind(o.source);
        return {
          offer_id: uuid('b000', p.n * 100 + i + 1),
          source_code: o.source,
          kind,
          display_price_usd: o.price,
          delivery_days_min: o.days[0],
          delivery_days_max: o.days[1],
          ships_from: o.from,
          ships_to: o.to,
          // Affiliate offers click out; dropship offers are bought on Zakka.
          url: kind === 'affiliate' ? `https://example.com/aff/${o.source}/${p.n}` : null,
        };
      }),
    };
  });
}
