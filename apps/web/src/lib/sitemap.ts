import 'server-only';
import { LOCALES, type Locale } from '@shared/types';
import { PRODUCTS } from './mock/catalog';
import { getCategories } from './categories';
import { LOCALE_DEFAULT_COUNTRY } from './markets';
import { search } from './search';
import { absUrl, xmlEscape } from './seo';

/** Google's limit is 50,000 URLs per sitemap file; stay below it. */
const MAX_PRODUCTS = 45_000;
const PAGE = 100;

/** Locale-independent paths ("" = home) for one locale's sitemap. */
export async function sitemapPaths(locale: Locale): Promise<string[]> {
  const paths = [''];
  for (const c of await getCategories()) paths.push(`/c/${c.slug}`, `/best/${c.slug}`);
  for (const id of await productIds(locale)) paths.push(`/p/${encodeURIComponent(id)}`);
  return paths;
}

/** Products that ship to the locale's default market (search API, or the mock catalog offline). */
async function productIds(locale: Locale): Promise<string[]> {
  const ids = new Set<string>();
  const country = LOCALE_DEFAULT_COUNTRY[locale] ?? 'US';
  for (let page = 1; ids.size < MAX_PRODUCTS; page++) {
    const res = await search({ q: '', locale, country, per_page: PAGE, page });
    if (res.source === 'mock') {
      // Offline: list the whole mock catalog (every product page renders, even if it ships elsewhere).
      return PRODUCTS.map((p) => p.id);
    }
    for (const h of res.hits) ids.add(h.id);
    if (res.hits.length < PAGE || page * PAGE >= res.found) break;
  }
  return [...ids];
}

/** <urlset> with hreflang alternates for all locales (and x-default = English). */
export function urlsetXml(locale: Locale, paths: string[]): string {
  const rows = paths.map((path) => {
    const alts = LOCALES.map(
      (l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(absUrl(`/${l}${path}`))}"/>`,
    ).join('');
    const xDefault = `<xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(absUrl(`/en${path}`))}"/>`;
    return `<url><loc>${xmlEscape(absUrl(`/${locale}${path}`))}</loc>${alts}${xDefault}</url>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    rows.join('\n') +
    '\n</urlset>\n'
  );
}

export function sitemapIndexXml(): string {
  const rows = LOCALES.map((l) => `<sitemap><loc>${xmlEscape(absUrl(`/sitemaps/${l}.xml`))}</loc></sitemap>`);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.join('\n') +
    '\n</sitemapindex>\n'
  );
}
