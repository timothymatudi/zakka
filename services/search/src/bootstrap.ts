import type { Config } from './config';
import { LOCALES, type IndexedDocument, type Locale, type SearchEngine } from './types';
import { buildDocuments } from './documents';
import { fixtureRawProducts } from './sources/fixtures';
import { MemoryEngine } from './engines/memory';
import { TypesenseEngine, typesenseClient, typesenseHealthy } from './engines/typesense';
import { SearchService } from './search';
import { loadCurrencyDecimalsFromDb, loadFxFromDb } from './sources/postgres';
import { setCurrencyDecimals, setFxRates } from './money';

export function fixtureDocuments(): Record<Locale, IndexedDocument[]> {
  return Object.fromEntries(LOCALES.map((l) => [l, buildDocuments(fixtureRawProducts(l))])) as Record<Locale, IndexedDocument[]>;
}

export function memoryEngineFromFixtures(): MemoryEngine {
  return new MemoryEngine(fixtureDocuments());
}

/**
 * Typesense when TYPESENSE_API_KEY is set and the server answers /health,
 * otherwise the in-memory engine over fixtures. The memory engine is also the
 * per-request fallback if Typesense errors later.
 */
export async function createService(cfg: Config): Promise<{ service: SearchService; memory: MemoryEngine; engine: SearchEngine }> {
  const memory = memoryEngineFromFixtures();
  let engine: SearchEngine = memory;
  if (cfg.typesense.apiKey) {
    const client = typesenseClient(cfg.typesense);
    if (await typesenseHealthy(client)) engine = new TypesenseEngine(client);
    else console.warn(`[search] Typesense at ${cfg.typesense.host}:${cfg.typesense.port} unreachable; using in-memory fixtures`);
  } else {
    console.warn('[search] TYPESENSE_API_KEY empty; using in-memory fixtures engine');
  }
  if (cfg.databaseUrl) {
    const fx = await loadFxFromDb(cfg.databaseUrl);
    if (fx && Object.keys(fx).length) setFxRates(fx);
    const decimals = await loadCurrencyDecimalsFromDb(cfg.databaseUrl);
    if (decimals && Object.keys(decimals).length) setCurrencyDecimals(decimals);
  }
  const service = new SearchService(engine, engine === memory ? null : memory, cfg.anthropic);
  return { service, memory, engine };
}
