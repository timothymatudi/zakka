// Internal types for the search service. Public shapes come from packages/shared.
export type {
  Locale,
  SearchDocument,
  SearchOffer,
  SearchQuery,
  SearchResponse,
  SearchSort,
  SourceCode,
  SourceKind,
} from '../../../packages/shared/src/types';
export { LOCALES } from '../../../packages/shared/src/types';

import type { Locale, SearchDocument, SearchOffer } from '../../../packages/shared/src/types';

/**
 * Offer as returned by the API: the contract's SearchOffer plus the price in the
 * request country's currency. (Shared-type request: add these two fields to
 * SearchOffer in packages/shared.)
 */
export interface SearchOfferLocal extends SearchOffer {
  display_price_local: number;
  /** ISO 4217 code of display_price_local (the request country's currency). */
  currency: string;
}

/** A hit as returned by /search and /products/{id}. */
export interface SearchHit extends Omit<SearchDocument, 'offers'> {
  offers: SearchOfferLocal[];
}

/** Facet value; `label` is set on the category_slug facet (localized name). */
export interface FacetValue {
  value: string;
  count: number;
  label?: string;
}
export type Facets = Record<string, FacetValue[]>;

export interface Translation {
  title: string;
  description: string;
  bullet_points: string[];
}

export interface RawCategory {
  id: string;
  slug: string;
  parent_id: string | null;
  names: Partial<Record<Locale, string>>;
}

/**
 * A product with all its translations, as loaded from Postgres or the offline
 * dataset, before it becomes an index document. Prices are already the
 * catalog's `display_price_usd`; search never applies markup itself.
 */
export interface RawProduct {
  id: string;
  translations: Partial<Record<Locale, Translation>>;
  brand: string | null;
  gtin: string | null;
  /** Root to leaf. */
  categories: RawCategory[];
  image: string | null;
  rating: number | null;
  review_count: number;
  /** 0..1 */
  popularity: number;
  offers: SearchOffer[];
  /** Affiliate partner prices in their own currency (list + shipping), by offer. */
  local_prices?: LocalPrice[];
}

export interface LocalPrice {
  offer_id: string;
  currency: string;
  amount: number;
}

/**
 * One document per product in the single `products` collection (all locales).
 * Text is stored once in a base language (English when available) in
 * `title`/`description`/`bullets`, plus `title_<loc>`/`description_<loc>` only
 * for locales that have their own translation; queries fall back to the base.
 * Category names are not stored per locale: hits and facets resolve them from
 * the category directory at query time (`category_terms` holds every locale's
 * names once, for matching).
 *
 * Per-country fields exist only for *active* countries (CC = ISO code):
 *   cprice_CC  cheapest display_price_usd among offers shipping to CC
 *   cdmax_CC   best delivery_days_max to CC (max_days filter, "fastest" sort, speed score)
 *   csell_CC   sell score (0..1) for CC
 * Other countries are filtered by `ships_to` and ranked with the global
 * fields (`min_price_usd`, `best_dmax`, `sell_global`); exact values for the
 * country are computed at query time from `offers`.
 */
export interface IndexedDocument {
  id: string;
  base_locale: Locale;
  title: string;
  description: string;
  bullets: string;
  brand: string | null;
  gtin: string | null;
  category_ids: string[];
  category_slugs: string[];
  category_terms: string[];
  image: string | null;
  rating: number | null;
  rating_sort: number;
  rating_bucket: string;
  review_count: number;
  offers: SearchOffer[];
  min_price_usd: number;
  ships_to: string[];
  fastest_days: number | null;
  best_dmax: number;
  popularity: number;
  source_kinds: string[];
  source_codes: string[];
  offer_ships_from: string[];
  /** Median price of the product's top-level category (all countries), for query-time sell scores. */
  cat_ref_price: number;
  sell_global: number;
  local_prices?: LocalPrice[];
  [dynamic: `title_${string}` | `description_${string}` | `cprice_${string}` | `cdmax_${string}` | `csell_${string}`]: string | number | undefined;
}

export interface QueryUnderstanding {
  /** Search keywords with price/speed phrases and filler words removed. */
  keywords: string;
  /** Category slug, e.g. "phones". */
  category_hint: string | null;
  max_price: number | null;
  /** ISO 4217 code for max_price. */
  currency: string | null;
  max_days: number | null;
  source: 'ai' | 'rules';
}

export interface EngineQuery {
  q: string; // '*' or '' means match all
  locale: Locale;
  country: string;
  /** Category slug (resolved from slug/id/name before reaching the engine). */
  category?: string;
  min_price?: number;
  max_price?: number;
  max_days?: number;
  min_rating?: number;
  /** ISO country codes; matches products with at least one offer shipping from one of them. */
  ships_from?: string[];
  sort: 'relevance' | 'price_asc' | 'fastest' | 'rating';
  page: number;
  per_page: number;
}

export interface EngineResult {
  docs: IndexedDocument[];
  found: number;
  /** Raw facets keyed by: category_slug, source_kind, ships_from, price_bucket, rating. */
  facets: Facets;
}

export interface SearchEngine {
  readonly name: 'typesense' | 'memory';
  search(q: EngineQuery): Promise<EngineResult>;
  getById(id: string): Promise<IndexedDocument | null>;
}
