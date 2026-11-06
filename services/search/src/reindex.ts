// Full and incremental (re)indexing, shared by the CLI and POST /admin/reindex.
//  - Typesense: products stream from Postgres (or the offline dataset when no
//    DATABASE_URL), documents are imported as JSONL batches of 5,000. A full run
//    recomputes reference prices and saves them; an incremental run (product ids)
//    reuses the saved ones and deletes ids that no longer produce a document.
//  - Memory (dev): the offline dataset is re-read from disk and swapped in.
import { join } from 'node:path';
import type { Config } from './config';
import type { IndexedDocument, RawProduct, SearchEngine } from './types';
import { buildDocuments, type ReferencePrices } from './documents';
import { MemoryEngine } from './engines/memory';
import { TypesenseEngine, deleteFromTypesense, ensureCollection, typesenseImporter, type TsClient } from './engines/typesense';
import { loadDataset, type Dataset } from './sources/dataset';
import { loadCategoriesFromDb, streamRawProductsFromDb } from './sources/postgres';
import { catalogPriceClient } from './sources/catalog-prices';
import { setCurrencyDecimals, setFxRates } from './money';
import { CategoryDirectory } from './categories';
import {
  DEFAULT_BATCH_SIZE,
  indexStream,
  loadReferencePrices,
  pagesOf,
  referencePricesFromStream,
  saveReferencePrices,
  type ImportFn,
  type IndexStats,
} from './indexer';

export interface ReindexResult {
  reindexed: number;
  duration_ms: number;
}

/** Use the dataset's FX rates and currency decimals (offline stand-ins for fx_rates/currencies). */
export function applyDatasetMoney(ds: Dataset): void {
  if (ds.fxRates && Object.keys(ds.fxRates).length) setFxRates(ds.fxRates);
  if (ds.currencyDecimals && Object.keys(ds.currencyDecimals).length) setCurrencyDecimals(ds.currencyDecimals);
}

export function datasetDocuments(ds: Dataset, active: Set<string>): IndexedDocument[] {
  return buildDocuments(ds.products, active);
}

export const referencePricesPath = (cfg: Config) => join(cfg.dataDir, 'reference-prices.json');

export interface IndexRunOptions {
  cfg: Config;
  active: Set<string>;
  importFn: ImportFn;
  /** Offline dataset, used when cfg.databaseUrl is empty. */
  dataset?: Dataset;
  productIds?: string[];
  batchSize?: number;
  log?: (m: string) => void;
}

/** Full or incremental index run into any JSONL sink (Typesense or a file). */
export async function runIndex(opts: IndexRunOptions): Promise<IndexStats & { seenIds: Set<string> }> {
  const { cfg, active } = opts;
  const ids = opts.productIds?.length ? opts.productIds : undefined;
  const prices = catalogPriceClient(cfg.catalogApiUrl);
  const dbDir = cfg.databaseUrl ? new CategoryDirectory(await loadCategoriesFromDb(cfg.databaseUrl)) : undefined;
  const ds = cfg.databaseUrl ? undefined : (opts.dataset ?? loadDataset(cfg.devCatalogPath));
  const pages = (only?: string[]): AsyncIterable<RawProduct[]> => {
    if (cfg.databaseUrl) return streamRawProductsFromDb(cfg.databaseUrl, { prices, categories: dbDir, productIds: only, pageSize: 2000 });
    const set = only ? new Set(only) : null;
    return pagesOf(set ? ds!.products.filter((p) => set.has(p.id)) : ds!.products, 2000);
  };

  let refs: ReferencePrices | null = ids ? loadReferencePrices(referencePricesPath(cfg)) : null;
  if (!refs) {
    refs = await referencePricesFromStream(pages(), active);
    saveReferencePrices(referencePricesPath(cfg), refs);
  }
  const seenIds = new Set<string>();
  const stats = await indexStream(pages(ids), { active, refs }, opts.importFn, {
    batchSize: opts.batchSize ?? DEFAULT_BATCH_SIZE,
    log: opts.log,
    onDoc: (d) => seenIds.add(d.id),
  });
  return { ...stats, seenIds };
}

export class Reindexer {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private deps: {
      cfg: Config;
      engine: SearchEngine;
      memory: MemoryEngine;
      active: Set<string>;
      /** Re-reads the offline dataset (injectable for tests). */
      loadDataset?: () => Dataset;
      onDataset?: (ds: Dataset) => void;
    },
  ) {}

  /** Runs reindexes one at a time so the hourly job and manual calls don't interleave. */
  reindex(productIds?: string[]): Promise<ReindexResult> {
    const run = this.queue.then(() => this.run(productIds));
    this.queue = run.catch(() => {});
    return run;
  }

  private async run(productIds?: string[]): Promise<ReindexResult> {
    const started = Date.now();
    const ids = productIds?.length ? [...new Set(productIds)] : undefined;
    const { engine, cfg, active } = this.deps;
    const loadDs = this.deps.loadDataset ?? (() => loadDataset(cfg.devCatalogPath));

    if (engine instanceof TypesenseEngine) {
      const client: TsClient = engine.client;
      await ensureCollection(client);
      const stats = await runIndex({ cfg, active, importFn: typesenseImporter(client), productIds: ids, dataset: cfg.databaseUrl ? undefined : loadDs() });
      if (ids) {
        const gone = ids.filter((id) => !stats.seenIds.has(id));
        if (gone.length) await deleteFromTypesense(client, gone);
      }
      return { reindexed: stats.indexed, duration_ms: Date.now() - started };
    }

    const ds = loadDs();
    applyDatasetMoney(ds);
    const docs = datasetDocuments(ds, active);
    this.deps.memory.replaceAll(docs);
    this.deps.onDataset?.(ds);
    const present = new Set(docs.map((d) => d.id));
    return { reindexed: ids ? ids.filter((id) => present.has(id)).length : present.size, duration_ms: Date.now() - started };
  }
}
