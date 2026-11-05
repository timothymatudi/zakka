// npm run index -- --locale en | --all [--from-fixtures] [--recreate] [--out <dir>]
//
// Loads products from Postgres (DATABASE_URL) or the fixtures file, builds
// search documents and upserts them into Typesense `products_<locale>`.
// If Typesense is not configured/reachable, documents are written as JSONL to
// --out (default ./data) so the run is still useful offline.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../config';
import { LOCALES, type Locale, type RawProduct } from '../types';
import { buildDocuments } from '../documents';
import { fixtureRawProducts } from '../sources/fixtures';
import { loadRawProductsFromDb } from '../sources/postgres';
import { catalogPriceClient } from '../sources/catalog-prices';
import { indexIntoTypesense, typesenseClient, typesenseHealthy } from '../engines/typesense';
import { collectionName } from '../schema';

function parseArgs(argv: string[]) {
  const args = { locales: [] as Locale[], fromFixtures: false, recreate: false, out: 'data' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.locales = [...LOCALES];
    else if (a === '--locale') args.locales.push(argv[++i] as Locale);
    else if (a.startsWith('--locale=')) args.locales.push(a.split('=')[1] as Locale);
    else if (a === '--from-fixtures') args.fromFixtures = true;
    else if (a === '--recreate') args.recreate = true;
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (!args.locales.length) throw new Error('pass --locale <code> or --all');
  for (const l of args.locales) if (!LOCALES.includes(l)) throw new Error(`unsupported locale ${l}`);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const prices = catalogPriceClient(cfg.catalogApiUrl);

  let useFixtures = args.fromFixtures;
  if (!useFixtures && !cfg.databaseUrl) {
    console.warn('[indexer] DATABASE_URL empty; using fixtures');
    useFixtures = true;
  }

  const client = cfg.typesense.apiKey ? typesenseClient(cfg.typesense) : null;
  const tsOk = client ? await typesenseHealthy(client) : false;
  if (!tsOk) console.warn(`[indexer] Typesense ${client ? 'unreachable' : 'not configured (TYPESENSE_API_KEY empty)'}; writing JSONL to ${resolve(args.out)}`);

  for (const locale of args.locales) {
    let raws: RawProduct[];
    if (useFixtures) {
      raws = fixtureRawProducts(locale);
    } else {
      try {
        raws = await loadRawProductsFromDb(cfg.databaseUrl, locale, prices);
      } catch (err) {
        console.warn(`[indexer] database unavailable (${(err as Error).message}); falling back to fixtures`);
        useFixtures = true;
        raws = fixtureRawProducts(locale);
      }
    }
    const docs = buildDocuments(raws);
    const skipped = raws.length - docs.length;
    if (tsOk && client) {
      const r = await indexIntoTypesense(client, locale, docs, { recreate: args.recreate });
      console.log(`[indexer] ${collectionName(locale)}: ${r.imported} imported, ${r.failed} failed, ${skipped} skipped (no priced offers) [${useFixtures ? 'fixtures' : 'postgres'}]`);
    } else {
      mkdirSync(args.out, { recursive: true });
      const file = join(args.out, `${collectionName(locale)}.jsonl`);
      writeFileSync(file, docs.map((d) => JSON.stringify(d)).join('\n') + '\n');
      console.log(`[indexer] ${collectionName(locale)}: ${docs.length} documents written to ${file}, ${skipped} skipped [${useFixtures ? 'fixtures' : 'postgres'}]`);
    }
  }
}

main().catch((err) => {
  console.error(`[indexer] ${err.message}`);
  process.exit(1);
});
