import type { Market } from './markets';

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
