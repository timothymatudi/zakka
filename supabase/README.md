# Zakka database (`supabase/`)

Owner: Agent 1 (Database). Postgres schema, Row Level Security, seeds, and the category builder.
`migrations/0001_core.sql` is the contract and is never edited. Later files only add things.

## Layout

| Path | What it is |
| --- | --- |
| `migrations/0001_core.sql` | Core schema (contract, read-only) |
| `migrations/0002_indexes_rls.sql` | Hot-path indexes, RLS on every table, policies, column grants, `public_sources` view, `updated_at` triggers |
| `migrations/0003_views_functions.sql` | `offer_effective_markup(offer_id)`, `offer_markups`, `order_margin`, `top_level_categories` |
| `migrations/0004_markup_inheritance.sql` | Replaces `offer_effective_markup` so category rules are inherited from the nearest ancestor |
| `seed/00_reference.sql` | 59 currencies, 10 Phase 1 locales, 68 countries, **sample** FX rates |
| `seed/01_sources_markup.sql` | The 11 contract sources (placeholder config) and the global markup rule (35% + $0, round to .99) |
| `seed/categories_starter.sql` | Hand-written tree: 20 top-level and 102 child categories, names in all 10 locales |
| `scripts/build_categories.py` | Converts Shopify's Standard Product Taxonomy into a categories seed |
| `scripts/tests/` | Offline unit tests for the builder (fixtures in `scripts/fixtures/`) |
| `config.toml` | Minimal Supabase CLI config: DB port 54322 and seed order |

## Apply

Files must run in this order: `0001`, `0002`, `0003`, `0004`, then `seed/00_reference.sql`, `seed/01_sources_markup.sql`, `seed/categories_starter.sql`. Every file after `0001` can be re-run safely.

**Supabase CLI** (needs Docker):

```sh
supabase start        # first time
supabase db reset     # drops the local DB, applies migrations/, then the seeds listed in config.toml
```

**psql** against any Postgres 15+ with the `vector` (pgvector) and `pgcrypto` extensions:

```sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
for f in migrations/0001_core.sql migrations/0002_indexes_rls.sql migrations/0003_views_functions.sql \
         migrations/0004_markup_inheritance.sql \
         seed/00_reference.sql seed/01_sources_markup.sql seed/categories_starter.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

On plain Postgres (not Supabase), `0002` creates stand-ins for the Supabase roles (`anon`, `authenticated`, `service_role`) and for `auth.uid()`, which reads `request.jwt.claim.sub`. On Supabase these already exist, so that block does nothing.

## Access model (RLS)

* **service_role** (catalog, search indexer, concierge, server-side web code) bypasses RLS and can do everything.
* **anon and authenticated** can read: `currencies`, active `locales` and `countries`, `fx_rates`, `categories`, `category_translations`, active `products` and their `product_translations`, active `offers`, `public_sources`, and `top_level_categories`.
* **authenticated** can also read their own `customers` row (`auth_user_id = auth.uid()`) and their own `orders`, `order_items`, `supplier_orders`, and `shipments`. They can update only `locale`, `country_code`, `whatsapp_opt_in`, `whatsapp_opt_in_at`, and `marketing_opt_in` on their own row. Phone and email changes go through the server.
* Everything else is service-role only: `sources` (it holds config, so clients use `public_sources`), `markup_rules`, `affiliate_clicks`, `whatsapp_*`, `supplier_scores`, `order_margin`, `offer_markups`, and `offer_effective_markup()`.

**Hidden cost columns.** Column grants hide the margin data from clients (approved in the contract):
* `offers`: `cost_usd` and `commission_rate`
* `order_items`: `unit_cost_usd`
* `supplier_orders`: `cost_usd` and `external_order_id`

On those three tables a client using the anon or user key must list its columns. A `select('*')` call fails with *permission denied*. Server code using the service role is not affected.

**Note for future migrations.** `0002` revokes the Supabase default grants for every table that exists at that point. Supabase still grants new tables to anon and authenticated by default, so each new table needs RLS enabled in the same migration that creates it.

## Views and functions

* `offer_effective_markup(offer_id) → setof markup_rules` returns 0 or 1 row. It applies the contract's precedence: product, then source, then category, then global. For category rules, the nearest category with an active rule wins: the product's own category first, then its parent, grandparent and so on (since `0004`). Within the winning level the highest `priority` wins, then `id` breaks ties. The function returns a rule for affiliate offers too, so callers must skip markup when `sources.kind = 'affiliate'`. It does not compute prices: `services/catalog` stays the reference pricing implementation.
* `offer_markups` has one row per offer with its effective rule.
* `order_margin` has one row per order with `total_usd`, `items_cost_usd`, `supplier_cost_usd`, `cost_usd`, `margin_usd`, and `margin_rate`. `cost_usd` uses the costs suppliers actually charged once any exist, and falls back to `qty * unit_cost_usd` before that.
* `top_level_categories` lists the top-level categories with `child_count`, ordered by `sort`. Join `category_translations` to get names.
* `public_sources` lists active sources without `config`.

## Sample data and placeholders

* **`fx_rates` are sample values, not live rates.** They are rounded approximations with `fetched_at = 2000-01-01`. Per the contract, any rate with `fetched_at` before 2001 is a sample. The FX job replaces them. The seed uses `on conflict do nothing`, so it never overwrites real rates.
* `sources.config` holds placeholders only: `{"placeholder": true, "mode": "mock", "env": [...]}`. It contains no secrets, and credentials come from the env vars it names. Country lists for Jumia, noon, and Flipkart are best-effort and need checking. Re-seeding never overwrites an edited config.
* Countries are limited to the 10 Phase 1 locales for `default_locale`. Where the local language is not supported yet, they use `en`.
* Currency `decimals` are the ISO 4217 minor units. Some currencies have more decimals than people use in practice (IQD has 3, IDR has 2), so the pricing and display code may want its own rounding.

## Translations need native review

The 1,220 names in `seed/categories_starter.sql` were written by an AI agent. Have native speakers review them before launch, especially `ar`, `hi`, `sw`, `zh`, and `id`. Fix names in the seed file and re-run it, since the upsert overwrites names.

On top-level rows, `shopify_taxonomy_id` is the closest Shopify *vertical* (for example `el` or `aa`), so it is only an approximate mapping. Child rows are left null.

## Full category tree (Shopify Standard Product Taxonomy)

Source: <https://github.com/Shopify/product-taxonomy> (MIT license). The script makes no network calls. Fetch the taxonomy yourself, outside this repo or into an ignored `vendor/` folder:

```sh
git clone --depth 1 https://github.com/Shopify/product-taxonomy.git ../product-taxonomy
# English:    ../product-taxonomy/dist/en/categories.json   (or categories.txt)
# Localized:  ../product-taxonomy/dist/<locale>/categories.json  (e.g. es, fr, de, pt-BR, id, zh-Hans when present)
```

Generate a seed:

```sh
python supabase/scripts/build_categories.py ../product-taxonomy/dist/en/categories.json \
  --max-depth 3 \
  --translation es=../product-taxonomy/dist/es/categories.json \
  --translation fr=../product-taxonomy/dist/fr/categories.json \
  --translation de=../product-taxonomy/dist/de/categories.json \
  --translation pt=../product-taxonomy/dist/pt-BR/categories.json \
  --out supabase/seed/categories_shopify.sql
```

* `--max-depth N` keeps the top N levels (1 means verticals only, 0 means everything, about 10k nodes). `--verticals el,aa,hg` keeps only the listed verticals.
* Slugs are built from the English path (`electronics-audio-headphones-headsets`). Long slugs are shortened with a stable hash.
* `shopify_taxonomy_id` stores the short id (`el-1-1`, without the `gid://` prefix).
* Rows are upserted by slug, so the output can run on top of the starter tree. Matching slugs such as `electronics` merge, and everything else is added alongside. In production, pick one tree.
* A locale with no Shopify file (for example `ar`, `hi`, or `sw`) gets no rows. The app should fall back to `en`.
* `google_category_id` is not filled in.
* To load the output with `supabase db reset`, add it to `sql_paths` in `config.toml`.

## Tests and validation

```sh
python -m unittest discover -s supabase/scripts/tests -v   # builder, offline, stdlib only
```

The SQL was validated by applying every file twice to a throwaway in-process Postgres 17 (PGlite with the `vector` and `pgcrypto` extensions) and then checking:
* seed counts
* RLS is enabled on every table
* markup precedence and priority
* `order_margin` arithmetic
* the `updated_at` triggers
* row and column access as `anon`, as two different `authenticated` users, and as `service_role`

It has not yet run on a real Supabase stack. Run `supabase db reset` once Docker is available.

Nothing in this folder is mocked. The seeds are the local development data.
