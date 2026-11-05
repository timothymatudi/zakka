// Shared types for the TypeScript services. Mirrors docs/CONTRACT.md.

export type Locale = 'en' | 'es' | 'fr' | 'pt' | 'ar' | 'zh' | 'hi' | 'sw' | 'de' | 'id';
export const LOCALES: Locale[] = ['en', 'es', 'fr', 'pt', 'ar', 'zh', 'hi', 'sw', 'de', 'id'];
export const RTL_LOCALES: Locale[] = ['ar'];

export type SourceKind = 'dropship' | 'affiliate';
export type SourceCode =
  | 'cj' | 'aliexpress_ds' | 'spocket' | 'printful'
  | 'amazon' | 'temu' | 'shein' | 'aliexpress_aff' | 'jumia' | 'noon' | 'flipkart';

export interface SearchOffer {
  offer_id: string;
  source_code: SourceCode;
  kind: SourceKind;
  display_price_usd: number;
  delivery_days_min: number | null;
  delivery_days_max: number | null;
  ships_from: string | null;
  ships_to: string[];
  url: string | null;
}

export interface SearchDocument {
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
}

export type SearchSort = 'relevance' | 'price_asc' | 'fastest' | 'rating';

export interface SearchQuery {
  q: string;
  locale: Locale;
  country: string;
  category?: string;
  min_price?: number;
  max_price?: number;
  max_days?: number;
  sort?: SearchSort;
  page?: number;
  per_page?: number;
}

export interface SearchResponse {
  hits: SearchDocument[];
  found: number;
  facets: Record<string, { value: string; count: number }[]>;
  page: number;
}

export interface OfferPrice {
  price: number;
  currency: string;
  price_usd: number;
  delivery_days_min: number | null;
  delivery_days_max: number | null;
}

export type OrderStatus =
  | 'pending_payment' | 'paid' | 'forwarded' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

export const BRAND = {
  teal: '#0F766E',
  coral: '#F97362',
  cream: '#FBF8F3',
  charcoal: '#1F2937',
} as const;
