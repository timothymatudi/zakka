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
| `CONCIERGE_PUBLIC_URL`, `CONCIERGE_INTERNAL_TOKEN` | Payments are owned by the concierge. Checkout calls `POST /internal/payments/checkout` with header `x-internal-token`. Empty or unreachable: instant mock payment. |
| `WEB_BASE_URL` | Base for the payment `return_url` and `cancel_url`. |
| `ZAKKA_FORCE_MOCK=1` | Ignore service URLs and use mock data. |

A down service is remembered for 30 seconds (`lib/http.ts`), so each page pays at most one timeout of 2.5 seconds.

## Pages (`/[locale]/…`, locales `en es fr pt ar zh hi sw de id`, `ar` renders RTL)

- `/` home: big search, category grid, rails for "Trending in {country}", "Arrives fast" (≤ 5 days) and "Best value".
- `/search?q=&category=&min=&max=&max_days=&rating=&from=&sort=&page=`: works without JavaScript (GET forms). Price is typed in local currency and converted to USD for the API.
- `/c/{slug}`: category page (the same results view).
- `/p/{id}`: every offer compared (total price, delivery, ships from). The best offer is highlighted: lowest price with each delivery day costing 2%.
- `/cart` and `/checkout`: the cart lives in localStorage. The checkout picker shows local methods first (M-Pesa is the default in Kenya and Tanzania, Paystack in Nigeria, Ghana and South Africa, then Flutterwave, then card and PayPal everywhere). It collects `shipping_address`, creates the order on the server, then redirects to the concierge's `payment_url`. A 400 or 409 shows "couldn't start this payment"; a 502 shows "provider unavailable, try another method".
- `/orders` (lookup and a sample order) and `/orders/{id}`: status timeline and shipments.
- `/account`: language, country/currency, WhatsApp opt-in (**unticked by default**, STOP hint) and email opt-in.
- `/legal/affiliates`: affiliate program disclosures.
- `/signin`: email one-time code (Supabase Auth). `/account` shows who is signed in and saves preferences to the customer's own row.
- `/admin`: dashboard, worldwide coverage (stores, ship-from countries, countries we deliver to), products, markup rules editor, orders, sources. Only for Supabase users with `app_metadata.role = 'admin'` (see "Auth" below).

API routes: `POST /api/checkout`, `GET /api/out/{offerId}` (records an affiliate click, then 302s to the partner), `POST /api/account`, `POST /api/auth/otp`, `POST /api/auth/verify`, `POST /api/auth/signout`, `GET|POST /api/admin/markup-rules`, `GET /api/orders/lookup`.

**Partner names:** customer pages never name suppliers or partners. Dropship offers say "Sold by Zakka". Affiliate offers say "Partner store" with a "Continue to partner store" button and an "Affiliate link — Zakka may earn a commission" note. Comparison rows read "Zakka" and "Partner store 1, 2…". Program-required wording (for example the Amazon Associates sentence) appears only in the footer and on `/legal/affiliates`. Admin pages keep real names. Client components receive only the message namespaces they use.

Country comes from the `zakka_country` cookie, then an edge geo header, then the locale's default. The header shows a persistent language and country picker and a "Chat on WhatsApp" button.

## Pricing

The web app never computes markup. Product pages use the catalog's `/offers/{id}/price`. Cards and rails use `offers[].display_price_local` when its `currency` matches the visitor's market. Offline, they convert `display_price_usd` with the fallback FX table, rounding **up**. KES, IDR, TZS, UGX, NGN, JPY, KRW, VND, CLP and PKR show 0 decimals; other currencies show 2. The cart stores the catalog's local price. Checkout re-prices every item on the server and rejects affiliate offers.

## What is mocked

- **Catalog and search** (`src/lib/mock/catalog.ts`): 40 invented products in 10 categories, with 94 offers across all 11 source codes. Dropship and affiliate offers are mixed, ship from 9 countries and cover 18 destination countries. Offer prices stand in for catalog output. Partner URLs point at `partner.example.com`. Images are emoji tiles; real `image` URLs render when present.
- **Reference data** (`src/lib/markets.ts`): the countries, currencies and FX rates are mock values.
- **Orders**: an in-memory store with 5 seeded demo orders, used when Supabase is not configured.
- **Payments**: handled by the concierge. When it is not configured or unreachable, the order is paid at once (mock).
- **Auth** (no `SUPABASE_URL`/`SUPABASE_ANON_KEY`, not production): any email signs in with the code `000000`; emails starting with `admin@` are admins. Guests and mock users keep preferences in cookies.
- **Admin data**: without `SUPABASE_SERVICE_ROLE_KEY`, admin pages show the mock catalog and markup rules are kept in memory.

## Translations

UI strings exist for all 10 locales in `src/messages/*.json`. Missing keys fall back to English; the admin section is English only. **Every non-English translation needs native-speaker review.** Mock product titles are English only.

## Auth

- Sign-in uses Supabase Auth's email OTP over its REST API (no SDK). Tokens live in httpOnly cookies `zk_at` / `zk_rt`; middleware refreshes them before pages render. The user and role are always read back from `GET /auth/v1/user`.
- In the Supabase dashboard, set the "Magic Link" email template to include `{{ .Token }}` so customers get a code.
- Make someone an admin (SQL editor): `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email = 'you@example.com';` They must sign in again afterwards.
- Admin pages are gated in middleware and in the admin layout; `/api/admin/*` routes call `requireAdmin` themselves. Admin reads and writes use the service role on the server only.
- On first sign-in a `customers` row is created (or a guest row with the same email is linked). Preference saves use the customer's own JWT, so RLS and the column grants apply.
- In production without Supabase, sign-in and admin are off (404).
- `/admin/coverage` uses the SQL functions in `supabase/migrations/0009_admin_coverage.sql` (service role only).
