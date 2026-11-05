import type { Market } from './markets';

/** Cart line unit price: the stored catalog local price if still in the same currency, else converted. */
export function cartUnit(item: { priceUsd: number; priceLocal?: number | null; currency?: string }, market: Market): number {
  return item.priceLocal != null && item.currency === market.currency ? item.priceLocal : usdToLocal(item.priceUsd, market);
}

/** Convert a catalog-computed USD price for display. Rounds up (never shows a lower price than charged). */
export function usdToLocal(usd: number, market: Market): number {
  const f = 10 ** market.decimals;
  return Math.ceil(usd * market.rate * f - 1e-9) / f;
}

export function formatMoney(amount: number, currency: string, locale: string, decimals?: number): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(decimals ?? 2)}`;
  }
}

export function formatUsdAsLocal(usd: number, market: Market, locale: string): string {
  return formatMoney(usdToLocal(usd, market), market.currency, locale, market.decimals);
}

/**
 * Local price for an offer: the search API's display_price_local when it is in the market's currency,
 * otherwise (offline/mock) the USD price converted with the fallback FX table.
 */
export function offerLocal(
  offer: { display_price_usd: number; display_price_local?: number; currency?: string },
  market: Market,
): number {
  if (offer.display_price_local != null && offer.currency === market.currency) return offer.display_price_local;
  return usdToLocal(offer.display_price_usd, market);
}

export function formatOfferPrice(
  offer: { display_price_usd: number; display_price_local?: number; currency?: string },
  market: Market,
  locale: string,
): string {
  return formatMoney(offerLocal(offer, market), market.currency, locale, market.decimals);
}
