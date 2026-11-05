import 'server-only';
import type { Locale, SearchDocument, SearchResponse, SearchSort } from '@shared/types';
import { config } from './config';
import { fetchJson } from './http';
import { CATEGORIES, PRODUCTS, type MockProduct } from './mock/catalog';

export interface SearchParams {
  q?: string;
  locale: Locale;
  country: string;
  category?: string; // category slug
  min_price?: number; // USD
  max_price?: number; // USD
  max_days?: number;
  sort?: SearchSort;
  page?: number;
  per_page?: number;
  // Not yet in the contract's search API: sent along, and also applied locally to the returned page.
  min_rating?: number;
  ships_from?: string;
}

export interface SearchResult extends SearchResponse {
  source: 'live' | 'mock';
  per_page: number;
}

/** Keep only the offers that ship to the country and recompute per-country fields. */
export function localize<T extends SearchDocument>(doc: T, country: string): T | null {
  const offers = doc.offers.filter((o) => o.ships_to.includes(country));
  if (offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) => a.display_price_usd - b.display_price_usd);
  return {
    ...doc,
    offers: sorted,
    min_price_usd: sorted[0].display_price_usd,
    fastest_days: Math.min(...sorted.map((o) => o.delivery_days_max ?? 99)),
  };
}

function keep(h: SearchDocument, p: SearchParams): boolean {
  if (p.min_rating && (h.rating ?? 0) < p.min_rating) return false;
  if (p.ships_from && !h.offers.some((o) => o.ships_from === p.ships_from)) return false;
  return true;
}

export async function search(p: SearchParams): Promise<SearchResult> {
  const per_page = p.per_page ?? 24;
  const page = p.page ?? 1;
  if (config.searchApiUrl) {
    const qs = new URLSearchParams();
    qs.set('q', p.q ?? '');
    qs.set('locale', p.locale);
    qs.set('country', p.country);
    if (p.category) qs.set('category', p.category);
    if (p.min_price != null) qs.set('min_price', String(p.min_price));
    if (p.max_price != null) qs.set('max_price', String(p.max_price));
    if (p.max_days != null) qs.set('max_days', String(p.max_days));
    if (p.ships_from) qs.set('ships_from', p.ships_from);
    if (p.min_rating) qs.set('min_rating', String(p.min_rating));
    qs.set('sort', p.sort ?? 'relevance');
    qs.set('page', String(page));
    qs.set('per_page', String(per_page));
    const live = await fetchJson<SearchResponse>(`${config.searchApiUrl}/search?${qs}`);
    if (live && Array.isArray(live.hits)) {
      const hits = live.hits.filter((h) => keep(h, p));
      return { ...live, hits, source: 'live', per_page };
    }
  }
  return mockSearch(p);
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function textScore(doc: MockProduct, q: string[]): number {
  if (q.length === 0) return 1;
  const hay = tokens(`${doc.title} ${doc.brand ?? ''} ${doc.category_slug} ${doc.description}`);
  let score = 0;
  for (const t of q) {
    if (hay.includes(t)) score += 2;
    else if (hay.some((h) => h.startsWith(t) || (t.length > 3 && h.includes(t)))) score += 1;
  }
  return score;
}

export function mockSearch(p: SearchParams): SearchResult {
  const per_page = p.per_page ?? 24;
  const page = p.page ?? 1;
  const q = tokens(p.q ?? '');
  const cat = p.category ? CATEGORIES.find((c) => c.slug === p.category || c.id === p.category) : undefined;

  const scored: { doc: MockProduct; score: number }[] = [];
  for (const base of PRODUCTS) {
    if (cat && !base.category_ids.includes(cat.id)) continue;
    const score = textScore(base, q);
    if (score === 0) continue;
    const doc = localize(base, p.country);
    if (!doc) continue;
    if (p.min_price != null && doc.min_price_usd < p.min_price) continue;
    if (p.max_price != null && doc.min_price_usd > p.max_price) continue;
    if (p.max_days != null && (doc.fastest_days ?? 99) > p.max_days) continue;
    scored.push({ doc, score });
  }

  // Facets are computed before the rating / ships-from filters, like a search engine would.
  const facetCat = new Map<string, number>();
  const facetFrom = new Map<string, number>();
  for (const { doc } of scored) {
    facetCat.set(doc.category_slug, (facetCat.get(doc.category_slug) ?? 0) + 1);
    for (const from of new Set(doc.offers.map((o) => o.ships_from).filter((x): x is string => !!x))) {
      facetFrom.set(from, (facetFrom.get(from) ?? 0) + 1);
    }
  }

  const filtered = scored.filter(({ doc }) => keep(doc, p));
  // Sell score: popularity, rating, delivery speed and price (contract ranking, approximated for mock).
  const sell = (d: SearchDocument) =>
    d.popularity * 2 + (d.rating ?? 0) / 5 + 1 / Math.max(1, d.fastest_days ?? 30) - d.min_price_usd / 500;
  type Row = (typeof filtered)[number];
  const sorters: Record<SearchSort, (a: Row, b: Row) => number> = {
    relevance: (a, b) => b.score - a.score || sell(b.doc) - sell(a.doc),
    price_asc: (a, b) => a.doc.min_price_usd - b.doc.min_price_usd,
    fastest: (a, b) =>
      (a.doc.fastest_days ?? 99) - (b.doc.fastest_days ?? 99) || a.doc.min_price_usd - b.doc.min_price_usd,
    rating: (a, b) => (b.doc.rating ?? 0) - (a.doc.rating ?? 0) || b.doc.review_count - a.doc.review_count,
  };
  filtered.sort(sorters[p.sort ?? 'relevance']);

  const toFacet = (m: Map<string, number>) =>
    [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);

  return {
    hits: filtered.slice((page - 1) * per_page, page * per_page).map((x) => x.doc),
    found: filtered.length,
    // Same facet keys as the search API (category_path values are slugs in mock mode).
    facets: {
      category_slug: toFacet(facetCat).map((f) => ({ ...f, label: f.value })),
      category_path: toFacet(facetCat),
      ships_from: toFacet(facetFrom),
    },
    page,
    per_page,
    source: 'mock',
  };
}
