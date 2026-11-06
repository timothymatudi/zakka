// Deterministic synthetic catalog for benchmarks and indexer tests. Generated
// lazily page by page, so 1M+ products never sit in memory at once.
import type { Locale, RawCategory, RawProduct, SearchOffer, SourceCode, SourceKind } from './types';

/** Small, fast, deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPS = ['electronics', 'home', 'fashion', 'beauty', 'sports', 'kids', 'auto', 'garden', 'office', 'pets'];
const NOUNS = [
  'earbuds', 'headphones', 'speaker', 'charger', 'cable', 'power bank', 'smartwatch', 'phone case', 'laptop stand', 'keyboard',
  'blender', 'kettle', 'air fryer', 'pan', 'lamp', 'curtain lights', 'storage basket', 'towel', 'pillow', 'rug',
  'dress', 't-shirt', 'jacket', 'sneakers', 'sandals', 'backpack', 'tote bag', 'wallet', 'sunglasses', 'watch',
  'serum', 'moisturizer', 'lipstick', 'hair dryer', 'shampoo', 'perfume', 'nail kit', 'face mask', 'brush set', 'lotion',
  'yoga mat', 'dumbbells', 'resistance bands', 'water bottle', 'tent', 'lantern', 'bike light', 'jump rope', 'gloves', 'cap',
];
const ADJ = ['wireless', 'portable', 'waterproof', 'premium', 'compact', 'rechargeable', 'organic', 'smart', 'mini', 'heavy-duty', 'foldable', 'quick-dry'];
const BRANDS = ['Oraimo', 'Anker', 'Xiaomi', 'Generic', 'Soundloop', 'Kivu', 'Nairo', 'Lumo', 'Sahara', 'Baobab', 'Tecno', 'Zuri'];
const SW: Record<string, string> = { earbuds: 'vipokea sauti', speaker: 'spika', charger: 'chaja', dress: 'nguo', sneakers: 'raba', backpack: 'begi', blender: 'blenda', kettle: 'birika', lamp: 'taa', 'water bottle': 'chupa ya maji' };
const SOURCES: { code: SourceCode; kind: SourceKind; from: string }[] = [
  { code: 'cj', kind: 'dropship', from: 'CN' },
  { code: 'aliexpress_ds', kind: 'dropship', from: 'CN' },
  { code: 'spocket', kind: 'dropship', from: 'US' },
  { code: 'printful', kind: 'dropship', from: 'DE' },
  { code: 'jumia', kind: 'affiliate', from: 'KE' },
  { code: 'amazon', kind: 'affiliate', from: 'US' },
  { code: 'noon', kind: 'affiliate', from: 'AE' },
];
const REGIONS: string[][] = [
  ['KE', 'TZ', 'UG', 'RW', 'NG', 'GH', 'ZA', 'EG', 'MA', 'AE', 'SA', 'QA', 'KW', 'OM', 'BH', 'IN', 'PK', 'ID', 'US', 'CA', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'BR', 'MX', 'AU', 'SN', 'CI', 'ET', 'JP', 'TR'],
  ['US', 'CA'],
  ['DE', 'FR', 'ES', 'IT', 'NL', 'PT', 'GB'],
  ['KE'],
  ['NG'],
  ['AE', 'SA'],
];

export const SYNTHETIC_CATEGORIES: RawCategory[] = TOPS.flatMap((top, i) => [
  { id: `cat-${i}`, slug: top, parent_id: null, names: { en: top[0].toUpperCase() + top.slice(1) } },
  ...Array.from({ length: 5 }, (_, j) => ({ id: `cat-${i}-${j}`, slug: `${top}-${j}`, parent_id: `cat-${i}`, names: { en: `${top} ${j}` } })),
]);

const hex = (n: number) => n.toString(16).padStart(12, '0');
export const syntheticId = (n: number) => `00000000-0000-4000-9000-${hex(n)}`;

export function syntheticProduct(n: number): RawProduct {
  const r = rng(n * 2654435761);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const noun = NOUNS[n % NOUNS.length];
  const ti = Math.floor((n % NOUNS.length) / 10); // nouns are grouped 10 per top category (first 5 tops)
  const top = TOPS[ti % TOPS.length];
  const cats = [SYNTHETIC_CATEGORIES[ti * 6], SYNTHETIC_CATEGORIES[ti * 6 + 1 + Math.floor(r() * 5)]];
  const brand = pick(BRANDS);
  const title = `${brand} ${pick(ADJ)} ${noun} ${pick(['pro', 'lite', 'max', 'plus', 'x', 'v2', ''])}`.trim();
  const translations: RawProduct['translations'] = {
    en: { title, description: `${title} for everyday use. Model ${n}. Category ${top}.`, bullet_points: [`${pick(ADJ)} design`, `${1 + (n % 24)} month warranty`] },
  };
  if (r() < 0.3 && SW[noun]) translations.sw = { title: `${brand} ${SW[noun]} ${n % 100}`, description: `${SW[noun]} bora`, bullet_points: [] };
  if (r() < 0.15) translations.es = { title: `${title} (ES)`, description: 'Producto de alta calidad', bullet_points: [] };
  if (r() < 0.05) translations.zh = { title: `${brand} 产品 ${n % 1000}`, description: '高品质', bullet_points: [] };
  const base = 3 + r() * 120;
  const nOffers = 1 + Math.floor(r() * 3);
  const offers: SearchOffer[] = Array.from({ length: nOffers }, (_, i) => {
    const s = SOURCES[(n + i * 3) % SOURCES.length];
    const region = s.code === 'jumia' ? REGIONS[3 + (n % 2)] : s.code === 'noon' ? REGIONS[5] : s.code === 'spocket' ? REGIONS[1] : s.code === 'printful' ? REGIONS[2] : REGIONS[0];
    const dmin = s.from === 'CN' ? 7 + Math.floor(r() * 5) : 1 + Math.floor(r() * 3);
    return {
      offer_id: `${syntheticId(n)}-${i}`,
      source_code: s.code,
      kind: s.kind,
      display_price_usd: Math.round(base * (0.85 + r() * 0.3) * 100) / 100,
      delivery_days_min: dmin,
      delivery_days_max: dmin + 2 + Math.floor(r() * 8),
      ships_from: s.from,
      ships_to: region,
      url: s.kind === 'affiliate' ? `https://example.com/aff/${s.code}/${n}` : null,
    };
  });
  return {
    id: syntheticId(n),
    translations,
    brand,
    gtin: String(2000000000000 + n),
    categories: cats,
    image: null,
    rating: r() < 0.1 ? null : Math.round((3 + r() * 2) * 10) / 10,
    review_count: Math.floor(r() ** 3 * 20000),
    popularity: Math.round(r() ** 2 * 1000) / 1000,
    offers,
  };
}

/** Pages of synthetic products [0, total). */
export async function* syntheticPages(total: number, pageSize = 2000): AsyncGenerator<RawProduct[]> {
  for (let start = 0; start < total; start += pageSize) {
    const end = Math.min(total, start + pageSize);
    const page: RawProduct[] = [];
    for (let n = start; n < end; n++) page.push(syntheticProduct(n));
    yield page;
  }
}

/** A mixed query workload: free text, filters, sorts, active and non-active countries, several locales. */
export function syntheticQueries(count: number, seed = 42) {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const countries = ['KE', 'NG', 'US', 'AE', 'IN', 'DE', 'GB', 'ZA', 'SN', 'JP'];
  const locales: Locale[] = ['en', 'en', 'en', 'sw', 'es', 'fr', 'ar', 'zh'];
  return Array.from({ length: count }, () => {
    const kind = r();
    return {
      q: kind < 0.15 ? '*' : `${r() < 0.4 ? pick(ADJ) + ' ' : ''}${pick(NOUNS)}`,
      locale: pick(locales),
      country: pick(countries),
      category: r() < 0.15 ? pick(TOPS) : undefined,
      max_price: r() < 0.25 ? Math.round(10 + r() * 90) : undefined,
      max_days: r() < 0.1 ? 5 : undefined,
      min_rating: r() < 0.1 ? 4 : undefined,
      sort: pick(['relevance', 'relevance', 'relevance', 'price_asc', 'fastest', 'rating'] as const),
      page: r() < 0.1 ? 2 : 1,
      per_page: 20,
    };
  });
}
