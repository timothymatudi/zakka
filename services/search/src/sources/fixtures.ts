import { CATEGORIES, PRODUCTS, type FixtureCategory } from '../../fixtures/catalog';
import type { Locale, RawProduct, SourceCode, SourceKind } from '../types';

const DROPSHIP: SourceCode[] = ['cj', 'aliexpress_ds', 'spocket', 'printful'];
export const sourceKind = (code: SourceCode): SourceKind => (DROPSHIP.includes(code) ? 'dropship' : 'affiliate');

const uuid = (group: string, n: number) => `00000000-0000-4000-${group}-${String(n).padStart(12, '0')}`;
export const fixtureProductId = (n: number) => uuid('a000', n);
const categoryId = (slug: string) => uuid('c000', CATEGORIES.findIndex((c) => c.slug === slug) + 1);

const bySlug = new Map<string, FixtureCategory>(CATEGORIES.map((c) => [c.slug, c]));

function chain(slug: string): FixtureCategory[] {
  const out: FixtureCategory[] = [];
  let c = bySlug.get(slug);
  while (c) {
    out.unshift(c);
    c = c.parent ? bySlug.get(c.parent) : undefined;
  }
  return out;
}

/** Fixture products for a locale. Missing translations fall back to English. */
export function fixtureRawProducts(locale: Locale): RawProduct[] {
  return PRODUCTS.map((p) => {
    const [title, description, bullets] = p.t[locale] ?? p.t.en!;
    const cats = chain(p.cat);
    return {
      id: fixtureProductId(p.n),
      locale,
      title,
      description,
      bullet_points: bullets ?? p.t.en![2] ?? [],
      brand: p.brand,
      category_path: cats.map((c) => c.names[locale] ?? c.names.en ?? c.slug),
      category_ids: cats.map((c) => categoryId(c.slug)),
      category_slugs: cats.map((c) => c.slug),
      image: `https://picsum.photos/seed/zakka-${p.n}/600/600`,
      rating: p.rating,
      review_count: p.reviews,
      popularity: p.pop,
      offers: p.offers.map((o, i) => {
        const kind = sourceKind(o.source);
        const id = uuid('b000', p.n * 100 + i + 1);
        return {
          offer_id: id,
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

export const FIXTURE_CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);
