import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { CATEGORIES, PRODUCTS } from './mock/catalog';
import { marketFor } from './markets';
import { usdToLocal } from './money';
import { absUrl, customerBrand, deliverySplit, scrubPartnerNames, xmlEscape } from './seo';

const g = (tag: string, value: string | number) => `<g:${tag}>${xmlEscape(String(value))}</g:${tag}>`;

/**
 * Offline merchant feed (Google RSS 2.0 format) from the web mock catalog. Same rules as the
 * catalog's generator: dropship offers only (Zakka is the seller), shipping to the country,
 * prices in local currency with shipping included, no supplier or partner names.
 * Production feeds come from the catalog service (GET {CATALOG_API_URL}/feeds/{country}/{locale}.xml).
 */
export async function buildMockFeed(country: string, locale: Locale): Promise<string> {
  const tc = await getTranslations({ locale, namespace: 'categories' });
  const market = marketFor(country);
  const items: string[] = [];
  for (const p of PRODUCTS) {
    const cat = CATEGORIES.find((c) => c.slug === p.category_slug);
    for (const o of p.offers) {
      if (o.kind !== 'dropship' || !o.ships_to.includes(country)) continue;
      const price = usdToLocal(o.display_price_usd, market).toFixed(market.decimals);
      const split = deliverySplit(o.delivery_days_min, o.delivery_days_max);
      const shipping =
        g('country', country) +
        g('price', `${(0).toFixed(market.decimals)} ${market.currency}`) +
        (split
          ? g('min_handling_time', split.handling) +
            g('max_handling_time', split.handling) +
            g('min_transit_time', split.transitMin) +
            g('max_transit_time', split.transitMax)
          : '');
      items.push(
        '<item>' +
          g('id', o.offer_id) +
          g('title', scrubPartnerNames(p.title).slice(0, 150)) +
          g('description', scrubPartnerNames(p.description || p.title).slice(0, 5000)) +
          g('link', absUrl(`/${locale}/p/${p.id}?country=${country}`)) +
          g('image_link', absUrl(`/img/${p.id}/0`)) +
          g('availability', 'in_stock') +
          g('price', `${price} ${market.currency}`) +
          g('brand', customerBrand(p.brand) ?? 'Zakka') +
          g('identifier_exists', 'no') +
          g('condition', 'new') +
          (cat ? g('product_type', tc(cat.slug)) : '') +
          `<g:shipping>${shipping}</g:shipping>` +
          '</item>',
      );
    }
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n' +
    `<title>${xmlEscape(`Zakka ${country} (${locale})`)}</title>\n` +
    `<link>${xmlEscape(absUrl(`/${locale}`))}</link>\n` +
    `<description>${xmlEscape(`Zakka products delivered to ${country} (offline sample feed)`)}</description>\n` +
    items.join('\n') +
    '\n</channel>\n</rss>\n'
  );
}
