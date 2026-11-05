import { describe, expect, it } from 'vitest';
import { memoryEngineFromFixtures } from '../src/bootstrap';
import type { EngineQuery } from '../src/types';

const engine = memoryEngineFromFixtures();
const q = (over: Partial<EngineQuery>): EngineQuery => ({ q: '*', locale: 'en', country: 'US', sort: 'relevance', page: 1, per_page: 20, ...over });

describe('memory engine', () => {
  it('always filters to products that ship to the country', async () => {
    const r = await engine.search(q({ country: 'KE', per_page: 100 }));
    expect(r.found).toBeGreaterThan(10);
    expect(r.docs.every((d) => d.ships_to.includes('KE'))).toBe(true);
    const none = await engine.search(q({ country: 'ZZ' }));
    expect(none.found).toBe(0);
  });

  it('text relevance first: title matches beat better-selling non-matches', async () => {
    const r = await engine.search(q({ q: 'wireless earbuds' }));
    expect(r.docs[0].category_slugs).toContain('headphones');
    expect(r.docs.slice(0, 3).every((d) => /earbuds/i.test(d.title))).toBe(true);
  });

  it('within a relevance bucket, sell score orders results', async () => {
    const r = await engine.search(q({ category: 'headphones', country: 'US' }));
    const sells = r.docs.map((d) => d.csell_US as number);
    expect([...sells].sort((a, b) => b - a)).toEqual(sells);
  });

  it('price / days filters use the per-country values', async () => {
    const r = await engine.search(q({ country: 'KE', max_price: 20, max_days: 4, per_page: 100 }));
    expect(r.found).toBeGreaterThan(0);
    for (const d of r.docs) {
      expect(d.cprice_KE as number).toBeLessThanOrEqual(20);
      expect(d.cdmax_KE as number).toBeLessThanOrEqual(4);
    }
  });

  it('sorts by price, fastest and rating', async () => {
    const byPrice = await engine.search(q({ sort: 'price_asc', per_page: 100 }));
    const prices = byPrice.docs.map((d) => d.cprice_US as number);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    const fastest = await engine.search(q({ sort: 'fastest', per_page: 100 }));
    const days = fastest.docs.map((d) => d.cdays_US as number);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    const rating = await engine.search(q({ sort: 'rating', per_page: 100 }));
    const rs = rating.docs.map((d) => d.rating_sort);
    expect([...rs].sort((a, b) => b - a)).toEqual(rs);
  });

  it('matches non-English locales including zh and ar', async () => {
    expect((await engine.search(q({ locale: 'sw', country: 'KE', q: 'simu' }))).found).toBeGreaterThan(0);
    expect((await engine.search(q({ locale: 'zh', country: 'US', q: '耳机' }))).found).toBeGreaterThan(0);
    expect((await engine.search(q({ locale: 'ar', country: 'AE', q: 'سماعات' }))).found).toBeGreaterThan(0);
    expect((await engine.search(q({ locale: 'fr', country: 'FR', q: 'ecouteurs' }))).found).toBeGreaterThan(0);
  });

  it('returns facets and paginates', async () => {
    const r = await engine.search(q({ per_page: 5, page: 2 }));
    expect(r.docs).toHaveLength(5);
    expect(Object.keys(r.facets).sort()).toEqual(['category_path', 'price_bucket', 'rating', 'ships_from', 'source_kind']);
    expect(r.facets.source_kind.map((f) => f.value).sort()).toEqual(['affiliate', 'dropship']);
  });
});
