import { describe, expect, it } from 'vitest';
import { buildDocument, buildDocuments, countryFields, referencePricesFor, toHit } from '../src/documents';
import { CategoryDirectory } from '../src/categories';
import { fixtureRawProducts, FIXTURE_CATEGORIES } from '../src/sources/fixtures';
import { PRODUCTS } from '../fixtures/catalog';
import type { RawProduct } from '../src/types';

const cats = [
  { id: 'c1', slug: 'electronics', parent_id: null, names: { en: 'Electronics', sw: 'Elektroniki' } },
  { id: 'c2', slug: 'audio', parent_id: 'c1', names: { en: 'Audio' } },
];
const dir = new CategoryDirectory(cats);
const raw = (over: Partial<RawProduct> = {}): RawProduct => ({
  id: 'p1',
  translations: {
    en: { title: 'Wireless Earbuds', description: 'Bluetooth earbuds', bullet_points: ['ANC'] },
    sw: { title: 'Vipokea sauti', description: 'Bora', bullet_points: [] },
  },
  brand: 'X', gtin: '123', categories: cats, image: null, rating: 4.5, review_count: 10, popularity: 0.5,
  offers: [
    { offer_id: 'o1', source_code: 'cj', kind: 'dropship', display_price_usd: 12.5, delivery_days_min: 8, delivery_days_max: 15, ships_from: 'CN', ships_to: ['KE', 'US', 'SN'], url: null },
    { offer_id: 'o2', source_code: 'jumia', kind: 'affiliate', display_price_usd: 18, delivery_days_min: 1, delivery_days_max: 3, ships_from: 'KE', ships_to: ['ke'], url: 'https://example.com/x' },
  ],
  ...over,
});
const active = new Set(['KE', 'US']);
const ctx = { active, refs: {} };

describe('documents (single collection, all locales)', () => {
  it('stores base text once plus per-locale fields only for existing translations', () => {
    const d = buildDocument(raw(), ctx)!;
    expect(d.base_locale).toBe('en');
    expect(d.title).toBe('Wireless Earbuds');
    expect(d.title_sw).toBe('Vipokea sauti');
    expect(d).not.toHaveProperty('title_es');
    expect(d).not.toHaveProperty('title_en');
    expect(d.category_terms).toEqual(expect.arrayContaining(['electronics', 'Electronics', 'Elektroniki', 'audio', 'Audio']));
    expect(d.gtin).toBe('123');
  });

  it('per-country fields only for active countries; others computed at query time', () => {
    const d = buildDocument(raw(), ctx)!;
    expect(d.ships_to).toEqual(['KE', 'SN', 'US']);
    expect(d.cprice_KE).toBe(12.5);
    expect(d.cdmax_KE).toBe(3);
    expect(typeof d.csell_KE).toBe('number');
    expect(d).not.toHaveProperty('cprice_SN');
    expect(countryFields(d, 'SN')).toMatchObject({ price: 12.5, dmax: 15, bucket: '10-25' });
    expect(countryFields(d, 'KE')).toMatchObject({ price: 12.5, dmax: 3 });
    expect(countryFields(d, 'FR')).toBeNull();
  });

  it('drops products without priced offers or without any title', () => {
    expect(buildDocument(raw({ offers: [] }), ctx)).toBeNull();
    expect(buildDocument(raw({ translations: {} }), ctx)).toBeNull();
  });

  it('uses another locale as base when English is missing', () => {
    const d = buildDocument(raw({ translations: { sw: { title: 'Simu', description: '', bullet_points: [] } } }), ctx)!;
    expect(d.base_locale).toBe('sw');
    expect(d.title).toBe('Simu');
  });

  it('toHit localizes text and categories with fallback, filters offers to the country, strips internals', () => {
    const [d] = buildDocuments([raw()], active);
    const sw = toHit(d, 'ke', 'sw', dir);
    expect(sw.title).toBe('Vipokea sauti');
    expect(sw.category_path).toEqual(['Elektroniki', 'Audio']);
    const fr = toHit(d, 'US', 'fr', dir);
    expect(fr.title).toBe('Wireless Earbuds');
    expect(fr.offers.map((o) => o.offer_id)).toEqual(['o1']);
    expect(fr.fastest_days).toBe(8);
    expect(Object.keys(fr).sort()).toEqual(
      ['brand', 'category_ids', 'category_path', 'description', 'fastest_days', 'id', 'image', 'min_price_usd', 'offers', 'popularity', 'rating', 'review_count', 'ships_to', 'title'].sort(),
    );
  });

  it('reference prices: medians per category/country from the streaming histogram', () => {
    const many = Array.from({ length: 9 }, (_, i) => raw({ id: `p${i}`, offers: [{ ...raw().offers[0], display_price_usd: 10 * (i + 1) }] }));
    const refs = referencePricesFor(many, active);
    expect(refs['electronics|KE']).toBeGreaterThan(48);
    expect(refs['electronics|KE']).toBeLessThan(52); // true median 50, 2% buckets
    expect(refs['electronics|*']).toBeCloseTo(refs['electronics|KE'], 5);
  });

  it('fixtures: 60 products, one document each (not one per locale)', () => {
    expect(PRODUCTS).toHaveLength(60);
    const docs = buildDocuments(fixtureRawProducts(), active);
    expect(docs).toHaveLength(60);
    expect(new Set(docs.flatMap((d) => d.source_kinds))).toEqual(new Set(['dropship', 'affiliate']));
    const tecno = docs.find((d) => d.title.startsWith('Tecno Spark 20'))!;
    expect(tecno.title_sw).toMatch(/^Simu janja Tecno/);
    for (const o of docs.flatMap((d) => d.offers)) expect(o.kind === 'affiliate' ? !!o.url : o.url === null).toBe(true);
    expect(new CategoryDirectory(FIXTURE_CATEGORIES).size).toBe(24);
  });
});
