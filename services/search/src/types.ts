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

/**
 * A product as loaded from Postgres (or fixtures) for one locale, before it is
 * turned into an index document. Prices are already the catalog's
 * `display_price_usd`; search never applies markup itself.
 */
export interface RawProduct {
  id: string;
  locale: Locale;
  title: string;
  description: string;
  bullet_points: string[];
  brand: string | null;
  /** Root to leaf, localized names. */
  category_path: string[];
  /** Root to leaf. */
  category_ids: string[];
  /** Root to leaf. */
  category_slugs: string[];
  image: string | null;
  rating: number | null;
  review_count: number;
  /** 0..1 */
  popularity: number;
  offers: SearchOffer[];
}

/**
 * What is stored in Typesense / the memory engine. It is a superset of the
 * contract's SearchDocument: the extra fields support facets, filters and
 * per-country ranking, and are stripped before results leave the API.
 *
 * Per-country dynamic fields (CC = ISO country code, upper case):
 *   cprice_CC   cheapest display_price_usd among offers shipping to CC
 *   cdays_CC    fastest delivery_days_min to CC
 *   cdmax_CC    best delivery_days_max to CC (used for max_days filter + speed score)
 *   cpbucket_CC price bucket label for cprice_CC
 *   csell_CC    sell score (0..1) for CC
 */
export interface IndexedDocument {
  id: string;
  title: string;
  description: string;
  brand: string | null;
  category_path: string[];
  category_ids: string[];
  image: string | null;
  rating: number | null;
  review_count: number;
  offers: SearchOffer[];
  min_price_usd: number;
  ships_to: string[];
  fastest_days: number | null;
  popularity: number;
  // internal
  bullets: string;
  category_slugs: string[];
  /** "slug|Localized name" per category level, faceted as category_slug. */
  category_keys: string[];
  source_kinds: string[];
  source_codes: string[];
  offer_ships_from: string[];
  rating_bucket: string;
  rating_sort: number;
  [dynamic: `cprice_${string}` | `cdays_${string}` | `cdmax_${string}` | `cpbucket_${string}` | `csell_${string}`]: number | string;
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
  facets: Facets;
}

export interface SearchEngine {
  readonly name: 'typesense' | 'memory';
  search(q: EngineQuery): Promise<EngineResult>;
  /** One document by product id, or null if the locale collection has no such product. */
  getById(locale: Locale, id: string): Promise<IndexedDocument | null>;
}
