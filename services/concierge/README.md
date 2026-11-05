# Zakka concierge (WhatsApp + payments)

TypeScript Fastify service (port `CONCIERGE_PORT`, default 4030) that runs Zakka's WhatsApp shopping concierge on the **Meta WhatsApp Cloud API** and takes payments through Stripe Checkout, PayPal, Flutterwave, or Paystack, depending on the customer's country.

```
WhatsApp user ──► Meta Cloud API ──► POST /webhooks/whatsapp (X-Hub-Signature-256 checked)
                                          │  per-user queue, idempotent by wa_message_id
                                          ▼
                       Concierge state machine (whatsapp_conversations.state/context)
     search ─► SEARCH_API_URL/search   buy ─► orders + payment link   support ─► Claude (tool use)
                                          ▼
 provider webhook ─► POST /payments/webhook/{provider} ─► order paid ─► CATALOG_API_URL/orders/{id}/forward ─► confirm on WhatsApp
```

## Run

```bash
cd services/concierge
npm install
npm run dev                                              # watch mode, http://localhost:4030
npm run simulate -- "+254712345678" "cheap earbuds"      # full conversation, offline, mock mode
npm test                                                 # vitest, no network
npm run typecheck
npm run templates:export > templates.meta.json           # Meta template submission payloads
```

Config comes from `.env` (service folder or repo root; see the root `.env.example`). Node 22+ is required.

## Conversation flows

| Flow | Trigger | What happens |
| --- | --- | --- |
| Search | Any free text, in any language | Country comes from the stored customer, else the phone's calling code. Calls `GET /search?q=&locale=&country=`. Replies with an interactive **list** of the top 3: title, local price (`GET /offers/{id}/price`), delivery days, and seller: dropship items are **Sold by Zakka**, affiliate items **Partner store · Affiliate**. Supplier and partner names (CJ, AliExpress, Spocket, Printful, Amazon, Temu, Shein, Jumia, Noon, Flipkart) are never shown in any message, template, or AI reply (`src/brand-safety.ts`, enforced by `test/brand-safety.test.ts`); carrier names are allowed. State becomes `browsing`. |
| Buy (dropship) | Tap a dropship row, then **Buy now** | State becomes `collecting_address`. The bot offers the customer's last address for the same country, or asks for one (one item per line: name, street, optional street 2, city, optional region, optional postal code; a comma-separated line also works). The phone comes from WhatsApp and the country from the customer. After **Yes, continue**, it creates an `orders` row (`channel='whatsapp'`, `pending_payment`, `shipping_address` jsonb) plus `order_items`, picks the provider by country, and sends a `cta_url` payment button. State becomes `awaiting_payment`. |
| Paid | Provider webhook | Verifies the signature and checks that the amount matches. Moves the order `pending_payment → paid` atomically, so replays are no-ops. Then calls `POST CATALOG_API_URL/orders/{id}/forward` with `Authorization: Bearer $CATALOG_API_TOKEN` and body `{shipping_address}`; on success the order becomes `forwarded`. Confirms on WhatsApp: free-form inside the 24h window, otherwise the `order_confirmation` template. |
| Affiliate | Tap an affiliate row | Sends the partner link with an affiliate disclosure and records `affiliate_clicks` (`channel='whatsapp'`). |
| Tracking | "where is my order", "dónde está mi pedido", "oda yangu iko wapi", and similar | Replies with the latest order's status and tracking link (from `shipments`, else `WEB_BASE_URL/orders/{id}`). |
| Support | Refund, problem, or broken-item wording | Claude answers, grounded by tools that only see this customer's orders and the catalogue. It hands off to a human (`state='human_handoff'`, `context.handoff=true`) for refunds, disputes, or when unsure. During hand-off the bot stays silent until the user sends `menu`/`bot` or an agent calls `/internal/conversations/{waId}/reply` with `resume: true`. |
| Opt-out | `STOP`, `UNSUBSCRIBE`, `BAJA`, `ARRÊT`, `PARAR`, `توقف`, `退订`, `रोकें`, `ACHA`, `STOPP`, `BERHENTI`, and others | Matches the whole message only, so "stop light" is still a search. Sets `whatsapp_opt_in=false` and `marketing_opt_in=false`, resets the flow, and confirms in the user's language. `START` opts back in. |
| Language | Every free-text message | Offline detection (script plus keywords) for the 10 locales, stored in `customers.locale`. Every reply uses `src/lang/messages.ts`. |

State machine: `idle → browsing → confirming → collecting_address → awaiting_payment → idle`, plus `human_handoff`. Search passes the user's text through as `q` unchanged (search parses phrases like "under 2000 KES" itself, and `min_price`/`max_price` are USD). Items whose catalog price says `ships_to_country: false` are skipped. See `src/flows/states.ts`.

### WhatsApp policy enforcement (`src/whatsapp/messenger.ts`)
- **24-hour window:** free-form messages are only sent within 24h of the user's last inbound message. Outside it, only approved templates are sent; a free-form attempt raises `WindowClosedError`.
- **Marketing** templates (`price_drop_alert`, `weekly_deals`) are only sent when `whatsapp_opt_in = true` (`NotOptedInError` otherwise). Utility templates (order, shipping, and delivery updates) are always allowed for the customer's own orders.
- Every outbound message is stored in `whatsapp_messages`, and `last_outbound_at` is updated.

## Meta setup

1. **Business account:** create a Meta Business portfolio at business.facebook.com and verify the business (needed for higher messaging limits and for display-name approval).
2. **App:** at developers.facebook.com, create an app (type *Business*) and add the **WhatsApp** product. This creates a WhatsApp Business Account (WABA) and a test number.
3. **Phone number:** under WhatsApp → API Setup, add and verify your production number, and set the display name "Zakka". Copy the **Phone number ID** into `WHATSAPP_PHONE_NUMBER_ID`.
4. **Access token:** in Business Settings → System users, create a system user, give it the app and the WABA, and generate a permanent token with `whatsapp_business_messaging` and `whatsapp_business_management`. Put it in `WHATSAPP_ACCESS_TOKEN`. Temporary tokens expire after 24h.
5. **App secret:** in App settings → Basic, copy the App secret into `WHATSAPP_APP_SECRET`. It is used to check `X-Hub-Signature-256`.
6. **Webhook:** under WhatsApp → Configuration, set the callback URL to `https://<public-host>/webhooks/whatsapp` and the verify token to any random string, which also goes in `WHATSAPP_VERIFY_TOKEN`. Click *Verify and save*, then subscribe to the **messages** field. For local development, expose port 4030 with a tunnel (cloudflared or ngrok) and set `CONCIERGE_PUBLIC_URL` to the tunnel URL.
7. **Templates:** run `npm run templates:export` and submit each payload with `POST https://graph.facebook.com/v23.0/{WABA_ID}/message_templates`, or recreate them in WhatsApp Manager → Message templates. The registry is `src/templates/registry.ts`: 5 templates × 10 locales (`en es fr pt_BR ar zh_CN hi sw de id`), each with variables, examples, and a URL button.

   | Template | Category | Variables |
   | --- | --- | --- |
   | `order_confirmation` | UTILITY | order_ref, total, delivery_estimate; button `/orders/{{1}}` |
   | `shipping_update` | UTILITY | order_ref, carrier, tracking_number; button `/orders/{{1}}` |
   | `delivery_update` | UTILITY | order_ref, status, expected; button `/orders/{{1}}` |
   | `price_drop_alert` | MARKETING | product_title, new_price, old_price, country; button `/p/{{1}}` |
   | `weekly_deals` | MARKETING | deals_summary; button `/deals?ref={{1}}` |

8. **Payments:** point each provider's webhook at `https://<public-host>/payments/webhook/{stripe|paypal|flutterwave|paystack}`.
   - **Stripe:** subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`.
   - **Paystack:** uses `charge.success`.
   - **Flutterwave:** uses `charge.completed`. Set the secret hash in `FLUTTERWAVE_WEBHOOK_HASH`; each transaction is then re-verified with the API.
   - **PayPal:** uses `CHECKOUT.ORDER.APPROVED` (captured automatically) and `PAYMENT.CAPTURE.COMPLETED`, verified with `verify-webhook-signature`.

## Environment

| Variable | Use |
| --- | --- |
| `CONCIERGE_PORT` | Port (4030) |
| `DATABASE_URL` | Postgres with the contract tables. If empty or unreachable, an in-memory store is used. |
| `SEARCH_API_URL`, `CATALOG_API_URL`, `WEB_BASE_URL` | Internal services and storefront links |
| `CATALOG_API_TOKEN` | Bearer token for the catalog's forward endpoint |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Meta Cloud API |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Support replies (official `@anthropic-ai/sdk`, default `claude-sonnet-5-5`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Payment providers |
| Service-local (not yet in `.env.example`): `CONCIERGE_PUBLIC_URL`, `CONCIERGE_INTERNAL_TOKEN`, `FLUTTERWAVE_WEBHOOK_HASH`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` (`sandbox`/`live`), `WHATSAPP_GRAPH_VERSION` (`v23.0`), `CONCIERGE_FIXTURE_FALLBACK` (`1`), `CONCIERGE_OFFLINE`, `LOG_LEVEL` | See the contract requests |

Provider by country (`src/payments/index.ts`):
- **Paystack:** NG, GH, ZA, KE, CI
- **Flutterwave:** UG, TZ, RW, ZM, CM, SN, MW, SL, BF, BJ, TG, ML, CD, ET, EG
- **PayPal:** DE, AT, IT, NL, PL, BR, MX
- **Stripe Checkout:** everywhere else

If a provider doesn't support the local currency, the charge is made in USD (`orders.total_usd`).

## HTTP routes

| Route | Purpose |
| --- | --- |
| `GET /health` | Shows which store is in use and which integrations are live or mocked |
| `GET /webhooks/whatsapp` | Meta verification (`hub.challenge`) |
| `POST /webhooks/whatsapp` | Inbound messages; returns 401 on a bad signature |
| `POST /payments/webhook/:provider` | Provider webhooks; returns 400 on a bad signature |
| `GET/POST /mock-pay/:provider/:ref` | Mock checkout page. Only active for providers in mock mode. |
| `POST /internal/payments/checkout` | Payments for **both** channels (see below) |
| `POST /internal/orders/:id/notify` | Catalog calls this when a shipment changes. Body: `{status: pending\|in_transit\|delivered\|exception\|cancelled, carrier, tracking_number, tracking_url, last_event}`. Missing fields are filled from the stored shipment and order. `pending` sends nothing. `in_transit` with a carrier or tracking number sends `shipping_update`. `delivered`, `exception`, `cancelled`, and `in_transit` without tracking send `delivery_update`. The message is free-form inside the 24h window and the template outside it. An unknown status returns 400 and an unknown order returns 404. |
| `POST /internal/conversations/:waId/reply` | Human agent reply, body `{text, resume}` |
| `POST /internal/customers/:id/marketing` | Sends `{template, params, url_param}`. Opt-in is enforced. |

`/internal/*` requires the `x-internal-token: $CONCIERGE_INTERNAL_TOKEN` header. If the token is unset, these routes only accept loopback requests.

### Web checkout: `POST /internal/payments/checkout`

The concierge owns payments for both channels. Like the other `/internal/*` routes, it requires the `x-internal-token` header, or accepts loopback requests only when no token is set.

```jsonc
// request
{
  "order_id": "uuid",                       // required
  "provider": "stripe|paypal|paystack|flutterwave|mpesa",   // optional; default picked by country
  "return_url": "https://shop/checkout/done", // required, http(s)
  "cancel_url": "https://shop/cart",          // required, http(s)
  "order": { /* contract orders row, id must equal order_id */ } // optional fallback when the store doesn't have it
}
// 200 response
{ "provider": "paystack", "payment_url": "https://...", "payment_ref": "..." }
// errors: 400 invalid input, provider, or currency (e.g. M-Pesa is KES only) · 401 token · 404 order not found · 409 order not pending_payment · 502 provider error
```

How a checkout is handled:
- **Order lookup:** the order is loaded from the store. If the store doesn't have it, the `order` object from the request is stored under its own id.
- **Country:** taken from `shipping_address.country_code`, otherwise from the customer's country.
- **Recording:** the provider and `payment_ref` are written to the order.
- **Payment success:** runs the same paid → forward → confirm path as WhatsApp. A WhatsApp message is only sent if the customer has a WhatsApp conversation.
- **Mock mode:** `payment_url` is the mock-pay page. Pressing pay 303-redirects the browser to `return_url`, and a JSON request gets `return_url` in the response. The page also has a Cancel link to `cancel_url`.
- **M-Pesa:** uses STK push, so the customer approves on their phone. `payment_url` is `return_url`, and the callback goes to `/payments/webhook/mpesa?token=$MPESA_CALLBACK_TOKEN`. Configure it with `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_TOKEN`, and `MPESA_ENV` (`sandbox`/`live`). If any of these is missing, M-Pesa runs in mock mode, which accepts KES only.

The forward call sends `{shipping_address, order, items}`, so catalog can forward even when it doesn't share a database with the concierge.

## What's mocked (when keys are empty)

| Integration | Mock behaviour |
| --- | --- |
| WhatsApp send | `MockWhatsAppClient` logs each outbound message (rendered text and kind) instead of calling the Graph API. Without `WHATSAPP_APP_SECRET`, unsigned webhooks are accepted and a warning is logged. |
| Payments | Each provider without keys becomes a `MockProvider`. Its payment link points to `CONCIERGE_PUBLIC_URL/mock-pay/{provider}/{ref}`. Pressing **Pay (mock)** posts a `mock.payment_succeeded` webhook to `/payments/webhook/{provider}`, which runs the real paid → forward → confirm path. |
| AI | `MockSupport` gives a deterministic reply grounded in the customer's latest order, and escalates refund or damage wording. |
| Search / catalog | `NODE_ENV != production` and the service is unreachable: built-in fixtures (`src/fixtures/products.ts`) and approximate FX rates are used. Forwarding is simulated and reported as `mock: true`. In production, these failures are surfaced instead. |
| Database | In-memory store when `DATABASE_URL` is empty or unreachable. |

## Claude usage (`src/ai/support.ts`)
- Uses the official SDK with `client.beta.messages.create` in a manual tool loop (at most 5 turns).
- Tools: `get_orders`, `get_order`, `search_products`, and `reply_to_customer` (all `strict: true`). The data tools only see the current customer's records.
- `tool_choice` is left on auto, because current models reject forced tool choice. The prompt tells the model to finish with `reply_to_customer`.
- The system prompt is static and cached (`cache_control: ephemeral`). Per-customer data goes in the user turn.
- `output_config.effort: "low"` (chat latency).
- Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) is on for models that support it.
- A `refusal` stop reason, any API error, or no final reply leads to a human hand-off.

## Layout

```
src/
  server.ts            Fastify routes, raw-body signature handling, per-user queue
  flows/               concierge.ts (flows), states.ts (state machine), intents.ts (STOP/track/... keywords)
  whatsapp/            signature, parse, client (Cloud API + mock), messenger (24h window/opt-in), window, payloads
  payments/            stripe, paypal, africa (paystack + flutterwave), mock, provider selection
  ai/support.ts        Claude support (SDK) + offline mock
  clients/services.ts  search + catalog HTTP clients with fixture fallback
  store/               Postgres (contract tables) + in-memory store
  templates/           Meta template registry + export script
  lang/                language detection + 10-locale message catalogue
  simulate.ts          CLI simulator
test/                  vitest: signatures, state machine/flows, STOP, 24h window, templates, AI tool loop
```
