import { describe, expect, it, vi } from 'vitest';
import { buildSearchParams, countryFieldNames } from '../src/engines/typesense';
import { collectionSchema, COLLECTION } from '../src/schema';
import { catalogPriceClient } from '../src/sources/catalog-prices';
import { popularityFrom } from '../src/sources/postgres';
import type { EngineQuery } from '../src/types';

const ACTIVE = new Set(['KE', 'US']);
const q = (over: Partial<EngineQuery>): EngineQuery => ({ q: 'earbuds', locale: 'en', country: 'KE', sort: 'relevance', page: 1, per_page: 20, ...over });

describe('typesense schema and params (no server needed)', () => {
  it('one products collection with per-locale optional text fields and locale settings', () => {
    const s = collectionSchema();
    expect(s.name).toBe(COLLECTION);
    expect(s.fields.find((f) => f.name === 'title')).toMatchObject({ stem: true });
    expect(s.fields.find((f) => f.name === 'title_zh')).toMatchObject({ locale: 'zh', optional: true });
    expect(s.fields.find((f) => f.name === 'title_en')).toBeUndefined();
    expect(s.fields.filter((f) => /^(title|description)_/.test(f.name))).toHaveLength(18);
    const facets = s.fields.filter((f) => f.facet).map((f) => f.name);
    for (const f of ['category_slugs', 'source_kinds', 'offer_ships_from', 'rating_bucket', 'cprice_.*', 'min_price_usd']) expect(facets).toContain(f);
    // compact per-country fields: price, delivery, sell score only
    expect(s.fields.filter((f) => f.name.endsWith('_.*')).map((f) => f.name)).toEqual(['cprice_.*', 'cdmax_.*', 'csell_.*']);
  });

  it('active country: per-country fields for filter, sort and price facet', () => {
    const p = buildSearchParams(q({ max_price: 50, max_days: 5, category: 'headphones' }), ACTIVE);
    expect(p.filter_by).toBe('cprice_KE:>0 && category_slugs:=`headphones` && cprice_KE:<=50 && cdmax_KE:<=5');
    expect(p.sort_by).toBe('_text_match(buckets: 5):desc,csell_KE:desc');
    expect(p.facet_by).toContain('cprice_KE(p0:[0,10],p1:[10,25],p2:[25,50],p3:[50,100],p4:[100,250],p5:[250,])');
    expect(p.query_by).toBe('title,brand,category_terms,bullets,description');
  });

  it('non-active country: ships_to filter and global fields', () => {
    const p = buildSearchParams(q({ country: 'sn', max_price: 50, sort: 'fastest' }), ACTIVE);
    expect(p.filter_by).toBe('ships_to:=[SN] && min_price_usd:<=50');
    expect(p.sort_by).toBe('best_dmax:asc,sell_global:desc');
    expect(countryFieldNames('SN', ACTIVE)).toMatchObject({ isActive: false, price: 'min_price_usd' });
  });

  it('locale queries the locale fields first, falls back to base text, and excludes other locales', () => {
    const p = buildSearchParams(q({ locale: 'sw' }), ACTIVE);
    expect(p.query_by).toBe('title_sw,title,brand,category_terms,description_sw,description,bullets');
    expect(String(p.exclude_fields)).toContain('title_zh');
    expect(String(p.exclude_fields)).not.toContain('title_sw');
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
