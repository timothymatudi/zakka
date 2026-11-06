# Zakka search service (`services/search`)

Typesense indexing, query understanding, ranking, and the `GET /search` HTTP API that the storefront (Agent 2) and the WhatsApp concierge (Agent 5) call. Owner: Agent 4.

It is built for a catalog of 1M–5M products: one Typesense collection, streamed bulk indexing, and live affiliate results merged at query time. See **Scale and sizing** below.

With no keys set, everything runs offline. The API serves an in-memory engine (development only) built from the **offline dataset**: the catalog's shared `packages/fixtures/dev-catalog.json` when it exists (so offer ids match what checkout accepts), otherwise this service's own `fixtures/catalog.ts` (60 sample products). Query understanding uses a rule-based parser.

## Run

```bash
cd services/search
npm install
npm start            # http://localhost:4010 (port taken from SEARCH_API_URL)
npm run dev          # same, with reload on change
```

```bash
curl "http://localhost:4010/health"
curl "http://localhost:4010/search?q=simu%20nzuri%20chini%20ya%2020%2C000%20KES&locale=sw&country=KE"
curl "http://localhost:4010/search?q=&locale=en&country=KE&category=kitchen&sort=price_asc"
```

## Test

```bash
npm test             # vitest; no network calls (AI client and fetch are faked)
npm run typecheck    # tsc --noEmit
npm run bench -- --products 1000000   # indexing throughput, plus query latency with a live Typesense
```

On a machine short of memory, run tests in one worker: `npx vitest run --no-file-parallelism --pool=forks --poolOptions.forks.singleFork`.

## API (per docs/CONTRACT.md)

`GET /search?q=&locale=&country=&category=&min_price=&max_price=&max_days=&sort=relevance|price_asc|fastest|rating&page=&per_page=`

Returns `{ hits: SearchDocument[], found, facets, page }` (types in `packages/shared/src/types.ts`).

- `locale`: one of `en es fr pt ar zh hi sw de id` (default `en`). `country`: ISO alpha-2 (default `US`). Invalid values return 400 `{ error }`.
- Results are always limited to products whose offers ship to `country`. Each hit lists only the offers that ship there, cheapest first, and `min_price_usd` / `fastest_days` are for that country.
- `min_price` and `max_price` are in **USD** and compare against `display_price_usd`. `max_days` compares against the best offer's `delivery_days_max`.
- `category` accepts a category slug (`phones`), a category id, or a localized category name.
- `min_rating` (0-5) keeps products rated at least that much. `ships_from=CN,KE` keeps products with at least one offer shipping from one of those countries (comma-separated ISO codes).
- Each offer in a hit also has `display_price_local` and `currency`, in the request country's currency. The value is converted with `fx_rates` and rounded to `currencies.decimals` (offline: the FX table, whole units for KES, IDR, TZS, UGX, NGN, JPY, KRW, VND, CLP and PKR, otherwise ISO decimals). This is a display conversion, not the catalog's checkout price with round-up rules; if no rate is known, the price is given in USD.
- `per_page` defaults to 20 (max 100); `page` starts at 1.
- Facets: `category_path`, `category_slug` (`{ value: slug, label: localized name, count }`, which can be passed straight to `category=`), `source_kind` (dropship or affiliate), `ships_from`, `price_bucket` (USD buckets for the shopper's country: `0-10`, `10-25`, `25-50`, `50-100`, `100-250`, `250+`), and `rating` (`4.5+`, `4.0-4.5`, `3.0-4.0`, `<3.0`, `unrated`).
- `debug=1` adds a `debug` object (engine, parsed query, effective filters, number of live hits). It is not part of the contract, so don't depend on it in production.
- **Federated affiliate results:** affiliate partners are not bulk-indexed. On page 1, search calls the catalog's `GET {CATALOG_API_URL}/live?q=&country=&locale=` (accepting `{ hits: [...] }` or a plain array) in parallel with the index query. It appends up to 10 of those results after the indexed hits:
  - Results already shown are skipped, matched by GTIN or id.
  - Results over `max_price`, or with no offer shipping to `country`, are dropped.
  - Offers get local prices, using the partner's own price when it is quoted in the shopper's currency.
  - `found` includes the appended live hits.
  - The call has an 800 ms timeout. On timeout or error it is skipped and not retried for 30 s, so search never waits on the catalog. Set `SEARCH_LIVE_AFFILIATES=0` to turn it off.

`GET /products/{id}?locale=&country=` returns one hit: the same shape as a `/search` hit, with offers filtered to the country and local prices. It returns 404 if the product is unknown or does not ship to `country`, and 400 on a bad locale or country.

`GET /health` returns `{ status, engine: "typesense"|"memory", query_understanding: "ai"|"rules", documents (memory engine count, null under Typesense), dataset: "dev-catalog"|"fixtures", active_countries }`.

`POST /admin/reindex` with body `{ "product_ids"?: string[] }` (all products when omitted) returns `{ reindexed, duration_ms }`. The catalog's hourly scheduler calls it.
- **Auth:** `Authorization: Bearer $SEARCH_ADMIN_TOKEN`. When the token is unset, only loopback callers are accepted (403 otherwise).
- **Typesense mode:** streams the products from Postgres (or from the offline dataset when `DATABASE_URL` is empty) and upserts them as JSONL batches.
  - With `product_ids`, only those products are rebuilt (one document each, covering all locales). The reference prices saved by the last full run (`data/reference-prices.json`) are reused, and targeted ids that no longer produce a document are deleted.
  - Without `product_ids`, it is a full run that recomputes and saves the reference prices.
- **Memory mode:** re-reads the offline dataset from disk and swaps it in.
- Calls run one at a time.

### Query understanding

Free text such as `simu nzuri chini ya 20,000 KES` or `cheap wireless earbuds for running` becomes `{ keywords, category_hint, max_price, currency, max_days }`:

- **AI mode** (when `ANTHROPIC_API_KEY` is set): the official `@anthropic-ai/sdk` with `messages.parse` and a Zod structured-output schema, `effort: "low"`, and a stable cached system prompt. The model is `ANTHROPIC_MODEL`, or `claude-haiku-5-5` when that is unset. The client uses a 4-second timeout and 1 retry. Results are cached in memory per (locale, country, query). On any error or refusal, the service falls back to the rules.
- **Rules mode** (mock, the default): handles price caps with currency codes, symbols and words (KES/Ksh/bob, $, €, ₦, ₹, 元, درهم, …), "under" phrases in all 10 locales, `20k` and `elfu 20`, "within N days" / `ndani ya siku N` / `3天内`, "fast" words (giving `max_days` 5) and "tomorrow" words (giving 2), filler-word removal, and category hints.
- Explicit query parameters always win. An inferred `max_price` is converted to USD with `fx_rates`; offline, a static mock table in `src/money.ts` is used. If the keywords match nothing (for example, a Swahili word searched against the English catalog), the search retries using the inferred category.

### Ranking

Results are ordered by text relevance first, then by a **sell score** (`src/ranking.ts`, unit-tested):

```
sell = 0.30·popularity + 0.25·rating + 0.25·speed + 0.20·price
```

- **rating**: Bayesian-smoothed toward 3.8 with a weight of 20 reviews.
- **speed**: `1 / (1 + (days−1)/6)`, using delivery days to the shopper's country.
- **price**: `0.5 − 0.25·log2(price / median)`, where the median is taken over the same top-level category in that country.

For **active countries** (launch markets), the score is precomputed at index time as `csell_<CC>`, so Typesense sorts by `_text_match(buckets: 5):desc, csell_<CC>:desc` natively.
- Other countries are filtered by `ships_to` and ranked by `sell_global`, which uses the product's best offer and the category median.
- Their exact price, delivery time and score are computed at query time from `offers`, which is what hits and the memory engine use.
- Medians come from a streaming log-histogram with 2% buckets, so memory stays constant at any catalog size.

The memory engine groups relevance in tiers of 0.1.

## Index

```bash
npm run index                       # all products from Postgres -> Typesense `products`
npm run index -- --from-fixtures    # offline dataset, no DB needed
npm run index -- --products id1,id2 # incremental: just these products
npm run index -- --recreate         # drop and recreate the collection
npm run schema                      # print the collection schema
```

- **Single collection.** Each product is one document in `products`, covering all locales, so text is not stored 10 times.
  - The base text (`title`, `description`, `bullets`) is the English translation, or the first one available.
  - `title_<loc>` / `description_<loc>` exist only where that translation exists. A query in locale L searches `title_L` first, then falls back to the base text, and hits return the localized text when it exists.
  - Category names are not stored per product. `category_terms` holds every locale's names once, for matching. Hits and facets take localized names from a category directory loaded from the DB or the dataset.
- **Pipeline** (`src/indexer.ts`):
  - Pass 1 streams products to compute reference (median) prices.
  - Pass 2 streams them again, builds documents, and imports them as **JSONL batches of 5,000** (`--batch`) with upsert.
  - A failed batch request is retried 3 times with exponential backoff (0.5 s, 1 s, 2 s); per-document rejections are counted and logged.
  - Postgres is read in keyset-paginated pages of 2,000 products, so memory stays bounded (+71 MB of heap at 1M products).
- **Active countries:** the active rows of `countries` in the DB, otherwise `SEARCH_ACTIVE_COUNTRIES`, otherwise the 29 launch markets in `src/config.ts`. Only these get the per-country fields `cprice_CC`, `cdmax_CC` and `csell_CC`.
- **Source:** Postgres `DATABASE_URL`: `products`, all `product_translations`, `categories` + `category_translations`, active `offers` + `sources`. With `--from-fixtures` or no database, the source is the offline dataset: `DEV_CATALOG_PATH` (default `../../packages/fixtures/dev-catalog.json`, relative to `services/search`), else `fixtures/catalog.ts`.
- **Prices:** search never applies markup. For each offer, the indexer uses the first available of:
  1. `offers.display_price_usd`, written by the catalog
  2. `price_usd` from `GET {CATALOG_API_URL}/offers/{id}/price`
  3. for affiliate offers only, `list_price_usd + shipping_usd`

  A dropship offer with none of these is skipped.
- **Popularity:** `0.5·log10(1+reviews)/4 + 0.5·log10(1+events)/3`, where events are affiliate clicks plus ordered quantity in the last 90 days.
- **Output:** Typesense when it is reachable, otherwise `data/products.jsonl`.

Per-locale text settings (`src/schema.ts`):
- `title`/`description` (English base): stemming.
- `es`, `fr`, `pt`, `de`: `locale` plus stemming.
- `ar`, `hi`, `zh`: `locale` for ICU word segmentation.
- `sw`, `id`: default tokenizer.

The memory engine segments Chinese into character bigrams and folds Arabic letter variants and harakat.

## Scale and sizing

**Measured** with `npm run bench` on synthetic products (in-process Node, on a memory-constrained Windows dev box; a server will be faster). Each product has 1–3 offers, 30% have a Swahili and 15% a Spanish translation, and 29 active countries:

| Products | Pass 1 (medians) | Pass 2 (build + JSONL) | End-to-end | Avg doc JSON | Heap growth |
|---|---|---|---|---|---|
| 100,000 (file sink) | 2.2 s | 11.8 s | 7,100 docs/s | 2.5 KB (242 MB file) | +64 MB |
| 1,000,000 (null sink) | 50 s | 111 s | 6,200 docs/s | 2.5 KB (~2.4 GB) | +71 MB |

The indexer itself is not the bottleneck; Typesense typically imports 5–15k docs/s per node. Query latency has not been measured yet because no Typesense server was available. Run `npm run bench -- --products 1000000` with `TYPESENSE_*` pointing at one: it indexes into `products_bench` and reports p50/p95/p99 for 200 mixed queries against the p95 < 500 ms target.

**Estimates.** These follow Typesense's guidance that RAM is about 2–3× the size of the indexed fields; un-indexed fields (`offers`, `image`, `local_prices`) live on disk only.

| | 1M products | 5M products |
|---|---|---|
| Indexed text (title, description, bullets, category terms, translations) | ~0.5 GB | ~2.5 GB |
| Numeric/facet fields (about 100 values per doc, including 29 countries × 3) | ~1 GB | ~5 GB |
| **Typesense RAM** | **~3–4 GB** | **~15–20 GB** |
| **Disk** (RocksDB + snapshots) | ~6 GB | ~30 GB |

The per-country fields are the largest item. Each additional active country adds about 3 numbers per product that ships there. Countries outside the active list cost nothing in the index.

**Cluster recommendation** (Typesense Cloud or self-hosted; a 3-node Raft cluster for HA, and search scales with replicas):
- 1M products: 3 × (4 vCPU, 8 GB RAM, 50 GB SSD).
- 5M products: 3 × (8 vCPU, 32 GB RAM, 100 GB SSD).
- Put the indexer close to the database, and run full reindexes off-peak; incremental `/admin/reindex` covers the hourly changes.

**Sharding, if needed** (beyond ~10M products, or more than ~64 GB of RAM per node): Typesense doesn't shard a single collection. Two ways to split:
- **By market region:** `products_africa`, `products_gcc`, `products_americas`, … Every query is already filtered by the shopper's country, so it goes to exactly one collection. A product shipping to several regions is stored once per region.
- **By top-level category:** query the collections in parallel with `multi_search` and merge by score in this service.

`collectionSchema(name)` and `TypesenseEngine(client, active, collection)` already take a collection name, so routing is a small change.

**Why Typesense, not OpenSearch:**
- At 1M–5M products, the whole index fits in RAM on modest nodes, giving low and predictable latency.
- Built-in features match what search needs: typo tolerance, per-field locale tokenization (zh/ar/hi), faceting with numeric range facets, and sorting on per-country fields.
- It is a single binary with Raft HA, with no JVM or shard tuning.

OpenSearch is the better choice past tens of millions of documents, for heavy analytics aggregations, or for disk-based indices. Nothing in the current requirements needs that.

## Starting Typesense locally

Docker is not installed as part of this repo. With Docker available:

```bash
docker run -d --name zakka-typesense -p 8108:8108 -v zakka-typesense-data:/data \
  typesense/typesense:29.0 --data-dir /data --api-key=dev-typesense-key --enable-cors
```

Then set `TYPESENSE_API_KEY=dev-typesense-key` and run `npm run index -- --from-fixtures` (or without `--from-fixtures` once the database is seeded), then `npm start`. If Typesense goes down later, each request falls back to the in-memory engine.

## Environment

Shared variables come from the repo's `.env.example`; the `SEARCH_*` and `DEV_CATALOG_PATH` variables are specific to this service.

| Var | Use | When empty |
|---|---|---|
| `SEARCH_API_URL` | Listen port (default 4010) | 4010 |
| `TYPESENSE_HOST` / `TYPESENSE_PORT` / `TYPESENSE_PROTOCOL` / `TYPESENSE_API_KEY` | Search engine | In-memory engine over fixtures |
| `DATABASE_URL` | Indexer source, `fx_rates`, `currencies`, `countries`, categories | Offline dataset; static FX table |
| `CATALOG_API_URL` | Offer prices when not stored; `/live` affiliate results | Stored column / affiliate rule; no live results |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | AI query understanding | Rule-based parser |
| `DEV_CATALOG_PATH` | Shared dev catalog for the offline dataset | `../../packages/fixtures/dev-catalog.json`, else own fixtures |
| `SEARCH_ADMIN_TOKEN` | Bearer token for `POST /admin/reindex` | Loopback callers only |
| `SEARCH_ACTIVE_COUNTRIES` | Comma list of countries with precomputed fields | DB `countries.is_active`, else the 29 launch markets |
| `SEARCH_LIVE_AFFILIATES` | `0` turns off federated live affiliate results | On (skipped automatically if the catalog doesn't answer) |

## What is mocked

- **Catalog**: `fixtures/catalog.ts` has 60 products in 24 categories, from 11 sources (dropship: cj, aliexpress_ds, spocket, printful; affiliate: amazon, temu, shein, aliexpress_aff, jumia, noon, flipkart), shipping from CN, US, DE, LV, KE, NG, EG, AE and IN. Every product has an English title, and many also have sw, es, fr, ar, zh, hi, de, pt or id titles; missing ones fall back to English. Prices stand in for catalog-computed `display_price_usd`. Affiliate URLs point to `example.com`, and images are picsum placeholders.
- **Dev catalog**: when `packages/fixtures/dev-catalog.json` is present, its `fx_rates` and `currencies` replace the static FX and decimals tables. An affiliate offer whose `list_currency` equals the shopper's currency shows `list_price_local + shipping_local`.
- **FX rates**: the static approximate table in `src/money.ts`, used when neither the database nor the dev catalog provides rates.
- **Live affiliates**: the catalog's `/live` endpoint isn't built yet; tests use a fake fetch. Until it exists, the first call fails and the 30-second backoff applies.
- **Benchmarks**: `src/synthetic.ts` generates a deterministic synthetic catalog and query mix.
- **AI**: the rule-based parser. Tests inject a fake SDK client, so no test makes a network call.
