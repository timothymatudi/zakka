# Zakka storefront (`apps/web`)

Next.js 15 (App Router) + TypeScript + Tailwind v4 + next-intl. Mobile-first storefront and minimal admin.
Runs fully offline: with no service URLs or keys it uses the local mock catalog.

## Run

```bash
cd apps/web
npm install
cp .env.example .env.local   # optional; everything may stay empty
npm run dev                  # http://localhost:3000 -> redirects to /en
npm run build && npm start   # production
npm run lint                 # ESLint (next/core-web-vitals + typescript)
npm run typecheck            # tsc --noEmit
```

Shared types come from `../../packages/shared/src` through the `@shared/*` path alias (`experimental.externalDir`).

## Environment

| Name | Use |
| --- | --- |
| `SEARCH_API_URL` | `GET /search` per contract (also tries `GET /products/{id}`). Empty or unreachable: mock search. |
| `CATALOG_API_URL` | `GET /offers/{id}/price?country=` for authoritative local prices. Empty or unreachable: mock prices. |
| `CATALOG_API_TOKEN` | Bearer token for catalog POST calls (`lib/catalog-forward.ts`). |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only PostgREST inserts into `orders`, `order_items`, `affiliate_clicks`. Empty: in-memory store. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Digits only, used for `wa.me` links. Empty: `https://wa.me/?text=…` (opens WhatsApp's chooser). |
| `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_ID/SECRET`, `FLUTTERWAVE_SECRET_KEY`, `PAYSTACK_SECRET_KEY`, `MPESA_CONSUMER_KEY/SECRET` | Payment providers. All mock today. |
| `ZAKKA_FORCE_MOCK=1` | Ignore service URLs and use mock data. |

A down service is remembered for 30 seconds (`lib/http.ts`), so each page pays at most one timeout of 2.5 seconds.

## Pages (`/[locale]/…`, locales `en es fr pt ar zh hi sw de id`, `ar` renders RTL)

- `/` home: big search, category grid, rails for "Trending in {country}", "Arrives fast" (≤ 5 days) and "Best value".
- `/search?q=&category=&min=&max=&max_days=&rating=&from=&sort=&page=`: works without JavaScript (GET forms). Price is typed in local currency and converted to USD for the API.
- `/c/{slug}`: category page (the same results view).
- `/p/{id}`: every offer compared (total price, delivery, ships from). The best offer is highlighted: lowest price with each delivery day costing 2%.
- `/cart` and `/checkout`: the cart lives in localStorage. The checkout picker shows local methods first (M-Pesa KE/TZ, Paystack NG/GH/ZA/KE, Flutterwave in African markets, then card and PayPal everywhere). It collects `shipping_address`.
- `/orders` (lookup and a sample order) and `/orders/{id}`: status timeline and shipments.
- `/account`: language, country/currency, WhatsApp opt-in (**unticked by default**, STOP hint) and email opt-in.
- `/admin`: dashboard, products, markup rules editor, orders, sources. **Not protected yet. Add auth before deploying.**

API routes: `POST /api/checkout`, `GET /api/out/{offerId}` (records an affiliate click, then 302s to the partner), `POST /api/account`, `POST /api/admin/markup-rules`, `GET /api/orders/lookup`.

Country comes from the `zakka_country` cookie, then an edge geo header, then the locale's default. The header shows a persistent language and country picker and a "Chat on WhatsApp" button.

## Pricing

The web app never computes markup. Product pages use the catalog's `/offers/{id}/price`. Cards and rails convert the search document's `display_price_usd` with an FX table that rounds **up**. Checkout re-prices every item on the server and rejects affiliate offers.

## What is mocked

- **Catalog and search** (`src/lib/mock/catalog.ts`): 40 invented products in 10 categories, with 94 offers across all 11 source codes. Dropship and affiliate offers are mixed, ship from 9 countries and cover 18 destination countries. Offer prices stand in for catalog output. Partner URLs point at `partner.example.com`. Images are emoji tiles; real `image` URLs render when present.
- **Reference data** (`src/lib/markets.ts`): the countries, currencies and FX rates are mock values.
- **Orders**: an in-memory store with 5 seeded demo orders, used when Supabase is not configured. Mock payments settle at once, so the order shows as paid.
- **Payments** (`src/lib/payments.ts`): stubs only. A provider whose key is set still runs mock without settling. TODO: real Stripe, PayPal, Flutterwave, Paystack and M-Pesa calls, plus webhooks.
- **Account**: saved in cookies only. TODO: sign-in, then update the customer's own row (allowed columns only).
- **Admin**: shows mock data. Markup rules are validated and kept in memory. TODO: auth, and the `markup_rules` and `public_sources` reads and writes.

## Translations

UI strings exist for all 10 locales in `src/messages/*.json`. Missing keys fall back to English; the admin section is English only. **Every non-English translation needs native-speaker review.** Mock product titles are English only.
