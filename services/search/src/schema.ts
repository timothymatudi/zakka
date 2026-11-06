// Typesense schema: ONE `products` collection for all locales (no 10x duplication).
import { LOCALES, type Locale } from './types';

export const COLLECTION = 'products';

/**
 * Per-locale text field settings. Base text (`title`, `description`, `bullets`)
 * is English when available and uses the default tokenizer with stemming.
 * `title_<loc>` / `description_<loc>` exist only on documents that have that
 * translation:
 *  - es, fr, pt, de: `locale` (ICU tokenization) plus stemming; diacritics fold.
 *  - sw, id: Latin script with spaces, default tokenizer, no stemming.
 *  - zh: no spaces between words; locale "zh" segments with ICU word-break.
 *  - ar: locale "ar" for Arabic-script tokenization.
 *  - hi: locale "hi" for Devanagari word-break (vowel signs preserved).
 */
export const LOCALE_SETTINGS: Record<Locale, { tsLocale: string; stem: boolean }> = {
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
}

function textField(name: string, locale: Locale, optional: boolean): TsField {
  const { tsLocale, stem } = LOCALE_SETTINGS[locale];
  return { name, type: 'string', ...(optional ? { optional: true } : {}), ...(tsLocale ? { locale: tsLocale } : {}), ...(stem ? { stem: true } : {}) };
}

export function collectionSchema(name = COLLECTION): TsCollectionSchema {
  const perLocale = LOCALES.filter((l) => l !== 'en').flatMap((l) => [
    textField(`title_${l}`, l, true),
    textField(`description_${l}`, l, true),
  ]);
  return {
    name,
    enable_nested_fields: true,
    token_separators: ['-', '/'],
    fields: [
      textField('title', 'en', false),
      textField('description', 'en', true),
      textField('bullets', 'en', true),
      ...perLocale,
      { name: 'base_locale', type: 'string', index: false, optional: true },
      { name: 'brand', type: 'string', optional: true, facet: true },
      { name: 'gtin', type: 'string', optional: true },
      { name: 'category_ids', type: 'string[]' },
      { name: 'category_slugs', type: 'string[]', facet: true },
      // Every locale's category names once, for matching ("simu" -> Phones).
      { name: 'category_terms', type: 'string[]' },
      { name: 'image', type: 'string', optional: true, index: false },
      { name: 'rating', type: 'float', optional: true },
      { name: 'rating_sort', type: 'float' },
      { name: 'rating_bucket', type: 'string', facet: true },
      { name: 'review_count', type: 'int32' },
      // Stored for responses only; never indexed.
      { name: 'offers', type: 'object[]', index: false, optional: true },
      { name: 'local_prices', type: 'object[]', index: false, optional: true },
      { name: 'min_price_usd', type: 'float', facet: true },
      { name: 'ships_to', type: 'string[]', facet: true },
      { name: 'fastest_days', type: 'int32', optional: true },
      { name: 'best_dmax', type: 'int32' },
      { name: 'popularity', type: 'float' },
      { name: 'source_kinds', type: 'string[]', facet: true },
      { name: 'source_codes', type: 'string[]', facet: true },
      { name: 'offer_ships_from', type: 'string[]', facet: true },
      { name: 'cat_ref_price', type: 'float', index: false, optional: true },
      { name: 'sell_global', type: 'float' },
      // Active countries only (see IndexedDocument). cprice is facetable for range facets.
      { name: 'cprice_.*', type: 'float', optional: true, facet: true },
      { name: 'cdmax_.*', type: 'int32', optional: true },
      { name: 'csell_.*', type: 'float', optional: true },
    ],
    default_sorting_field: 'popularity',
  };
}
