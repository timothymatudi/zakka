// npm run bench -- --products 1000000 [--batch 5000] [--queries 200] [--sink file|null] [--collection products_bench] [--keep]
//
// 1. Generates synthetic products and runs the real indexing pipeline (reference
//    prices, document build, JSONL batches): into Typesense when TYPESENSE_* points
//    at a live server, otherwise into a file (or /dev/null with --sink null).
// 2. With a live Typesense, runs a mixed query workload and reports p50/p95/p99
//    latency (target p95 < 500 ms). Without one, the in-memory dev engine is
//    timed instead when --products <= 20000 (no pass/fail).
import { join } from 'node:path';
import { rmSync, statSync } from 'node:fs';
import { loadConfig, DEFAULT_ACTIVE_COUNTRIES } from '../config';
import { TypesenseEngine, ensureCollection, typesenseClient, typesenseHealthy, typesenseImporter } from '../engines/typesense';
import { MemoryEngine } from '../engines/memory';
import { fileSink, indexStream, referencePricesFromStream, type ImportFn } from '../indexer';
import { syntheticPages, syntheticProduct, syntheticQueries } from '../synthetic';
import { buildDocuments } from '../documents';
import type { EngineQuery, SearchEngine } from '../types';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const total = Number(arg('products', '100000'));
  const batch = Number(arg('batch', '5000'));
  const nQueries = Number(arg('queries', '200'));
  const sink = arg('sink', 'file');
  const collection = arg('collection', 'products_bench');
  const keep = process.argv.includes('--keep');
  const cfg = loadConfig();
  const active = new Set(cfg.activeCountries.length ? cfg.activeCountries : DEFAULT_ACTIVE_COUNTRIES);

  const client = cfg.typesense.apiKey ? typesenseClient(cfg.typesense, 120) : null;
  const live = client ? await typesenseHealthy(client) : false;
  let importFn: ImportFn;
  let target: string;
  let outFile = '';
  if (live && client) {
    await ensureCollection(client, { name: collection, recreate: true });
    importFn = typesenseImporter(client, collection);
    target = `typesense ${cfg.typesense.host}:${cfg.typesense.port}/${collection}`;
  } else if (sink === 'null') {
    importFn = async (jsonl) => jsonl.split('\n').map(() => ({ success: true }));
    target = 'null sink';
  } else {
    outFile = join(cfg.dataDir, 'bench-products.jsonl');
    importFn = fileSink(outFile);
    target = outFile;
  }
  console.log(`bench: ${total.toLocaleString()} synthetic products -> ${target} (batch ${batch}, ${active.size} active countries)`);

  const stats0 = { sampled: 0 };
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  const refs = await referencePricesFromStream(syntheticPages(total), active);
  const t1 = Date.now();
  let docBytes = 0;
  const stats = await indexStream(syntheticPages(total), { active, refs }, importFn, {
    batchSize: batch,
    onDoc: (d) => {
      if (stats0.sampled < 2000) {
        docBytes += JSON.stringify(d).length;
        stats0.sampled++;
      }
    },
  });
  const t2 = Date.now();
  const avgDoc = docBytes / Math.max(1, stats0.sampled);
  console.log(`  pass 1 (reference prices): ${t1 - t0} ms`);
  console.log(
    `  pass 2 (build + import):   ${t2 - t1} ms, ${stats.indexed.toLocaleString()} indexed, ${stats.failed} failed, ${stats.skipped} skipped, ` +
      `${stats.batches} batches, ${stats.retries} retries`,
  );
  console.log(`  throughput: ${Math.round((stats.indexed / Math.max(1, t2 - t0)) * 1000).toLocaleString()} docs/s end to end`);
  console.log(`  avg document: ${Math.round(avgDoc)} bytes JSON (~${mb(avgDoc * total)} total); heap growth ${mb(process.memoryUsage().heapUsed - heap0)}`);
  if (outFile) {
    console.log(`  file sink size: ${mb(statSync(outFile).size)}`);
    if (!keep) rmSync(outFile);
  }

  // Query latency
  let engine: SearchEngine | null = null;
  let label = '';
  if (live && client) {
    engine = new TypesenseEngine(client, active, collection);
    label = 'typesense';
  } else if (total <= 20_000) {
    const raws = Array.from({ length: total }, (_, n) => syntheticProduct(n));
    engine = new MemoryEngine(buildDocuments(raws, active));
    label = 'memory engine (dev only, not representative of production)';
  }
  if (!engine) {
    console.log('  query latency: skipped (no live Typesense; set TYPESENSE_HOST/PORT/PROTOCOL/API_KEY to measure)');
    return;
  }
  const queries = syntheticQueries(nQueries) as EngineQuery[];
  const lat: number[] = [];
  let errors = 0;
  for (const q of queries) {
    const s = performance.now();
    try {
      await engine.search(q);
    } catch {
      errors++;
    }
    lat.push(performance.now() - s);
  }
  lat.sort((a, b) => a - b);
  const p95 = pct(lat, 95);
  console.log(
    `  query latency (${label}, ${queries.length} mixed queries, ${errors} errors): ` +
      `p50 ${pct(lat, 50).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, p99 ${pct(lat, 99).toFixed(1)} ms, max ${lat[lat.length - 1].toFixed(1)} ms ` +
      (label === 'typesense' ? `-> ${p95 < 500 ? 'PASS' : 'FAIL'} (target p95 < 500 ms)` : '(dev engine; the p95 target applies to Typesense)'),
  );
}

main().catch((err) => {
  console.error(`bench failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
