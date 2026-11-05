# Zakka

A worldwide AI shopping search and WhatsApp concierge. One catalog covers our dropship suppliers (marked up) and our affiliate partners (commission only). Every listing shows an honest total price and a delivery estimate for each country.

Start with [docs/CONTRACT.md](docs/CONTRACT.md).

| Part | Path |
| --- | --- |
| Database | `supabase/` |
| Storefront and admin | `apps/web/` |
| Supplier and affiliate sync, pricing, order forwarding | `services/catalog/` |
| Search API | `services/search/` |
| WhatsApp concierge and payments | `services/concierge/` |
| Shared types | `packages/shared/` |

Copy `.env.example` to `.env`. Every integration runs in mock mode until you add its keys.
