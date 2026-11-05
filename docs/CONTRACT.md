# Zakka build contract

The single source of truth every build agent follows. When the contract and your instincts disagree, follow the contract. You may **add** to the database, but never rename or remove anything defined here.

## What Zakka is
A worldwide AI shopping search and WhatsApp concierge. Products come from two kinds of source:
- **Dropship suppliers** (CJ Dropshipping, AliExpress Dropshipping, Spocket, Printful). Zakka adds a markup, the customer pays Zakka, and the supplier ships.
- **Affiliate partners** (Amazon via the Creators API, Temu, Shein, AliExpress Portals, Jumia, Noon, Flipkart). No markup: the customer clicks out and Zakka earns a commission.

Customers see one catalog with an honest **total price in local currency** and a **delivery estimate to their country**.

## Repository layout and ownership

| Path | Owner | Stack |
| --- | --- | --- |
| `supabase/` | Agent 1, Database | Postgres SQL migrations, seeds, RLS |
| `apps/web/` | Agent 2, Storefront | Next.js 15 (App Router), TypeScript, Tailwind, next-intl |
| `services/catalog/` | Agent 3, Catalog | Python 3.12+, httpx, pydantic |
| `services/search/` | Agent 4, Search | Node 22+ TypeScript, Typesense client |
| `services/concierge/` | Agent 5, Concierge | Node 22+ TypeScript, Fastify |
| `packages/shared/` | Lead only | Shared TypeScript types (read-only for agents) |
| `docs/` | Lead only | This contract |

Only edit files inside your own path. Don't commit, push, or change git branches. To ask for a contract change, write it under "Contract requests" in your final report.

## Environment variables
See `.env.example` at the repo root. Read config only from these names. Never hard-code keys. With no keys present, every external integration must fall back to a **mock mode** that uses local fixtures, so everything runs and tests offline.

## Database (the core of the contract)
The authoritative SQL is `supabase/migrations/0001_core.sql`. Summary:

- `countries(code PK, name, currency, default_locale, is_active)`
- `locales(code PK, name, dir 'ltr'|'rtl', is_active)`
- `currencies(code PK, symbol, decimals)` and `fx_rates(base, quote, rate, fetched_at)`, where base is always `USD`
- `categories(id, parent_id, slug, shopify_taxonomy_id, google_category_id, sort, is_top_level, icon)` and `category_translations(category_id, locale, name)`
- `sources(id, kind 'dropship'|'affiliate', code, name, is_active, config jsonb)`, where code is one of `cj`, `aliexpress_ds`, `spocket`, `printful`, `amazon`, `temu`, `shein`, `aliexpress_aff`, `jumia`, `noon`, `flipkart`
- `products(id uuid, category_id, brand, gtin, image_urls text[], attributes jsonb, rating, review_count, is_active, created_at, updated_at)` and `product_translations(product_id, locale, title, description, bullet_points text[])`
- `offers(id uuid, product_id, source_id, external_id, url, cost_usd, list_price_usd, shipping_usd, stock, ships_from char(2), ships_to text[], delivery_days_min, delivery_days_max, commission_rate, last_synced_at, is_active)`. Each offer is one source's way to buy one product. Affiliate offers have `url` set and `cost_usd` null. Dropship offers have `cost_usd` set.
- `markup_rules(id, scope 'global'|'category'|'source'|'product', scope_id, percent, fixed_usd, round_to, priority, is_active)`
- `customers(id uuid, auth_user_id, phone_e164, email, locale, country_code, whatsapp_opt_in bool, whatsapp_opt_in_at, marketing_opt_in bool, created_at)`
- `orders(id uuid, customer_id, status, currency, subtotal, shipping, tax, total, total_usd, payment_provider, payment_ref, channel 'web'|'whatsapp', created_at)`, where status is one of `pending_payment`, `paid`, `forwarded`, `shipped`, `delivered`, `cancelled`, `refunded`
- `order_items(id, order_id, offer_id, product_id, qty, unit_price, unit_cost_usd)`
- `supplier_orders(id, order_id, source_id, external_order_id, status, cost_usd, created_at, updated_at)`
- `shipments(id, supplier_order_id, carrier, tracking_number, tracking_url, status, last_event, updated_at)`
- `affiliate_clicks(id, customer_id null, offer_id, country_code, locale, channel, clicked_at)`
- `whatsapp_conversations(id, customer_id, wa_id, state, context jsonb, last_inbound_at, last_outbound_at)` and `whatsapp_messages(id, conversation_id, direction 'in'|'out', type, body, template_name, wa_message_id, created_at)`
- `supplier_scores(source_id, period_start, orders, on_time_rate, defect_rate, avg_delivery_days)`

## Pricing rule (everyone must match)
For a dropship offer:
`price_usd = (cost_usd + shipping_usd) * (1 + percent/100) + fixed_usd`
Apply the highest-priority active markup rule, checked in the order product > source > category > global. Category rules inherit down the tree: the nearest category with an active rule wins, starting from the product's own category and moving through its ancestors. Affiliate offers never get a markup. Convert to local currency with `fx_rates`, then round **up** to `round_to`. For example, `0.99` means x.99 endings, and `1` means whole units. Affiliate offers show `list_price_usd + shipping_usd` converted, with no markup.

The reference implementation is `services/catalog/zakka_catalog/pricing.py`. Search and web call the catalog's prices instead of re-implementing them. The catalog writes a computed `display_price_usd` into the search index.

## Search document (what Agent 4 indexes, and Agents 2 and 5 read)
Collection `products_<locale>` (for example `products_en`, `products_ar`), with one document per product and its best offer for a country:

```json
{
  "id": "product uuid",
  "title": "string", "description": "string", "brand": "string",
  "category_path": ["Electronics", "Audio", "Headphones"],
  "category_ids": ["..."],
  "image": "url",
  "rating": 4.5, "review_count": 120,
  "offers": [{ "offer_id": "...", "source_code": "cj", "kind": "dropship",
               "display_price_usd": 23.99, "delivery_days_min": 3, "delivery_days_max": 7,
               "ships_from": "AE", "ships_to": ["AE","SA"], "url": null }],
  "min_price_usd": 23.99,
  "ships_to": ["AE","SA","US"],
  "fastest_days": 3,
  "popularity": 0.0
}
```

Ranking: text relevance first, then a sell score made from popularity, rating, delivery speed to the user's country, and price. Results are always filtered to `ships_to` containing the user's country.

## Search HTTP API (provided by Agent 4, used by Agents 2 and 5)
`GET /search?q=&locale=&country=&category=&min_price=&max_price=&max_days=&sort=relevance|price_asc|fastest|rating&page=&per_page=`
→ `{ hits: SearchDocument[], found: number, facets: {...}, page }`
Base URL: `SEARCH_API_URL` (default `http://localhost:4010`).
- `min_price` and `max_price` are in **USD**. Clients convert from local currency first. Currency phrases in `q`, like "under 20,000 KES", are parsed by search itself.
- `category` takes a slug (an id or a localized name is also accepted). `country` defaults to `US` when missing.
- Explicit parameters override anything inferred from `q`.
- The facets are `category_path`, `source_kind`, `ships_from`, `price_bucket` (USD buckets) and `rating` (buckets). Note that `ships_from` counts every offer, not only offers that ship to the user's country.
- `popularity` is computed from the review count plus the last 90 days of affiliate clicks and ordered quantity.

## Catalog HTTP API (provided by Agent 3)
- `GET /health`
- `GET /offers/{offer_id}/price?country=XX` → `{ offer_id, kind, price, currency, price_usd, delivery_days_min, delivery_days_max, ships_to_country }`
- `POST /prices` → batch pricing
- `POST /orders/{order_id}/forward` → forwards paid dropship items to their suppliers (requires `Authorization: Bearer $CATALOG_API_TOKEN`)
- `POST /tracking/poll`
- `offers.display_price_usd` and `orders.shipping_address` were added in migration 0005. `currencies.decimals` holds display decimals.
Base URL: `CATALOG_API_URL` (default `http://localhost:4020`).

## Design system (Agent 2 owns it; Agent 5 uses its colors in messages and links)
- Colors: primary teal `#0F766E`, accent coral `#F97362`, background cream `#FBF8F3`, text charcoal `#1F2937`
- Font: Plus Jakarta Sans (with Noto Sans Arabic and Noto Sans Devanagari as fallbacks)
- Mobile-first, card-based, WhatsApp button always visible, RTL for `ar` (add `ur` in Phase 2)
- Original design only. Never copy any rival's code, images, text, icons, or colors.

## Data access (from the Database agent, approved)
- Cost and commission columns are hidden from the anon and authenticated roles: `offers.cost_usd`, `offers.commission_rate`, `order_items.unit_cost_usd`, `supplier_orders.cost_usd` and `supplier_orders.external_order_id`. Client queries on those tables must name their columns. `select *` fails.
- Customers may update only `locale`, `country_code`, `whatsapp_opt_in`, `whatsapp_opt_in_at` and `marketing_opt_in` on their own row.
- Sources are public only through the `public_sources` view, which has no `config`.
- Every new table must enable RLS and grant access explicitly, because default grants are revoked.
- `fx_rates` with `fetched_at` before 2001 are sample values.

## Ownership decisions (lead)
- **Payments and payment webhooks belong to the concierge** for both channels. Web checkout creates the order, then calls `POST {CONCIERGE_PUBLIC_URL}/internal/payments/checkout` (with `x-internal-token`) to get a payment link. The web app's payment stubs are mock-only.
- **Admin auth:** a Supabase user with `app_metadata.role = 'admin'`. Admin writes (`markup_rules`, sources) go through server routes that check that role and then use the service role. Nothing writes those tables from the browser.
- **Categories for the web app:** `categories`, `category_translations` and the `top_level_categories` view are public-read under RLS, so no service role is needed.
- **Search additions (to be built):** `GET /products/{id}?locale&country`, `min_rating` and `ships_from` parameters, category facets that carry slugs, and `display_price_local` plus `currency` in each hit's offers.

## Phase 1 locales
`en, es, fr, pt, ar, zh, hi, sw, de, id`

## Rules for every agent
1. Use official APIs and feeds only. Never scrape Amazon, Temu, Shein, or any other retailer.
2. Affiliate links must carry a clear "affiliate" disclosure in the UI.
3. Send WhatsApp marketing only to customers with `whatsapp_opt_in = true`, and support STOP.
4. Don't make network calls in tests. Use mock mode and fixtures.
5. Include a README in your path covering how to run it, how to test it, and what is mocked.
