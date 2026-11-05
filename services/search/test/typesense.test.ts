import { describe, expect, it, vi } from 'vitest';
import { buildSearchParams } from '../src/engines/typesense';
import { collectionSchema } from '../src/schema';
import { catalogPriceClient } from '../src/sources/catalog-prices';
import { popularityFrom } from '../src/sources/postgres';

describe('typesense schema and params (no server needed)', () => {
  it('schema per locale with facets and locale-aware text fields', () => {
    const zh = collectionSchema('zh');
    expect(zh.name).toBe('products_zh');
    expect(zh.fields.find((f) => f.name === 'title')).toMatchObject({ locale: 'zh' });
    const en = collectionSchema('en');
    expect(en.fields.find((f) => f.name === 'title')?.locale).toBeUndefined();
    const facets = en.fields.filter((f) => f.facet).map((f) => f.name);
    for (const f of ['category_path', 'source_kinds', 'offer_ships_from', 'cpbucket_.*', 'rating_bucket']) expect(facets).toContain(f);
  });

  it('always filters on the shopper country and sorts relevance then sell score', () => {
    const p = buildSearchParams({ q: 'earbuds', locale: 'en', country: 'ke', sort: 'relevance', page: 1, per_page: 20, max_price: 50, max_days: 5, category: 'headphones' });
    expect(p.filter_by).toContain('cprice_KE:>0');
    expect(p.filter_by).toContain('cprice_KE:<=50');
    expect(p.filter_by).toContain('cdmax_KE:<=5');
    expect(p.filter_by).toContain('category_slugs:=`headphones`');
    expect(p.sort_by).toBe('_text_match(buckets: 5):desc,csell_KE:desc');
    expect(p.facet_by).toContain('cpbucket_KE');
  });
});

describe('catalog price client', () => {
  it('reads price_usd and memoizes', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ price: 3100, currency: 'KES', price_usd: 23.99 }))) as unknown as typeof fetch;
    const c = catalogPriceClient('http://catalog.test', f);
    expect(await c.priceUsd('o1', 'KE')).toBe(23.99);
    expect(await c.priceUsd('o1', 'KE')).toBe(23.99);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit when the catalog is unreachable', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const c = catalogPriceClient('http://catalog.test', f);
    expect(await c.priceUsd('o1', 'KE')).toBeNull();
    expect(await c.priceUsd('o2', 'KE')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('popularity', () => {
  it('is in 0..1 and grows with reviews and demand', () => {
    expect(popularityFrom(0, 0)).toBe(0);
    expect(popularityFrom(1e9, 1e9)).toBe(1);
    expect(popularityFrom(100, 50)).toBeGreaterThan(popularityFrom(100, 5));
  });
});
