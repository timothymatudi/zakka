import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { memoryEngineFromFixtures } from '../src/bootstrap';
import { SearchService } from '../src/search';
import type { SearchResponse } from '../src/types';

const memory = memoryEngineFromFixtures();
const service = new SearchService(memory, null, { apiKey: '', model: 'test' });
const app = buildApp(service, { engine: () => 'memory', documents: () => ({ en: memory.count('en') }), aiMode: 'rules' });
afterAll(() => app.close());

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() };
};

describe('HTTP API', () => {
  it('GET /health', async () => {
    const { status, body } = await get('/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', engine: 'memory', documents: { en: 60 } });
  });

  it('GET /search returns the contract shape', async () => {
    const { status, body } = await get('/search?q=wireless%20earbuds&locale=en&country=US');
    expect(status).toBe(200);
    const r = body as SearchResponse;
    expect(Object.keys(r).sort()).toEqual(['facets', 'found', 'hits', 'page']);
    expect(r.page).toBe(1);
    expect(r.found).toBeGreaterThan(0);
    for (const h of r.hits) {
      expect(h.ships_to).toContain('US');
      expect(h.offers.every((o) => o.ships_to.includes('US'))).toBe(true);
      expect(h).not.toHaveProperty('cprice_US');
    }
  });

  it('understands "simu nzuri chini ya 20,000 KES" for Kenya', async () => {
    const { body } = await get('/search?' + new URLSearchParams({ q: 'simu nzuri chini ya 20,000 KES', locale: 'sw', country: 'KE', debug: '1' }));
    expect(body.debug.understanding).toMatchObject({ max_price: 20000, currency: 'KES', category_hint: 'phones' });
    expect(body.debug.effective.max_price).toBeCloseTo(155.04, 1);
    expect(body.found).toBeGreaterThan(0);
    for (const h of body.hits) {
      expect(h.category_path).toContain('Simu');
      expect(h.min_price_usd).toBeLessThanOrEqual(155.04);
    }
  });

  it('falls back to the category hint when keywords match nothing in the locale', async () => {
    // English catalog; the Swahili word "simu" has no English match.
    const { body } = await get('/search?' + new URLSearchParams({ q: 'simu', locale: 'en', country: 'KE', debug: '1' }));
    expect(body.found).toBeGreaterThan(0);
    expect(body.debug.effective.category).toBe('phones');
  });

  it('explicit params override inferred ones, and validation errors are 400', async () => {
    const { body } = await get('/search?' + new URLSearchParams({ q: 'earbuds under $5', locale: 'en', country: 'US', max_price: '100', debug: '1' }));
    expect(body.debug.effective.max_price).toBe(100);
    expect((await get('/search?q=x&locale=xx')).status).toBe(400);
    expect((await get('/search?q=x&country=USA')).status).toBe(400);
    expect((await get('/search?q=x&sort=cheap')).status).toBe(400);
    expect((await get('/search?q=x&page=0')).status).toBe(400);
  });

  it('empty q browses everything for the country with paging', async () => {
    const { body } = await get('/search?locale=en&country=AE&per_page=3&page=2&sort=price_asc');
    expect(body.hits).toHaveLength(3);
    expect(body.page).toBe(2);
    const prices = body.hits.map((h: { min_price_usd: number }) => h.min_price_usd);
    expect([...prices].sort((a: number, b: number) => a - b)).toEqual(prices);
  });
});
