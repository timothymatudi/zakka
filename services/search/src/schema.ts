// Typesense collection schema: one collection per locale, `products_<locale>`.
import type { Locale } from './types';

export const collectionName = (locale: Locale) => `products_${locale}`;

/**
 * Per-locale tokenization notes:
 *  - en: default tokenizer (whitespace + punctuation), stemming on.
 *  - es, fr, pt, de: `locale` enables language-aware ICU tokenization plus
 *    stemming; diacritic folding stays on, so "écouteurs" matches "ecouteurs".
 *  - sw, id: Latin script with spaces and little inflection that matters for
 *    product search, so the default tokenizer (no locale, no stemming) is used.
 *  - zh: Chinese has no spaces; locale "zh" makes Typesense segment with ICU
 *    word-break (dictionary based). Queries are segmented the same way.
 *  - ar: locale "ar" enables ICU tokenization for Arabic script. (The memory
 *    engine additionally folds alef variants and strips harakat; see text.ts.)
 *  - hi: locale "hi" for Devanagari ICU word-break; vowel signs are preserved.
 * Stemming is only enabled where Typesense's stemmer is well supported (en, es, fr, pt, de).
 */
const LOCALE_SETTINGS: Record<Locale, { tsLocale: string; stem: boolean }> = {
  en: { tsLocale: '', stem: true },
  es: { tsLocale: 'es', stem: true },
  fr: { tsLocale: 'fr', stem: true },
  pt: { tsLocale: 'pt', stem: true },
  de: { tsLocale: 'de', stem: true },
  id: { tsLocale: '', stem: false },
  sw: { tsLocale: '', stem: false },
  ar: { tsLocale: 'ar', stem: false },
  hi: { tsLocale: 'hi', stem: false },
  zh: { tsLocale: 'zh', stem: false },
};

export interface TsField {
  name: string;
  type: string;
  facet?: boolean;
  optional?: boolean;
  index?: boolean;
  sort?: boolean;
  locale?: string;
  stem?: boolean;
}

export interface TsCollectionSchema {
  name: string;
  fields: TsField[];
  default_sorting_field?: string;
  enable_nested_fields?: boolean;
  token_separators?: string[];
  symbols_to_index?: string[];
}

export function collectionSchema(locale: Locale): TsCollectionSchema {
  const { tsLocale, stem } = LOCALE_SETTINGS[locale];
  const text = (name: string, extra: Partial<TsField> = {}): TsField => ({
    name,
    type: 'string',
    ...(tsLocale ? { locale: tsLocale } : {}),
    ...(stem ? { stem: true } : {}),
    ...extra,
  });
  return {
    name: collectionName(locale),
    enable_nested_fields: true,
    token_separators: ['-', '/'],
    fields: [
      text('title'),
      text('description', { optional: true }),
      text('bullets', { optional: true }),
      { name: 'brand', type: 'string', optional: true, facet: true },
      { name: 'category_path', type: 'string[]', facet: true, ...(tsLocale ? { locale: tsLocale } : {}) },
      { name: 'category_ids', type: 'string[]', facet: true },
      { name: 'category_slugs', type: 'string[]', facet: true },
      // "slug|Localized name" pairs so the category facet can carry slugs and labels.
      { name: 'category_keys', type: 'string[]', facet: true },
      { name: 'image', type: 'string', optional: true, index: false },
      { name: 'rating', type: 'float', optional: true },
      { name: 'rating_sort', type: 'float' },
      { name: 'rating_bucket', type: 'string', facet: true },
      { name: 'review_count', type: 'int32' },
      // Stored for the response only; filtering/sorting use the flat fields below.
      { name: 'offers', type: 'object[]', index: false, optional: true },
      { name: 'min_price_usd', type: 'float' },
      { name: 'ships_to', type: 'string[]', facet: true },
      { name: 'fastest_days', type: 'int32', optional: true },
      { name: 'popularity', type: 'float' },
      { name: 'source_kinds', type: 'string[]', facet: true },
      { name: 'source_codes', type: 'string[]', facet: true },
      { name: 'offer_ships_from', type: 'string[]', facet: true },
      // Per-country fields (CC = ISO code), see IndexedDocument in types.ts.
      { name: 'cprice_.*', type: 'float', optional: true, sort: true },
      { name: 'cdays_.*', type: 'int32', optional: true, sort: true },
      { name: 'cdmax_.*', type: 'int32', optional: true, sort: true },
      { name: 'csell_.*', type: 'float', optional: true, sort: true },
      { name: 'cpbucket_.*', type: 'string', optional: true, facet: true },
    ],
    default_sorting_field: 'popularity',
  };
}
