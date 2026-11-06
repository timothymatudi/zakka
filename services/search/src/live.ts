// Federated affiliate results. Affiliate partners (Amazon, Temu, Jumia, ...) are
// not bulk-indexed; the catalog queries them live:
//   GET {CATALOG_API_URL}/live?q=&country=&locale=  ->  { hits: [...] } or [...]
// Search appends those results after its indexed results on page 1, deduped by
// GTIN. A slow or failing catalog never blocks search: 800 ms timeout, then a
// short cooldown during which live results are skipped.
import type { Locale, SearchHit, SearchOffer, SourceKind } from './types';
import { currencyDecimals, currencyForCountry, fromUsd } from './money';

export interface LiveOffer extends SearchOffer {
  list_price_local?: number | null;
  list_currency?: string | null;
  shipping_local?: number | null;
}

export interface LiveItem {
  id: string;
  title: string;
  description?: string | null;
  brand?: string | null;
  gtin?: string | null;
  category_path?: string[];
  category_ids?: string[];
  image?: string | null;
  rating?: number | null;
  review_count?: number | null;
  popularity?: number | null;
  offers: LiveOffer[];
}

export interface LiveOptions {
  timeoutMs?: number;
  cooldownMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class LiveAffiliates {
  private skipUntil = 0;
  private timeoutMs: number;
  private cooldownMs: number;
  private fetchImpl: typeof fetch;
  private now: () => number;

  constructor(private baseUrl: string, opts: LiveOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 800;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  /** Live items for a query; [] on timeout, error, bad payload or during cooldown. */
  async search(q: string, country: string, locale: Locale): Promise<LiveItem[]> {
    if (!q.trim() || this.now() < this.skipUntil) return [];
    const url = `${this.baseUrl.replace(/\/$/, '')}/live?${new URLSearchParams({ q, country, locale })}`;
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) {
        // 404 = catalog without the endpoint yet; back off like any failure.
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as unknown;
      const items = Array.isArray(body) ? body : ((body as { hits?: unknown[]; results?: unknown[] })?.hits ?? (body as { results?: unknown[] })?.results ?? []);
      return items.filter(isLiveItem);
    } catch (err) {
      this.skipUntil = this.now() + this.cooldownMs;
      console.warn(`[live] skipped (${(err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message})`);
      return [];
    }
  }
}

function isLiveItem(x: unknown): x is LiveItem {
  const i = x as LiveItem;
  return (
    !!i && typeof i.id === 'string' && typeof i.title === 'string' && Array.isArray(i.offers) &&
    i.offers.every((o) => o && typeof o.offer_id === 'string' && typeof o.display_price_usd === 'number' && Array.isArray(o.ships_to))
  );
}

/** Contract-shaped hit for a live item, or null when none of its offers ship to the country. */
export function liveToHit(item: LiveItem, country: string): SearchHit | null {
  const cc = country.toUpperCase();
  const cur = currencyForCountry(cc);
  const offers = item.offers
    .filter((o) => o.ships_to.map((c) => c.toUpperCase()).includes(cc) && o.display_price_usd > 0)
    .sort((a, b) => a.display_price_usd - b.display_price_usd)
    .map((o) => {
      const { list_price_local, list_currency, shipping_local, ...base } = o;
      let local: number | null;
      let currency = cur;
      if (list_currency?.toUpperCase() === cur && list_price_local != null) {
        const f = 10 ** currencyDecimals(cur);
        local = Math.round((Number(list_price_local) + Number(shipping_local ?? 0)) * f) / f;
      } else {
        local = fromUsd(o.display_price_usd, cur);
        if (local == null) currency = 'USD';
      }
      return { ...base, kind: (o.kind ?? 'affiliate') as SourceKind, display_price_local: local ?? o.display_price_usd, currency };
    });
  if (!offers.length) return null;
  const days = offers.map((o) => o.delivery_days_min ?? o.delivery_days_max).filter((d): d is number => d != null);
  return {
    id: item.id,
    title: item.title,
    description: item.description ?? '',
    brand: item.brand ?? null,
    category_path: item.category_path ?? [],
    category_ids: item.category_ids ?? [],
    image: item.image ?? null,
    rating: item.rating ?? null,
    review_count: item.review_count ?? 0,
    offers,
    min_price_usd: offers[0].display_price_usd,
    ships_to: [...new Set(item.offers.flatMap((o) => o.ships_to.map((c) => c.toUpperCase())))].sort(),
    fastest_days: days.length ? Math.min(...days) : null,
    popularity: item.popularity ?? 0,
  };
}
