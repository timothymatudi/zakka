import { afterAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { buildApp } from '../src/app';
import { fixturesRuntime } from '../src/bootstrap';
import { SearchService } from '../src/search';
import { Reindexer } from '../src/reindex';
import { loadConfig } from '../src/config';
import { loadDataset } from '../src/sources/dataset';
import { setCurrencyDecimals, setFxRates } from '../src/money';
import { CategoryDirectory } from '../src/categories';

const SAMPLE = resolve(__dirname, 'fixtures', 'dev-catalog.sample.json');
const P1 = '11111111-1111-4111-8111-111111111111';

function setup(adminToken = '') {
  const { memory, categories } = fixturesRuntime();
  const service = new SearchService(memory, { ai: { apiKey: '', model: 'test' }, categories });
  const cfg = { ...loadConfig({}), databaseUrl: '' };
  const reindexer = new Reindexer({
    cfg,
    engine: memory,
    memory,
    active: new Set(['KE', 'US']),
    loadDataset: () => loadDataset(SAMPLE),
    onDataset: (ds) => (service.categories = new CategoryDirectory(ds.categories)),
  });
  const app = buildApp(service, { engine: () => 'memory', documents: () => memory.count(), aiMode: 'rules' }, { reindexer, adminToken });
  apps.push(app);
  return { app, memory };
}

const apps: { close: () => unknown }[] = [];
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  setFxRates({});
  setCurrencyDecimals({});
});

describe('POST /admin/reindex', () => {
  it('without SEARCH_ADMIN_TOKEN: allows loopback, rejects remote callers', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/admin/reindex', remoteAddress: '10.0.0.5', payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/admin/reindex', payload: {} })).statusCode).toBe(200);
  });

  it('with SEARCH_ADMIN_TOKEN: requires the bearer token', async () => {
    const { app } = setup('s3cret-token');
    expect((await app.inject({ method: 'POST', url: '/admin/reindex', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/admin/reindex', headers: { authorization: 'Bearer nope' }, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/admin/reindex', headers: { authorization: 'Bearer s3cret-token' }, payload: {} })).statusCode).toBe(200);
  });

  it('memory mode reloads the dataset (and its categories) and reports counts', async () => {
    const { app, memory } = setup();
    expect(memory.count()).toBe(60);
    expect((await app.inject({ method: 'POST', url: '/admin/reindex' })).json()).toMatchObject({ reindexed: 2, duration_ms: expect.any(Number) });
    expect(memory.count()).toBe(2);
    expect((await app.inject({ method: 'POST', url: '/admin/reindex', payload: { product_ids: [P1, 'gone'] } })).json().reindexed).toBe(1);
    const hit = await app.inject({ method: 'GET', url: `/products/${P1}?country=KE&locale=sw` });
    expect(hit.json()).toMatchObject({ title: 'Simu janja Tecno Spark 20', category_path: ['Elektroniki', 'Simu'] });
  });

  it('validates product_ids', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/admin/reindex', payload: { product_ids: 'abc' } })).statusCode).toBe(400);
  });
});
