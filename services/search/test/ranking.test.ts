import { describe, expect, it } from 'vitest';
import { median, priceScore, ratingScore, sellScore, speedScore, SELL_WEIGHTS } from '../src/ranking';

const base = { popularity: 0.5, rating: 4.2, review_count: 200, delivery_days: 7, price_usd: 20, reference_price_usd: 20 };

describe('sell score components', () => {
  it('weights sum to 1 so the score stays in 0..1', () => {
    expect(Object.values(SELL_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const best = sellScore({ popularity: 1, rating: 5, review_count: 1e6, delivery_days: 1, price_usd: 1, reference_price_usd: 100 });
    const worst = sellScore({ popularity: 0, rating: 1, review_count: 1e6, delivery_days: 60, price_usd: 1000, reference_price_usd: 1 });
    expect(best).toBeLessThanOrEqual(1);
    expect(best).toBeGreaterThan(0.95);
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(worst).toBeLessThan(0.1);
  });

  it('smooths ratings: 5.0 from 2 reviews ranks below 4.7 from 2,000', () => {
    expect(ratingScore(5, 2)).toBeLessThan(ratingScore(4.7, 2000));
    expect(ratingScore(null, 0)).toBeCloseTo(ratingScore(3.8, 0));
  });

  it('rewards faster delivery, monotonically', () => {
    expect(speedScore(1)).toBe(1);
    expect(speedScore(7)).toBeCloseTo(0.5);
    expect(speedScore(3)).toBeGreaterThan(speedScore(10));
    expect(speedScore(null)).toBeLessThan(speedScore(30));
  });

  it('prefers cheaper than the reference price', () => {
    expect(priceScore(20, 20)).toBeCloseTo(0.5);
    expect(priceScore(10, 20)).toBeCloseTo(0.75);
    expect(priceScore(40, 20)).toBeCloseTo(0.25);
    expect(priceScore(5, 0)).toBe(0.5);
  });

  it('each signal moves the score in the expected direction', () => {
    const s = sellScore(base);
    expect(sellScore({ ...base, popularity: 0.9 })).toBeGreaterThan(s);
    expect(sellScore({ ...base, rating: 4.9 })).toBeGreaterThan(s);
    expect(sellScore({ ...base, delivery_days: 2 })).toBeGreaterThan(s);
    expect(sellScore({ ...base, price_usd: 12 })).toBeGreaterThan(s);
    expect(sellScore({ ...base, price_usd: 45 })).toBeLessThan(s);
  });

  it('local 2-day delivery can beat a slightly cheaper 15-day import', () => {
    const local = sellScore({ ...base, delivery_days: 2, price_usd: 22 });
    const imported = sellScore({ ...base, delivery_days: 15, price_usd: 18 });
    expect(local).toBeGreaterThan(imported);
  });

  it('median', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
