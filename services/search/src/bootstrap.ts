import type { Config } from './config';
import type { SearchEngine } from './types';
import { MemoryEngine } from './engines/memory';
import { TypesenseEngine, typesenseClient, typesenseHealthy } from './engines/typesense';
import { SearchService } from './search';
import { loadActiveCountriesFromDb, loadCategoriesFromDb, loadCurrencyDecimalsFromDb, loadFxFromDb } from './sources/postgres';
import { setCurrencyDecimals, setFxRates } from './money';
import { fixturesDataset, loadDataset, type Dataset } from './sources/dataset';
import { Reindexer, applyDatasetMoney, datasetDocuments } from './reindex';
import { CategoryDirectory } from './categories';
import { LiveAffiliates } from './live';
import { DEFAULT_ACTIVE_COUNTRIES } from './config';

/** Memory engine + directory over this service's own fixtures (tests use these for stable data). */
export function fixturesRuntime(active = new Set(DEFAULT_ACTIVE_COUNTRIES)) {
  const ds = fixturesDataset();
  return { memory: new MemoryEngine(datasetDocuments(ds, active)), categories: new CategoryDirectory(ds.categories), dataset: ds };
}

export interface Runtime {
  service: SearchService;
  memory: MemoryEngine;
  engine: SearchEngine;
  reindexer: Reindexer;
  dataset: () => Dataset;
  active: Set<string>;
}

/** Active countries: `countries.is_active` from the DB when reachable, else config. */
export async function resolveActiveCountries(cfg: Config): Promise<Set<string>> {
  if (cfg.databaseUrl && !process.env.SEARCH_ACTIVE_COUNTRIES) {
    const db = await loadActiveCountriesFromDb(cfg.databaseUrl);
    if (db?.length) return new Set(db);
  }
  return new Set(cfg.activeCountries);
}

/**
 * Typesense when TYPESENSE_API_KEY is set and the server answers /health.
 * Otherwise (development) the in-memory engine over the offline dataset: the
 * catalog's dev catalog if present, else fixtures. The memory engine is also the
 * per-request fallback if Typesense errors later.
 */
export async function createService(cfg: Config): Promise<Runtime> {
  const active = await resolveActiveCountries(cfg);
  let dataset = loadDataset(cfg.devCatalogPath);
  console.warn(`[search] offline dataset: ${dataset.name}${dataset.path ? ` (${dataset.path})` : ''}`);
  applyDatasetMoney(dataset);
  const memory = new MemoryEngine(datasetDocuments(dataset, active));

  let engine: SearchEngine = memory;
  if (cfg.typesense.apiKey) {
    const client = typesenseClient(cfg.typesense);
    if (await typesenseHealthy(client)) engine = new TypesenseEngine(client, active);
    else console.warn(`[search] Typesense at ${cfg.typesense.host}:${cfg.typesense.port} unreachable; using in-memory dataset`);
  } else {
    console.warn('[search] TYPESENSE_API_KEY empty; using in-memory dataset (development only)');
  }

  let categories = new CategoryDirectory(dataset.categories);
  if (cfg.databaseUrl) {
    // Database values win over the dataset's.
    const fx = await loadFxFromDb(cfg.databaseUrl);
    if (fx && Object.keys(fx).length) setFxRates(fx);
    const decimals = await loadCurrencyDecimalsFromDb(cfg.databaseUrl);
    if (decimals && Object.keys(decimals).length) setCurrencyDecimals(decimals);
    if (engine !== memory) {
      const cats = await loadCategoriesFromDb(cfg.databaseUrl).catch(() => null);
      if (cats?.length) categories = new CategoryDirectory(cats);
    }
  }

  const live = cfg.liveAffiliates.enabled ? new LiveAffiliates(cfg.catalogApiUrl, { timeoutMs: cfg.liveAffiliates.timeoutMs }) : null;
  const service = new SearchService(engine, { fallback: engine === memory ? null : memory, ai: cfg.anthropic, categories, live });
  const reindexer = new Reindexer({
    cfg,
    engine,
    memory,
    active,
    onDataset: (ds) => {
      dataset = ds;
      if (engine === memory) service.categories = new CategoryDirectory(ds.categories);
    },
  });
  return { service, memory, engine, reindexer, dataset: () => dataset, active };
}
