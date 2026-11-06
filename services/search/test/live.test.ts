import { afterAll, describe, expect, it, vi } from 'vitest';
import { LiveAffiliates, liveToHit, type LiveItem } from '../src/live';
import { makeApp } from './helpers';

const item = (over: Partial<LiveItem> = {}): LiveItem => ({
  id: 'live-1',
  title: 'Live Earbuds from Partner',
  gtin: '999',
  offers: [
    { offer_id: 'lo-1', source_code: 'amazon', kind: 'affiliate', display_price_usd: 20, delivery_days_min: 1, delivery_days_max: 2, ships_from: 'US', ships_to: ['US'], url: 'https://example.com/a', list_price_local: 19.5, list_currency: 'USD', shipping_local: 0.49 },
  ],
  ...over,
});

const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('live affiliate client', () => {
  it('calls GET {catalog}/live with q, country, locale and accepts {hits} or arrays', async () => {
    const f = respond({ hits: [item(), { bogus: true }] });
    const live = new LiveAffiliates('http://catalog.test/', { fetchImpl: f });
    const items = await live.search('earbuds', 'US', 'en');
    expect(items.map((i) => i.id)).toEqual(['live-1']);
    expect((f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]).toBe('http://catalog.test/live?q=earbuds&country=US&locale=en');
    expect(await new LiveAffiliates('http://c', { fetchImpl: respond([item()]) }).search('x', 'US', 'en')).toHaveLength(1);
  });

  it('skips on timeout (800 ms) and backs off during the cooldown', async () => {
    let t = 0;
    const slow = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })))),
    ) as unknown as typeof fetch;
    const live = new LiveAffiliates('http://c', { fetchImpl: slow, timeoutMs: 30, cooldownMs: 1000, now: () => t });
    const started = Date.now();
    expect(await live.search('earbuds', 'US', 'en')).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
    t = 500;
    expect(await live.search('earbuds', 'US', 'en')).toEqual([]);
    expect(slow).toHaveBeenCalledTimes(1); // cooldown: no second call
    expect(new LiveAffiliates('http://c').search('', 'US', 'en')).resolves.toEqual([]);
  });

  it('liveToHit: offers for the country, partner price when currency matches', () => {
    const hit = liveToHit(item(), 'US')!;
    expect(hit.offers[0]).toMatchObject({ display_price_local: 19.99, currency: 'USD' });
    expect(hit.offers[0]).not.toHaveProperty('list_price_local');
    expect(liveToHit(item(), 'KE')).toBeNull();
  });
});

describe('/search federation', () => {
  const liveItems = [
    item(),
    item({ id: 'dup-by-gtin', title: 'Soundcore duplicate', gtin: '2000000000007' }), // fixture #7 Soundcore's GTIN
    item({ id: 'pricey', gtin: '555', offers: [{ ...item().offers[0], offer_id: 'lo-9', display_price_usd: 900 }] }),
  ];
  const { app, get } = makeApp({ live: new LiveAffiliates('http://catalog.test', { fetchImpl: respond({ hits: liveItems }) }) });
  afterAll(() => app.close());

  it('appends live hits after indexed results on page 1, deduped by GTIN', async () => {
    const { body } = await get('/search?q=wireless%20earbuds&locale=en&country=US&max_price=100&debug=1');
    const ids = body.hits.map((h: { id: string }) => h.id);
    expect(ids[ids.length - 1]).toBe('live-1');
    expect(ids).not.toContain('dup-by-gtin');
    expect(ids).not.toContain('pricey'); // over max_price
    expect(body.debug.live).toBe(1);
    expect(body.found).toBe(body.hits.length);
  });

  it('no live results on later pages or when the catalog is down', async () => {
    expect((await get('/search?q=earbuds&country=US&page=2&per_page=2&debug=1')).body.debug.live).toBe(0);
    const down = makeApp({ live: new LiveAffiliates('http://catalog.test', { fetchImpl: respond({}, 503) }) });
    const r = await down.get('/search?q=earbuds&country=US&debug=1');
    expect(r.status).toBe(200);
    expect(r.body.debug.live).toBe(0);
    await down.app.close();
  });
});
