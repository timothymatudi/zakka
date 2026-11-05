// Sell score: the tie-breaker applied after text relevance.
//
//   sell = 0.30 * popularity
//        + 0.25 * rating      (Bayesian-smoothed so 5.0 from 2 reviews < 4.7 from 2,000)
//        + 0.25 * speed       (delivery to the shopper's country)
//        + 0.20 * price       (cheaper than the category's median in that country scores higher)
//
// Every component is in 0..1, so the score is in 0..1. The score is computed per
// country at index time (field csell_CC) so Typesense can sort by it natively,
// and the memory engine uses the exact same values.

export const SELL_WEIGHTS = { popularity: 0.3, rating: 0.25, speed: 0.25, price: 0.2 } as const;

/** Prior used for rating smoothing. */
const RATING_PRIOR_MEAN = 3.8;
const RATING_PRIOR_WEIGHT = 20;

export interface SellInput {
  popularity: number; // 0..1
  rating: number | null; // 1..5
  review_count: number;
  /** Delivery promise in days to the shopper's country (best offer's max days). */
  delivery_days: number | null;
  /** Cheapest price to the shopper's country, USD. */
  price_usd: number;
  /** Median price of comparable products (same top-level category) in that country. */
  reference_price_usd: number;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export function ratingScore(rating: number | null, reviews: number): number {
  const n = Math.max(0, reviews || 0);
  const r = rating == null ? RATING_PRIOR_MEAN : rating;
  const smoothed = (r * n + RATING_PRIOR_MEAN * RATING_PRIOR_WEIGHT) / (n + RATING_PRIOR_WEIGHT);
  return clamp01((smoothed - 1) / 4);
}

/** 1-2 days -> ~1, 7 days -> 0.5, 14 days -> ~0.3, unknown -> 0.15. */
export function speedScore(days: number | null): number {
  if (days == null || !Number.isFinite(days)) return 0.15;
  return clamp01(1 / (1 + Math.max(0, days - 1) / 6));
}

/** Half the median price -> 0.75, median -> 0.5, double -> 0.25. */
export function priceScore(price: number, reference: number): number {
  if (!(price > 0) || !(reference > 0)) return 0.5;
  return clamp01(0.5 - 0.25 * Math.log2(price / reference));
}

export function sellScore(i: SellInput): number {
  const s =
    SELL_WEIGHTS.popularity * clamp01(i.popularity) +
    SELL_WEIGHTS.rating * ratingScore(i.rating, i.review_count) +
    SELL_WEIGHTS.speed * speedScore(i.delivery_days) +
    SELL_WEIGHTS.price * priceScore(i.price_usd, i.reference_price_usd);
  return Math.round(s * 10000) / 10000;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Number of relevance buckets; within a bucket, sell score decides. */
export const RELEVANCE_BUCKETS = 5;
