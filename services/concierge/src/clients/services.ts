import { fixtureSearch } from '../fixtures/products';
import { log } from '../log';
import type { Locale, OfferPrice, SearchDocument, SearchResponse } from '../shared';
import type { Order, OrderItem, ShippingAddress } from '../store/types';

/** Catalog price response (contract: GET /offers/{id}/price). */
export type CatalogPrice = OfferPrice;

export interface SearchClient {
  search(q: { q: string; locale: Locale; country: string; perPage?: number }): Promise<{ hits: SearchDocument[]; fixture: boolean }>;
}
export interface CatalogClient {
  price(offerId: string, country: string): Promise<CatalogPrice | null>;
  /** POST /orders/{id}/forward with `Authorization: Bearer CATALOG_API_TOKEN` and the order's shipping address. */
  forward(orderId: string, shippingAddress: ShippingAddress | null, snapshot?: { order: Order; items: OrderItem[] }): Promise<{ ok: boolean; mock: boolean; status?: number; detail?: string }>;
}

interface Opts { baseUrl: string; offline: boolean; fixtureFallback: boolean; timeoutMs?: number; token?: string }

const isConnError = (e: unknown) => {
  const msg = String((e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.name ?? e);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|TimeoutError|AbortError|UND_ERR/i.test(msg);
};

/** Agent 4's search API (GET /search). Falls back to fixtures offline or (dev only) when unreachable. */
export class HttpSearchClient implements SearchClient {
  constructor(private o: Opts) {}
  async search({ q, locale, country, perPage = 5 }: { q: string; locale: Locale; country: string; perPage?: number }) {
    if (this.o.offline) return { hits: fixtureSearch(q, country, perPage), fixture: true };
    const url = `${this.o.baseUrl}/search?` + new URLSearchParams({ q, locale, country, sort: 'relevance', page: '1', per_page: String(perPage) });
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.o.timeoutMs ?? 4000) });
      if (!res.ok) throw new Error(`search HTTP ${res.status}`);
      const body = (await res.json()) as SearchResponse;
      return { hits: body.hits ?? [], fixture: false };
    } catch (e) {
      if (!this.o.fixtureFallback) throw e;
      log.warn('search API unavailable, using fixtures', { error: (e as Error).message });
      return { hits: fixtureSearch(q, country, perPage), fixture: true };
    }
  }
}

/** Agent 3's catalog API (prices, order forwarding). */
export class HttpCatalogClient implements CatalogClient {
  constructor(private o: Opts) {}

  async price(offerId: string, country: string): Promise<CatalogPrice | null> {
    if (this.o.offline) return null;
    try {
      const res = await fetch(`${this.o.baseUrl}/offers/${encodeURIComponent(offerId)}/price?country=${encodeURIComponent(country)}`,
        { signal: AbortSignal.timeout(this.o.timeoutMs ?? 4000) });
      if (!res.ok) return null;
      return (await res.json()) as CatalogPrice;
    } catch (e) {
      if (!this.o.fixtureFallback) throw e;
      return null; // caller uses the fallback conversion
    }
  }

  async forward(orderId: string, shippingAddress: ShippingAddress | null, snapshot?: { order: Order; items: OrderItem[] }) {
    if (this.o.offline) return { ok: true, mock: true, detail: 'offline: forward simulated' };
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.o.token) headers.authorization = `Bearer ${this.o.token}`;
      const res = await fetch(`${this.o.baseUrl}/orders/${encodeURIComponent(orderId)}/forward`, {
        method: 'POST', headers, // The order snapshot lets catalog forward orders it cannot read from a shared database (dev/mock mode).
        body: JSON.stringify({ shipping_address: shippingAddress, ...(snapshot ?? {}) }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 15000),
      });
      const detail = (await res.text()).slice(0, 500);
      return { ok: res.ok, mock: false, status: res.status, detail };
    } catch (e) {
      if (this.o.fixtureFallback && isConnError(e)) {
        log.warn('catalog API unreachable, simulating forward (dev fixture fallback)', { orderId });
        return { ok: true, mock: true, detail: `catalog unreachable (${(e as Error).message}); forward simulated` };
      }
      return { ok: false, mock: false, detail: (e as Error).message };
    }
  }
}
