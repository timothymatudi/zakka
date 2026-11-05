import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { memoryEngineFromFixtures } from '../src/bootstrap';
import { SearchService } from '../src/search';
import { buildSearchParams } from '../src/engines/typesense';
import { categoryKeyFacet } from '../src/engines/memory';
import { currencyDecimals, fromUsd } from '../src/money';
import { fixtureProductId } from '../src/sources/fixtures';
import type { SearchHit } from '../src/types';

const memory = memoryEngineFromFixtures();
const service = new SearchService(memory, null, { apiKey: '', model: 'test' });
const app = buildApp(service, { engine: () => 'memory', documents: () => ({}), aiMode: 'rules' });
afterAll(() => app.close());

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() };
};

describe('GET /products/{id}', () => {
  const tecno = fixtureProductId(1); // ships to KE, NG and (via AliExpress) most countries, not CN

  it('returns one hit with offers filtered to the country and local prices', async () => {
    const { status, body } = await get(`/products/${tecno}?locale=sw&country=KE`);
    expect(status).toBe(200);
    const hit = body as SearchHit;
    expect(hit.id).toBe(tecno);
    expect(hit.title).toMatch(/^Simu janja Tecno/);
    expect(hit.offers.length).toBeGreaterThan(0);
    for (const o of hit.offers) {
      expect(o.ships_to).toContain('KE');
      expect(o.currency).toBe('KES');
      expect(o.display_price_local).toBe(fromUsd(o.display_price_usd, 'KES'));
    }
    expect(hit).not.toHaveProperty('cprice_KE');
  });

  it('404s for unknown ids and for countries the product does not ship to', async () => {
    expect((await get('/products/nope?country=KE')).status).toBe(404);
    expect((await get(`/products/${tecno}?country=CN`)).status).toBe(404);
  });

  it('400s on invalid locale or country', async () => {
    expect((await get(`/products/${tecno}?locale=xx`)).status).toBe(400);
    expect((await get(`/products/${tecno}?country=KEN`)).status).toBe(400);
  });
});

describe('/search additions', () => {
  it('min_rating filters by rating', async () => {
    const { body } = await get('/search?locale=en&country=US&min_rating=4.6&per_page=100');
    expect(body.found).toBeGreaterThan(0);
    for (const h of body.hits) expect(h.rating).toBeGreaterThanOrEqual(4.6);
  });

  it('ships_from keeps products with an offer shipping from one of the countries', async () => {
    const { body } = await get('/search?locale=en&country=KE&ships_from=ke,ng&per_page=100');
    expect(body.found).toBeGreaterThan(0);
    const all = await memory.search({ q: '*', locale: 'en', country: 'KE', ships_from: ['KE', 'NG'], sort: 'relevance', page: 1, per_page: 100 });
    expect(all.docs.every((d) => d.offer_ships_from.some((c) => c === 'KE' || c === 'NG'))).toBe(true);
    expect((await get('/search?ships_from=KEN')).status).toBe(400);
  });

  it('category_slug facet carries slug + localized label and drives the category filter', async () => {
    const { body } = await get('/search?q=simu&locale=sw&country=KE');
    const phones = body.facets.category_slug.find((f: { value: string }) => f.value === 'phones');
    expect(phones).toMatchObject({ value: 'phones', label: 'Simu' });
    const filtered = await get(`/search?locale=sw&country=KE&category=${phones.value}`);
    expect(filtered.body.found).toBe(phones.count);
  });

  it('every offer in /search hits has display_price_local and currency', async () => {
    const { body } = await get('/search?q=earbuds&locale=en&country=NG');
    expect(body.found).toBeGreaterThan(0);
    for (const h of body.hits) for (const o of h.offers) expect(o).toMatchObject({ currency: 'NGN', display_price_local: expect.any(Number) });
  });

  it('typesense params include the new filters and facet', () => {
    const p = buildSearchParams({ q: '*', locale: 'en', country: 'KE', sort: 'relevance', page: 1, per_page: 20, min_rating: 4, ships_from: ['KE', 'NG'] });
    expect(p.filter_by).toContain('rating_sort:>=4');
    expect(p.filter_by).toContain('offer_ships_from:=[KE,NG]');
    expect(p.facet_by).toContain('category_keys');
  });
});

describe('local currency helpers', () => {
  it('uses currency display decimals', () => {
    expect(currencyDecimals('USD')).toBe(2);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(fromUsd(10, 'KES')).toBe(1290);
    expect(fromUsd(1.234, 'USD')).toBe(1.23);
    expect(fromUsd(1, 'XXX')).toBeNull();
  });

  it('categoryKeyFacet splits slug and label', () => {
    expect(categoryKeyFacet({ value: 'phones|Simu', count: 3 })).toEqual({ value: 'phones', label: 'Simu', count: 3 });
  });
});
