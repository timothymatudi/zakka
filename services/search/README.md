# Zakka search service (`services/search`)

Typesense indexing, query understanding, ranking, and the `GET /search` HTTP API that the storefront (Agent 2) and the WhatsApp concierge (Agent 5) call. Owner: Agent 4.

With no keys set, everything runs offline: the API serves an in-memory engine built from `fixtures/catalog.ts` (60 sample products), and query understanding uses a rule-based parser.

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
```

## API (per docs/CONTRACT.md)

`GET /search?q=&locale=&country=&category=&min_price=&max_price=&max_days=&sort=relevance|price_asc|fastest|rating&page=&per_page=`

Returns `{ hits: SearchDocument[], found, facets, page }` (types in `packages/shared/src/types.ts`).

- `locale`: one of `en es fr pt ar zh hi sw de id` (default `en`). `country`: ISO alpha-2 (default `US`). Invalid values return 400 `{ error }`.
- Results are always limited to products whose offers ship to `country`. Each hit lists only the offers that ship there, cheapest first, and `min_price_usd` / `fastest_days` are for that country.
- `min_price` and `max_price` are in **USD** and compare against `display_price_usd`. `max_days` compares against the best offer's `delivery_days_max`.
- `category` accepts a category slug (`phones`), a category id, or a localized category name.
- `min_rating` (0-5) keeps products rated at least that much. `ships_from=CN,KE` keeps products with at least one offer shipping from one of those countries (comma-separated ISO codes).
- Each offer in a hit also has `display_price_local` and `currency`, in the request country's currency. The value is converted with `fx_rates` and rounded to `currencies.decimals` (the offline fallback is the FX table and Intl's ISO decimals). This is a display conversion, not the catalog's checkout price with round-up rules; if no rate is known, the price is given in USD.
- `per_page` defaults to 20 (max 100); `page` starts at 1.
- Facets: `category_path`, `category_slug` (`{ value: slug, label: localized name, count }`, which can be passed straight to `category=`), `source_kind` (dropship or affiliate), `ships_from`, `price_bucket` (USD buckets for the shopper's country: `0-10`, `10-25`, `25-50`, `50-100`, `100-250`, `250+`), and `rating` (`4.5+`, `4.0-4.5`, `3.0-4.0`, `<3.0`, `unrated`).
- `debug=1` adds a `debug` object (engine, parsed query, effective filters). It is not part of the contract, so don't depend on it in production.

`GET /products/{id}?locale=&country=` returns one hit: the same shape as a `/search` hit, with offers filtered to the country and local prices. It returns 404 if the product is unknown or does not ship to `country`, and 400 on a bad locale or country.

`GET /health` returns `{ status, engine: "typesense"|"memory", query_understanding: "ai"|"rules", documents }`.

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

The score is computed per country at index time (`csell_<CC>`), so Typesense sorts by `_text_match(buckets: 5):desc, csell_<CC>:desc` natively. The memory engine uses the same values and groups relevance in tiers of 0.1.

## Index

```bash
npm run index -- --locale en          # one locale, from Postgres
npm run index -- --all                # all phase-1 locales
npm run index -- --all --from-fixtures   # sample data, no DB needed
npm run index -- --all --recreate     # drop and recreate collections
npm run schema -- zh                  # print a collection schema
```

- Source: Postgres `DATABASE_URL` (`products`, `product_translations` with English fallback, `categories` + `category_translations`, active `offers` + `sources`). If the database is unreachable, the indexer falls back to fixtures.
- Prices: search never applies markup. For each offer, the indexer uses the first available of:
  1. `price_usd` from the catalog API, `GET {CATALOG_API_URL}/offers/{id}/price?country=<first ships_to>`
  2. an `offers.display_price_usd` column, if the catalog has written one
  3. for affiliate offers only, the contract's no-markup `list_price_usd + shipping_usd`

  A dropship offer with none of these is skipped and a warning is logged.
- Popularity: `0.5·log10(1+reviews)/4 + 0.5·log10(1+events)/3`, where events are affiliate clicks plus ordered quantity in the last 90 days.
- Output: upserts into Typesense `products_<locale>`. If Typesense is not configured or not reachable, it writes `data/products_<locale>.jsonl` instead.

### Typesense schema (`src/schema.ts`)

There is one collection per locale, `products_<locale>`, holding the contract fields plus internal fields that are stripped from API responses:

- Facets: `source_kinds`, `source_codes`, `offer_ships_from`, `category_slugs`, `category_keys` (`slug|name`, exposed as `category_slug`), `rating_bucket`.
- Per-country dynamic fields: `cprice_<CC>`, `cdays_<CC>`, `cdmax_<CC>`, `csell_<CC>`, and `cpbucket_<CC>` (facetable).

Per-locale text settings:

- `en`: default tokenizer with stemming.
- `es`, `fr`, `pt`, `de`: `locale` plus stemming.
- `ar`, `hi`, `zh`: `locale` for ICU word segmentation (Chinese has no spaces).
- `sw`, `id`: default tokenizer.

The memory engine segments Chinese into character bigrams and folds Arabic alef/teh-marbuta variants and harakat.

## Starting Typesense locally

Docker is not installed as part of this repo. With Docker available:

```bash
docker run -d --name zakka-typesense -p 8108:8108 -v zakka-typesense-data:/data \
  typesense/typesense:29.0 --data-dir /data --api-key=dev-typesense-key --enable-cors
```

Then set `TYPESENSE_API_KEY=dev-typesense-key` and run `npm run index -- --all --from-fixtures` (or without `--from-fixtures` once the database is seeded), then `npm start`. If Typesense goes down later, each request falls back to the in-memory engine.

## Environment

These come from the repo's `.env.example`; no other variables are read.

| Var | Use | When empty |
|---|---|---|
| `SEARCH_API_URL` | Listen port (default 4010) | 4010 |
| `TYPESENSE_HOST` / `TYPESENSE_PORT` / `TYPESENSE_PROTOCOL` / `TYPESENSE_API_KEY` | Search engine | In-memory engine over fixtures |
| `DATABASE_URL` | Indexer source, `fx_rates` | Fixtures; static FX table |
| `CATALOG_API_URL` | `display_price_usd` per offer | Stored column / affiliate rule |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | AI query understanding | Rule-based parser |

## What is mocked

- **Catalog**: `fixtures/catalog.ts` has 60 products in 24 categories, from 11 sources (dropship: cj, aliexpress_ds, spocket, printful; affiliate: amazon, temu, shein, aliexpress_aff, jumia, noon, flipkart), shipping from CN, US, DE, LV, KE, NG, EG, AE and IN. Every product has an English title, and many also have sw, es, fr, ar, zh, hi, de, pt or id titles; missing ones fall back to English. Prices stand in for catalog-computed `display_price_usd`. Affiliate URLs point to `example.com`, and images are picsum placeholders.
- **FX rates**: the static approximate table in `src/money.ts`, used when `DATABASE_URL` is unavailable.
- **AI**: the rule-based parser. Tests inject a fake SDK client, so no test makes a network call.
