// The offline dataset: the catalog's shared dev catalog when it exists,
// otherwise this service's own fixtures.
import type { RawCategory, RawProduct } from '../types';
import { devCatalogCategories, devCatalogPath, devCatalogRawProducts, loadDevCatalog } from './dev-catalog';
import { FIXTURE_CATEGORIES, fixtureRawProducts } from './fixtures';

export interface Dataset {
  name: 'dev-catalog' | 'fixtures';
  /** File the dataset came from (dev-catalog only). */
  path?: string;
  products: RawProduct[];
  categories: RawCategory[];
  fxRates?: Record<string, number>;
  currencyDecimals?: Record<string, number>;
}

export function fixturesDataset(): Dataset {
  return { name: 'fixtures', products: fixtureRawProducts(), categories: FIXTURE_CATEGORIES };
}

export function loadDataset(path = devCatalogPath()): Dataset {
  const cat = loadDevCatalog(path);
  if (!cat) return fixturesDataset();
  return {
    name: 'dev-catalog',
    path,
    products: devCatalogRawProducts(cat),
    categories: devCatalogCategories(cat),
    fxRates: cat.fx_rates,
    currencyDecimals: cat.currencies,
  };
}
