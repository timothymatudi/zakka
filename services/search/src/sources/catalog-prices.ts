// Prices come from the catalog service (Agent 3), never re-implemented here.
// GET {CATALOG_API_URL}/offers/{offer_id}/price?country=XX -> { price_usd, ... }

export interface PriceLookup {
  priceUsd(offerId: string, country: string): Promise<number | null>;
}

export function catalogPriceClient(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 3000): PriceLookup {
  let down = false; // circuit breaker: stop calling after the catalog is unreachable once
  const memo = new Map<string, number | null>(); // USD price is locale-independent; reuse across locales

  async function fetchPrice(offerId: string, country: string): Promise<number | null> {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/offers/${encodeURIComponent(offerId)}/price?country=${encodeURIComponent(country)}`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      const body = (await res.json()) as { price_usd?: number };
      return typeof body.price_usd === 'number' && body.price_usd > 0 ? body.price_usd : null;
    } catch {
      down = true;
      console.warn(`[catalog] ${baseUrl} unreachable; falling back to stored display_price_usd`);
      return null;
    }
  }

  return {
    async priceUsd(offerId, country) {
      if (down) return null;
      const key = `${offerId}|${country}`;
      if (memo.has(key)) return memo.get(key)!;
      const v = await fetchPrice(offerId, country);
      memo.set(key, v);
      return v;
    },
  };
}
