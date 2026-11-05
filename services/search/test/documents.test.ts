import { describe, expect, it } from 'vitest';
import { buildDocument, buildDocuments, toHit } from '../src/documents';
import { fixtureRawProducts } from '../src/sources/fixtures';
import { PRODUCTS } from '../fixtures/catalog';
import type { RawProduct } from '../src/types';

const raw = (over: Partial<RawProduct> = {}): RawProduct => ({
  id: 'p1', locale: 'en', title: 'Earbuds', description: 'd', bullet_points: [], brand: 'X',
  category_path: ['Electronics', 'Audio'], category_ids: ['c1', 'c2'], category_slugs: ['electronics', 'audio'],
  image: null, rating: 4.5, review_count: 10, popularity: 0.5,
  offers: [
    { offer_id: 'o1', source_code: 'cj', kind: 'dropship', display_price_usd: 12.5, delivery_days_min: 8, delivery_days_max: 15, ships_from: 'CN', ships_to: ['KE', 'US'], url: null },
    { offer_id: 'o2', source_code: 'jumia', kind: 'affiliate', display_price_usd: 18, delivery_days_min: 1, delivery_days_max: 3, ships_from: 'KE', ships_to: ['ke'], url: 'https://example.com/x' },
  ],
  ...over,
});

describe('documents', () => {
  it('builds contract fields and per-country fields', () => {
    const d = buildDocument(raw())!;
    expect(d.min_price_usd).toBe(12.5);
    expect(d.ships_to).toEqual(['KE', 'US']);
    expect(d.fastest_days).toBe(1);
    expect(d.cprice_KE).toBe(12.5);
    expect(d.cdays_KE).toBe(1);
    expect(d.cdmax_KE).toBe(3);
    expect(d.cprice_US).toBe(12.5);
    expect(d.cdays_US).toBe(8);
    expect(d.source_kinds).toEqual(['affiliate', 'dropship']);
    expect(d.cpbucket_KE).toBe('10-25');
  });

  it('drops products without priced offers', () => {
    expect(buildDocument(raw({ offers: [] }))).toBeNull();
  });

  it('toHit keeps only offers shipping to the country and strips internal fields', () => {
    const [d] = buildDocuments([raw()]);
    const hit = toHit(d, 'us');
    expect(hit.offers.map((o) => o.offer_id)).toEqual(['o1']);
    expect(hit.fastest_days).toBe(8);
    expect(Object.keys(hit).sort()).toEqual(
      ['brand', 'category_ids', 'category_path', 'description', 'fastest_days', 'id', 'image', 'min_price_usd', 'offers', 'popularity', 'rating', 'review_count', 'ships_to', 'title'].sort(),
    );
  });

  it('fixtures: 60 products, both source kinds, many origins, translations with en fallback', () => {
    expect(PRODUCTS).toHaveLength(60);
    const docs = buildDocuments(fixtureRawProducts('sw'));
    expect(docs).toHaveLength(60);
    const kinds = new Set(docs.flatMap((d) => d.source_kinds));
    expect(kinds).toEqual(new Set(['dropship', 'affiliate']));
    expect(new Set(docs.flatMap((d) => d.offer_ships_from)).size).toBeGreaterThanOrEqual(6);
    expect(docs.find((d) => d.title.startsWith('Simu janja Tecno'))).toBeTruthy();
    expect(docs.every((d) => d.ships_to.every((cc) => typeof d[`csell_${cc}`] === 'number'))).toBe(true);
    // affiliate offers carry a URL, dropship offers do not
    for (const o of docs.flatMap((d) => d.offers)) expect(o.kind === 'affiliate' ? !!o.url : o.url === null).toBe(true);
  });
});
