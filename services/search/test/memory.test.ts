import { describe, expect, it } from 'vitest';
import { fixturesRuntime } from '../src/bootstrap';
import { countryFields } from '../src/documents';
import type { EngineQuery, IndexedDocument } from '../src/types';

const { memory: engine } = fixturesRuntime();
const q = (over: Partial<EngineQuery>): EngineQuery => ({ q: '*', locale: 'en', country: 'US', sort: 'relevance', page: 1, per_page: 20, ...over });
const cf = (d: IndexedDocument, cc: string) => countryFields(d, cc)!;

describe('memory engine (dev)', () => {
  it('always filters to products that ship to the country', async () => {
    const r = await engine.search(q({ country: 'KE', per_page: 100 }));
    expect(r.found).toBeGreaterThan(10);
    expect(r.docs.every((d) => d.ships_to.includes('KE'))).toBe(true);
    expect((await engine.search(q({ country: 'ZZ' }))).found).toBe(0);
  });

  it('works for non-active countries via query-time country fields', async () => {
    const r = await engine.search(q({ country: 'PT', per_page: 100, max_price: 30 }));
    expect(r.found).toBeGreaterThan(0);
    for (const d of r.docs) {
      expect(d).not.toHaveProperty('cprice_PT');
      expect(cf(d, 'PT').price).toBeLessThanOrEqual(30);
    }
  });

  it('text relevance first: title matches beat better-selling non-matches', async () => {
    const r = await engine.search(q({ q: 'wireless earbuds' }));
    expect(r.docs[0].category_slugs).toContain('headphones');
    expect(r.docs.slice(0, 3).every((d) => /earbuds/i.test(d.title))).toBe(true);
  });

  it('within a relevance tier, sell score orders results', async () => {
    const r = await engine.search(q({ category: 'headphones' }));
    const sells = r.docs.map((d) => cf(d, 'US').sell);
    expect([...sells].sort((a, b) => b - a)).toEqual(sells);
  });

  it('price / days / rating / ships_from filters', async () => {
    const r = await engine.search(q({ country: 'KE', max_price: 20, max_days: 4, per_page: 100 }));
    expect(r.found).toBeGreaterThan(0);
    for (const d of r.docs) {
      expect(cf(d, 'KE').price).toBeLessThanOrEqual(20);
      expect(cf(d, 'KE').dmax).toBeLessThanOrEqual(4);
    }
    const rated = await engine.search(q({ min_rating: 4.6, per_page: 100 }));
    expect(rated.docs.every((d) => d.rating_sort >= 4.6)).toBe(true);
    const from = await engine.search(q({ country: 'KE', ships_from: ['KE'], per_page: 100 }));
    expect(from.docs.every((d) => d.offer_ships_from.includes('KE'))).toBe(true);
  });

  it('sorts by price, fastest and rating', async () => {
    const byPrice = await engine.search(q({ sort: 'price_asc', per_page: 100 }));
    const prices = byPrice.docs.map((d) => cf(d, 'US').price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    const fastest = await engine.search(q({ sort: 'fastest', per_page: 100 }));
    const days = fastest.docs.map((d) => cf(d, 'US').dmax);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    const rating = await engine.search(q({ sort: 'rating', per_page: 100 }));
    const rs = rating.docs.map((d) => d.rating_sort);
    expect([...rs].sort((a, b) => b - a)).toEqual(rs);
  });

  it('matches locale fields with fallback to base text, including zh and ar', async () => {
    expect((await engine.search(q({ locale: 'sw', country: 'KE', q: 'simu' }))).found).toBeGreaterThan(0);
    expect((await engine.search(q({ locale: 'zh', q: '耳机' }))).found).toBeGreaterThan(0);
    expect((await engine.search(q({ locale: 'ar', country: 'AE', q: 'سماعات' }))).found).toBeGreaterThan(0);
    expect((await engine.search(q({ locale: 'fr', country: 'FR', q: 'ecouteurs' }))).found).toBeGreaterThan(0);
    // fallback: a Swahili shopper searching English words still finds English-only products
    expect((await engine.search(q({ locale: 'sw', q: 'crocs' }))).found).toBe(1);
  });

  it('returns raw facets and paginates', async () => {
    const r = await engine.search(q({ per_page: 5, page: 2 }));
    expect(r.docs).toHaveLength(5);
    expect(Object.keys(r.facets).sort()).toEqual(['category_slug', 'price_bucket', 'rating', 'ships_from', 'source_kind']);
  });
});
