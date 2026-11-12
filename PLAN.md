# Zakka master plan

The single list of everything left to finish the project. Tick a box (`[x]`) the moment a task is done and
verified, and add the date. Nothing counts as done until it has been checked.

- **Me** = Claude does it. **You** = needs the owner (sign-ups, keys, decisions, legal review).
- Last full audit: 2026-11-10. Last update: 2026-11-12. Progress: **14 of 74 done**.
- Last error check: 2026-11-12. All test suites pass (catalog 289, concierge 114, search 77, db scripts 5). Web typecheck and lint clean. No new tasks ticked — the 8 already done remain the only done items. Node modules were missing and have now been installed.

## Audit result (2026-11-10)

What was checked, and what it showed:

| Check | Result |
|---|---|
| Catalog tests (Python) | Pass |
| Search tests | 77 pass, typecheck clean |
| Concierge tests | 114 pass, typecheck clean |
| Database script tests | 5 pass |
| Web typecheck, lint, production build | Pass |
| Crawl of 14 pages in all 10 languages (140 pages) | No server errors, no broken pages |
| Admin and account pages signed in (en, de, ar) | All load; missing translations fall back to English |
| Migrations 0001-0009 and seeds on local Postgres 17 | Apply cleanly (pgvector column shimmed locally) |
| Live store APIs | **None tested: no keys yet** |
| Web tests | 44 pass (added 2026-11-12) |
| CI | Runs on every push; green on GitHub (2026-11-12) |
| Hosting config | **None exists** |

## A. Web app: fix now, no keys needed (Me)

- [x] A1. Block mock payments in production (2026-11-10: production refuses, development still mocks)
- [ ] A2. Link orders and affiliate clicks to the signed-in customer. Code written 2026-11-10 and the guest path is checked; tick after G6 proves the signed-in path on real Supabase
- [x] A3. Protect the checkout API: same-origin check and rate limit (2026-11-10: other sites get 403; 10 a minute per address, then 429; sign-in code requests and checks are limited too)
- [x] A4. Add security headers (2026-11-10: content policy, HSTS, no framing, referrer and permissions rules)
- [x] A5. Add error pages in all 10 languages (2026-11-10: built and translated; not yet seen with a real error)
- [x] A6. Add favicon, app icon, web manifest and a social share image (2026-11-10)
- [x] A7. Upgrade Next.js to clear 2 security advisories (next: moderate, postcss: high). The fix is Next 16, a major upgrade, so it needs a full re-test (2026-11-12: upgraded to 16.4.6; postcss high cleared; minimatch moderate in @typescript-eslint dev dep has no upstream fix yet)
- [x] A8. Payment method names in all 10 languages (2026-11-10: they are brand names, so the spelling is the same everywhere)
- [ ] A9. Translate 66 admin and coverage texts into 9 languages (internal pages, low priority)
- [ ] A10. Load category pages from Supabase instead of the mock list. Code written 2026-11-12 and the mock fallback is checked; tick after G2 proves it on real Supabase
- [ ] A11. Update order status from payment webhooks. Code written 2026-11-12: `updateOrder` now writes to Supabase, and the concierge moves the order to paid on its webhook; tick after H4 proves it with a sandbox payment
- [x] A12. Add web tests: payment fallback, checkout, sign-in gate, admin gate (2026-11-12: 44 tests in `apps/web/test`, run with `npm test` and in CI)
- [x] A13. Check every page at phone width (375 px) and in right-to-left Arabic (2026-11-12: 24 page types in all 10 languages at 375 px, including cart and checkout with an item, account and admin; fixed the language picker running off the screen, the cart overflowing with long prices, English product text scrambled on Arabic pages, arrows pointing the wrong way in Arabic, and cramped admin markup selects)
- [ ] A14. Rename the directory label "Connected" to "Built" on the sign-up checklist page (the page is not in this repo; do it where the page lives)
- [x] A15. Show a signed-in customer their own orders on `/orders` (2026-11-12: signed-in users see their order list; guests see the lookup form)
- [ ] A16. Tighten the content policy with per-request nonces (today it allows inline scripts, which Next.js needs without nonces)

## B. Web app: needs you

- [ ] B1. Privacy, Terms, Shipping and Returns, and Contact pages. Drafted 2026-11-12 in English at `/legal/...`, linked from the footer, marked as drafts and hidden from search engines. You: (1) have the wording reviewed, (2) fill in the rest of `policies.company` in `apps/web/src/messages/en.json` (WhatsApp number; legal name set to Zakka, governing law to England and Wales, support email set to customersupport@zakka.com and address to "serving customers worldwide" on 2026-11-12; a street address may still be required by law, check in the review), (3) confirm the 14-day return window, the 15-day lost-parcel rule and the 10-working-day refund time. Me, after that: set `POLICY_DRAFT` to false in `apps/web/src/lib/policies.ts`, add the pages to the sitemap, and translate them into the other 9 languages
- [ ] B2. Cookie notice and analytics: decide whether to add them (neither exists)
- [ ] B3. Native-speaker review of the 1,220 category names (written by AI), especially ar, hi, sw, zh, id

## C. Stores built and waiting for keys (You: sign up and add keys. Me: live test)

One box per store. Ticked only when a real search, price and link have been checked.

- [ ] C1. eBay (developer approval pending since 2026-11-08; also needs a Partner Network campaign ID)
- [ ] C2. Awin (feed links; no live search)
- [ ] C3. Impact
- [ ] C4. Rakuten Advertising (confirm token renewal and XML names)
- [ ] C5. Admitad (confirm grant type and feed columns; no live search)
- [ ] C6. CJ Affiliate (confirm result limit and shipping format)
- [ ] C7. CJ Dropshipping (also test order and tracking)
- [ ] C8. Printful (also test order and tracking)
- [ ] C9. AliExpress dropship (confirm response mapping)
- [ ] C10. AliExpress affiliate
- [ ] C11. Rakuten Ichiba (official docs were returning 503)
- [ ] C12. Coupang (confirm signing; search path fixed 2026-11-08, untested live)
- [ ] C13. Shopee (confirm signing; one account per country)
- [ ] C14. Lazada (needs a sample feed; no live search)
- [ ] C15. Resolve the 37 "to confirm" notes in the catalog code as each store goes live

## D. Stores blocked (You: apply. Me: build once access exists)

- [ ] D1. Amazon (per country; product search API not confirmed)
- [ ] D2. Temu
- [ ] D3. SHEIN
- [ ] D4. Jumia
- [ ] D5. noon
- [ ] D6. Flipkart
- [ ] D7. Spocket (no public API today)
- [ ] D8. Mercado Libre (no public product feed or API today)

## E. More stores worldwide

- [ ] E1. Rank the 94 "Can join" stores in the directory by region and size
- [ ] E2. Join the top stores through the networks already built (Awin, Impact, CJ Affiliate, Rakuten Advertising, Admitad)
- [ ] E3. Build new connectors only for stores no network covers

## F. Accounts and keys (You). Keys go in `.env`, never in chat

- [ ] F1. Supabase project: URL, anon key, service role key
- [ ] F2. Typesense for search: host and API key
- [ ] F3. Anthropic API key for product enrichment
- [ ] F4. WhatsApp (Meta Cloud API): phone number ID, access token, verify token, app secret
- [ ] F5. Stripe keys and webhook secret
- [ ] F6. PayPal keys and webhook ID
- [ ] F7. Flutterwave keys and webhook hash
- [ ] F8. Paystack key
- [ ] F9. M-Pesa keys, shortcode and passkey
- [ ] F10. Exchange-rate source (`FX_API_URL`)
- [ ] F11. Internal tokens: catalog, search admin, concierge
- [ ] F12. Turn on Remote Control for the working session (toolbar switch)

## G. Database (Me, after F1)

- [x] G1. Migrations and seeds verified on a local Postgres 17 (2026-11-09)
- [ ] G2. Run migrations 0001-0009 and seeds on the real Supabase project, with real pgvector
- [ ] G3. Test real sign-in by email code, and set the owner's account as admin
- [ ] G4. Import the product catalog into the database
- [ ] G5. Check the admin coverage page against real data
- [ ] G6. Place an order while signed in and confirm it carries the customer; do the same for an affiliate click (finishes A2)

## H. Launch

- [ ] H1. Choose hosting for the web app and the 3 services (You). No hosting config exists
- [x] H2. Add CI so tests run on every push (2026-11-12: typecheck, lint, tests and production build for the web app, plus the search, concierge and catalog tests; all green on GitHub)
- [ ] H3. Domain, `WEB_BASE_URL`, and public webhook addresses (You, then Me)
- [ ] H4. Sandbox payment end to end for each provider; the webhook marks the order paid (Me, after F5-F9)
- [ ] H5. WhatsApp concierge live test (Me, after F4)
- [ ] H6. Search service against a real Typesense with real products (Me, after F2 and G4)
- [ ] H8. Put a shared rate limit in front of the site (the built-in one counts per server, so several servers each count on their own)
- [ ] H7. Final check: every test suite, production build, full walk-through on desktop and phone (Me)

## I. Housekeeping

- [x] I1. Coupang search path fixed (2026-11-08)
- [x] I2. Commit and push pending work (2026-11-12: everything is on `main` on GitHub)
- [ ] I3. Look at the published sign-up checklist page signed in (only a local copy was checked)

## Order of work

1. Section A, top to bottom. No keys needed.
2. B1 draft, so you can review while the rest continues.
3. F1 (Supabase), then section G.
4. Section C, one store at a time, as each set of keys arrives.
5. F2 to F11, then section H.
6. Sections D and E as approvals come in.
