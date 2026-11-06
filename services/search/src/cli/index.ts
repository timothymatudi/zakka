// npm run index -- [--from-fixtures] [--products <id,id,...>] [--recreate] [--batch 5000] [--out <file>]
//
// Streams products from Postgres (DATABASE_URL) or, with --from-fixtures / no
// database, the offline dataset (packages/fixtures/dev-catalog.json, else
// ./fixtures), and upserts them into the single Typesense `products`
// collection as JSONL batches. Without a reachable Typesense the batches are
// written to --out (default data/products.jsonl). `--locale`/`--all` are
// accepted for compatibility; every run covers all locales.
import { join } from 'node:path';
import { loadConfig } from '../config';
import { ensureCollection, deleteFromTypesense, typesenseClient, typesenseHealthy, typesenseImporter } from '../engines/typesense';
import { fileSink } from '../indexer';
import { runIndex } from '../reindex';
import { resolveActiveCountries } from '../bootstrap';
import { loadDataset } from '../sources/dataset';

function parseArgs(argv: string[]) {
  const args = { fromFixtures: false, recreate: false, products: undefined as string[] | undefined, batch: 5000, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from-fixtures') args.fromFixtures = true;
    else if (a === '--recreate') args.recreate = true;
    else if (a === '--products') args.products = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--batch') args.batch = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--all') continue;
    else if (a === '--locale') i++;
    else if (a.startsWith('--locale=')) continue;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!(args.batch > 0)) throw new Error('--batch must be a positive number');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  if (args.fromFixtures) cfg.databaseUrl = '';
  if (!cfg.databaseUrl) console.warn('[indexer] no database; using the offline dataset');
  const active = await resolveActiveCountries(cfg);
  const dataset = cfg.databaseUrl ? undefined : loadDataset(cfg.devCatalogPath);
  if (dataset) console.warn(`[indexer] dataset: ${dataset.name}${dataset.path ? ` (${dataset.path})` : ''}`);

  const client = cfg.typesense.apiKey ? typesenseClient(cfg.typesense, 60) : null;
  const tsOk = client ? await typesenseHealthy(client) : false;
  let importFn;
  let target: string;
  if (tsOk && client) {
    await ensureCollection(client, { recreate: args.recreate });
    importFn = typesenseImporter(client);
    target = 'typesense collection products';
  } else {
    const out = args.out || join(cfg.dataDir, 'products.jsonl');
    console.warn(`[indexer] Typesense ${client ? 'unreachable' : 'not configured'}; writing JSONL to ${out}`);
    importFn = fileSink(out);
    target = out;
  }

  const stats = await runIndex({ cfg, active, importFn, dataset, productIds: args.products, batchSize: args.batch });
  if (tsOk && client && args.products) {
    const gone = args.products.filter((id) => !stats.seenIds.has(id));
    if (gone.length) console.log(`[indexer] removed ${await deleteFromTypesense(client, gone)} documents no longer indexable`);
  }
  const rate = stats.ms ? Math.round((stats.indexed / stats.ms) * 1000) : stats.indexed;
  console.log(
    `[indexer] ${target}: ${stats.indexed} indexed, ${stats.failed} failed, ${stats.skipped} skipped, ` +
      `${stats.batches} batches, ${stats.retries} retries, ${stats.ms} ms (${rate} docs/s), ${active.size} active countries`,
  );
}

main().catch((err) => {
  console.error(`[indexer] ${err.message}`);
  process.exit(1);
});
