import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { devCatalogPath, devCatalogRawProducts, loadDevCatalog } from '../src/sources/dev-catalog';
import { loadDataset } from '../src/sources/dataset';
import { buildDocuments, toHit } from '../src/documents';
import { setCurrencyDecimals, setFxRates } from '../src/money';
import { applyDatasetMoney } from '../src/reindex';
import { CategoryDirectory } from '../src/categories';

const SAMPLE = resolve(__dirname, 'fixtures', 'dev-catalog.sample.json');
const P1 = '11111111-1111-4111-8111-111111111111';
const ACTIVE = new Set(['KE']);

afterEach(() => {
  setFxRates({});
  setCurrencyDecimals({});
});

describe('dev catalog loader', () => {
  it('resolves DEV_CATALOG_PATH relative to services/search, default packages/fixtures', () => {
    expect(devCatalogPath({})).toMatch(/packages[\\/]fixtures[\\/]dev-catalog\.json$/);
    expect(devCatalogPath({ DEV_CATALOG_PATH: SAMPLE })).toBe(SAMPLE);
  });

  it('falls back to own fixtures when the file is missing or malformed', () => {
    expect(loadDataset(join(tmpdir(), 'zakka-no-such-file.json')).name).toBe('fixtures');
    const dir = mkdtempSync(join(tmpdir(), 'zakka-search-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"products": 1}');
    expect(loadDevCatalog(bad)).toBeNull();
    expect(loadDataset(bad).name).toBe('fixtures');
  });

  it('maps products with all translations, category chains and offers (catalog ids kept)', () => {
    const raws = devCatalogRawProducts(loadDevCatalog(SAMPLE)!);
    const p1 = raws.find((p) => p.id === P1)!;
    expect(Object.keys(p1.translations).sort()).toEqual(['en', 'sw']);
    expect(p1.categories.map((c) => c.slug)).toEqual(['electronics', 'phones']);
    expect(p1.image).toBe('https://example.com/p1.jpg');
    expect(p1.offers.map((o) => o.offer_id).sort()).toEqual(['off-1-cj', 'off-1-ju']);
    expect(p1.offers.find((o) => o.offer_id === 'off-1-cj')!.kind).toBe('dropship'); // from sources[]
    expect(p1.local_prices).toEqual([{ offer_id: 'off-1-ju', currency: 'KES', amount: 16649 }]);
  });

  it('skips inactive offers, so products with none are not indexed', () => {
    const docs = buildDocuments(devCatalogRawProducts(loadDevCatalog(SAMPLE)!), ACTIVE);
    expect(docs.map((d) => d.id).sort()).toEqual([P1, '22222222-2222-4222-8222-222222222222']);
  });

  it('affiliate list price is used when its currency matches the request currency; localized text/categories', () => {
    const ds = loadDataset(SAMPLE);
    expect(ds.name).toBe('dev-catalog');
    applyDatasetMoney(ds);
    const dir = new CategoryDirectory(ds.categories);
    const doc = buildDocuments(ds.products, ACTIVE).find((d) => d.id === P1)!;
    const ke = toHit(doc, 'KE', 'sw', dir);
    expect(ke.title).toBe('Simu janja Tecno Spark 20');
    expect(ke.category_path).toEqual(['Elektroniki', 'Simu']);
    expect(ke.offers.find((o) => o.offer_id === 'off-1-ju')).toMatchObject({ currency: 'KES', display_price_local: 16649 });
    expect(ke.offers.find((o) => o.offer_id === 'off-1-cj')).toMatchObject({ currency: 'KES', display_price_local: Math.round(119.99 * 130) });
    const ng = toHit(doc, 'NG', 'en', dir);
    expect(ng.offers.map((o) => o.offer_id)).toEqual(['off-1-cj']);
    expect(ng.offers[0]).toMatchObject({ currency: 'NGN', display_price_local: Math.round(119.99 * 1600) });
    const audio = toHit(buildDocuments(ds.products, ACTIVE).find((d) => d.id.startsWith('2222'))!, 'KE', 'sw', dir);
    expect(audio.category_path).toEqual(['Elektroniki', 'Audio']); // en fallback for an untranslated category
  });
});
