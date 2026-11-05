# Zakka catalog service (`services/catalog`)

Python package `zakka_catalog`: supplier and affiliate connectors, catalog sync into
Postgres, the **reference pricing implementation**, AI enrichment (categories +
translations), order forwarding to dropship suppliers, and the Catalog HTTP API
(port 4020).

Everything runs offline. Any connector whose env keys are empty runs in **mock mode**
from `zakka_catalog/fixtures/*.json`. With no reachable database you can use
`--dry-run`, and the API falls back to an in-memory demo store.

## Setup

```bash
cd services/catalog
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt         # or: pip install -e ".[dev]"
```

Config is read only from the variable names in the repo-root `.env.example`. A
repo-root `.env` file is loaded if it exists, and real environment variables override it.

## Run

```bash
python -m zakka_catalog sources                     # list connectors: MOCK/LIVE, missing keys, docs link
python -m zakka_catalog sync --source cj            # sync one source into DATABASE_URL
python -m zakka_catalog sync --all                  # sync every source
python -m zakka_catalog sync --all --dry-run        # no DB: print every write + display prices
python -m zakka_catalog sync --source cj --max-pages 1   # partial sync (never marks offers stale)
python -m zakka_catalog sync --all --dry-run --json      # full report as JSON
python -m zakka_catalog forward <order_uuid> [--dry-run] # forward a paid order's dropship items
python -m zakka_catalog track [--dry-run]           # poll supplier tracking into shipments
python -m zakka_catalog serve                       # HTTP API on the CATALOG_API_URL port (4020)
```

Without `--dry-run`, if `DATABASE_URL` is empty or unreachable, `sync` exits with code 2 and
suggests `--dry-run`. `--dry-run` uses the mock reference data in `fixtures/reference.json`
(countries, currencies, static FX rates, a category tree, sources, and sample markup rules).
For `forward` and `track`, it also loads the demo order from `fixtures/orders.json`.

## HTTP API (`CATALOG_API_URL`, default `http://localhost:4020`)

| Method & path | Notes |
| --- | --- |
| `GET /offers/{offer_id}/price?country=XX` | Contract endpoint. Returns `{price, currency, price_usd, delivery_days_min, delivery_days_max}` plus `offer_id`, `kind`, and `ships_to_country`. Errors: 404 unknown offer, 410 inactive offer, 422 unknown country or bad id, 503 missing FX rate. |
| `POST /orders/{order_id}/forward` | Contract endpoint. **Needs the bearer token.** Optional body `{"shipping_address": {...}}`. Returns per-supplier results. Errors: 404 unknown order, 409 order not `paid`/`forwarded`. |
| `GET /health` | Shows the store (`postgres` or `memory`) and each connector's mock/live mode. |
| `POST /prices` | Addition: batch pricing, `{"country":"AE","offer_ids":[...]}` → `{prices, errors}`. |
| `POST /tracking/poll` | Addition: polls tracking for open supplier orders. **Needs the bearer token.** |

### Auth

State-changing routes (`POST /orders/{id}/forward`, `POST /tracking/poll`) require
`Authorization: Bearer $CATALOG_API_TOKEN`. The token is checked with a constant-time
compare, and a missing or wrong token gets 401 with `WWW-Authenticate: Bearer`.
If `CATALOG_API_TOKEN` is empty:

* **Mock mode** (no live dropship connector configured): the routes are open, and every
  call logs a warning.
* **Any live dropship connector configured**: the routes return 503.

Price routes (`GET /offers/{id}/price`, `POST /prices`) and `GET /health` are always open.
`/health` reports `write_auth` as `bearer`, `open-mock-mode`, or `disabled`.

`price_usd` is the local price converted back to USD (`price / fx_rate`, rounded to cents).
For USD countries it equals `price`.

When the database is unreachable, the API serves a demo store seeded from all fixtures.
Offer and product ids there are deterministic UUIDv5 values, so they stay the same across restarts.

## Pricing (`zakka_catalog/pricing.py`)

This is the reference implementation of the contract rule.

* Dropship: `price_usd = (cost_usd + shipping_usd) * (1 + percent/100) + fixed_usd`. The result is converted with `fx_rates` and rounded **up** using the rule's `round_to`.
* Affiliate: `list_price_usd + shipping_usd` converted to local currency, with **no markup**. It is rounded half-up to the currency's decimals, with no charm endings.
* Rule choice uses the first scope that matches, in the order **product > source > category > global**. Within that scope the highest `priority` wins, and ties go to the lowest id.
* Category rules **inherit down the tree**. The product's own category is checked first, then its parent, grandparent, and so on, and the nearest category with an active rule wins.
* If no rule matches, the offer is priced at cost with x.99 rounding (`FALLBACK_RULE`). Agent 1 should seed a global rule.
* `round_to` is in local currency units:
  * `0.99` gives x.99 endings, `0.95` gives x.95, and `0.5` gives x.50.
  * `1`, `5`, `10`, `100` round up to that multiple.
  * `9.99` gives 9.99, 19.99, 29.99, …
  * `0` (or less) rounds up to the currency's minor unit.
* Currencies with 0 decimals (JPY, and KES, IDR, or TZS when `currencies.decimals = 0`): the charm offset is cut to the currency's precision. So `0.99` becomes whole units and `9.99` becomes multiples of 10. With 3-decimal currencies (KWD), `0.99` gives x.990.
* `display_price_usd()` is the USD price written for the search index.

## Sync (`zakka_catalog/sync.py`)

For each connector page, sync does the following:

1. Converts amounts to USD (`amount / fx_rates.rate`).
2. Finds the product. It first looks for an existing offer with the same `(source, external_id)`. Otherwise it attaches the offer to an existing product with the same **GTIN** (this dedupes across sources). Otherwise it creates a new product.
3. Runs the enricher when a product is new, its source text changed, it has no category, or locales are missing.
4. Upserts the offer. `is_active` is true when stock is unknown or greater than 0.
5. Computes `display_price_usd`.

After a complete run, offers from that source that were not seen in the run are marked inactive. Partial runs (`--max-pages`) and runs that fail during a fetch never deactivate anything.
`display_price_usd` is always included in the sync report. It is written to
`offers.display_price_usd` (migration 0005). The store checks that the column exists first.

## Enrichment (`zakka_catalog/enrich.py`)

* `MockEnricher` is the default when `ANTHROPIC_API_KEY` is empty. It is deterministic:
  * The source category path is matched against our category slugs and names, with a keyword fallback.
  * Translations are placeholders: `"[fr] <title>"`.
* `AnthropicEnricher` makes one Messages API call per product. That call covers categorisation and every requested locale, using structured output (`client.messages.parse` with a pydantic schema). The model comes from `ANTHROPIC_MODEL`.
  * The instructions and category tree form a fixed system prefix marked for **prompt caching**. Product data goes in the user turn.
  * Category slugs that aren't in our tree are dropped. Missing locales fall back to the source text, and a refusal falls back to the mock output.
  * TODO: large one-off backfills should go through the Message Batches API (50% cost). Incremental sync stays synchronous.
* Tests never call the real API.

## Orders (`zakka_catalog/orders.py`)

* `forward_order` only accepts orders with status `paid` or `forwarded`.
  * Dropship items are grouped by source, and each group becomes one `supplier_orders` row.
  * Affiliate items are skipped.
  * It is idempotent: a group that was already placed is not placed again, and a `failed` group is retried on the same row.
  * The order becomes `forwarded` when every group is placed.
  * `order_items.unit_cost_usd` is filled from the offer's `cost_usd` for the dropship items being placed. It is set to null for affiliate items.
* Shipping address: taken from the request body if given, otherwise from `orders.shipping_address` (migration 0005, `{name, phone_e164, line1, line2, city, region, postal_code, country_code}`; `phone_e164` maps to `phone`). Live connectors refuse to place an order without one.
* `poll_tracking` upserts `shipments` and moves supplier orders to `shipped`/`delivered`.
* When a shipment's status changes (including the first time it is seen), `poll_tracking` notifies the concierge (`notify.py`):
  * Request: `POST {CONCIERGE_PUBLIC_URL}/internal/orders/{order_id}/notify` with header `x-internal-token: $CONCIERGE_INTERNAL_TOKEN`.
  * Body: `{status, carrier, tracking_number, tracking_url, last_event}`, where `status` is the shipment status: `pending`, `in_transit`, `delivered`, `exception` or `cancelled`.
  * `CONCIERGE_PUBLIC_URL` defaults to `http://localhost:4030`.
  * Mock mode (`CONCIERGE_INTERNAL_TOKEN` empty) only logs. Failures are logged and polling continues. It rolls the order up to `shipped`/`delivered` once all of its supplier orders get there.
* `supplier_orders.status` values: `pending`, `placed`, `failed`, `shipped`, `delivered`, `cancelled`.

## Tests

```bash
python -m pytest            # 134 tests, no network (sockets are blocked except loopback)
```

Live adapter code paths for CJ and Printful are tested with `httpx.MockTransport`.

## What is mocked

| Area | Mock behaviour |
| --- | --- |
| All 11 connectors | Mock mode when any of their env keys is empty. Uses fictional products, brands, ids and `*.example` image URLs. Data spans 12 ship-from countries, 7 currencies, and delivery times from 1 to 25 days. Some products share GTINs across sources to exercise deduping. |
| Dropship orders | Mock order ids look like `CJ-MOCK-<hash>`. Cost is `(cost + shipping) × qty`. Tracking comes from each fixture's `tracking` block. |
| FX / reference data | `fixtures/reference.json` holds static approximate rates. Real rates come from `fx_rates`. |
| AI | `MockEnricher`. |
| Concierge notifications | Logged only while `CONCIERGE_INTERNAL_TOKEN` is empty. |
| Database | `MemoryStore` (tests, `--dry-run`, and the API fallback). |

## Connector status: what to confirm against official docs

Only official APIs and feeds are used, and no retailer site is ever scraped. Unconfirmed
details are marked `TODO(confirm)` in the code. Adapters with no confirmed API raise
`NotConfirmedError` in live mode instead of guessing.

| Source | Live adapter | To confirm |
| --- | --- | --- |
| CJ Dropshipping | Implemented (token, product list/query, createOrderV2, order detail) | Auth body (`email`/`password` vs `apiKey`), token expiry, field names, and freight calculation for shipping cost and days per destination. https://developers.cjdropshipping.com/ |
| Printful | Implemented (store products, variant price, `POST /orders?confirm=true`, order shipments) | `X-PF-Store-Id` for account-level tokens, `external_id` limits, delivery confirmation field, and shipping rates per destination. https://developers.printful.com/docs/ |
| AliExpress Dropshipping | Signing + gateway + session (`ALIEXPRESS_DS_ACCESS_TOKEN`) implemented. Response mapping raises `NotConfirmedError`. | Token refresh flow. Method names, e.g. `aliexpress.ds.recommend.feed.get` / order / tracking, and response mapping. https://openservice.aliexpress.com/doc/doc.htm |
| AliExpress Portals | `aliexpress.affiliate.product.query` implemented (signed with `ALIEXPRESS_AFF_APP_SECRET`) | Params, response envelope and field names. That method returns no ships_to/delivery data, so sync skips those items until a source for that data is confirmed. |
| Amazon (Creators API) | `NotConfirmedError` (partner tags applied to mock links) | PA-API 5.0 was retired on 15 May 2026. To confirm: Creators API token flow, operation names, marketplace hosts, and price caching/display policy. Associates Central → Creators API. |
| Spocket | `NotConfirmedError` | No public third-party REST API confirmed. Request partner access. |
| Temu, Shein, Jumia (KOL), Noon | `NotConfirmedError` | Product feed/API through each affiliate program or network. |
| Flipkart | `NotConfirmedError` | Affiliate API (`affiliate-api.flipkart.net`, `Fk-Affiliate-Id` + `Fk-Affiliate-Token` from `FLIPKART_AFFILIATE_ID`/`FLIPKART_AFFILIATE_TOKEN`). Endpoint paths and response. |
