import type { SearchDocument } from '../shared';

/** Built-in search fixtures (contract SearchDocument shape) used offline / when search is down in dev. */
const ALL = ['US', 'GB', 'DE', 'FR', 'ES', 'AE', 'SA', 'EG', 'IN', 'KE', 'NG', 'GH', 'ZA', 'TZ', 'UG', 'BR', 'MX', 'ID', 'CN', 'CA', 'AU'];

export const FIXTURE_DOCS: SearchDocument[] = [
  {
    id: '0b4a8c1e-1111-4a6f-9a10-000000000001',
    title: 'Wireless Earbuds Pro with Charging Case', description: 'Bluetooth 5.3 earbuds, 30h battery, noise reduction, IPX5.',
    brand: 'Soundora', category_path: ['Electronics', 'Audio', 'Headphones'], category_ids: ['cat-audio'],
    image: 'https://images.zakka.example/earbuds-pro.jpg', rating: 4.5, review_count: 1820,
    offers: [{ offer_id: '7c9e6679-7425-40de-944b-e07fc1f90001', source_code: 'cj', kind: 'dropship', display_price_usd: 23.99,
      delivery_days_min: 6, delivery_days_max: 11, ships_from: 'CN', ships_to: ALL, url: null }],
    min_price_usd: 23.99, ships_to: ALL, fastest_days: 6, popularity: 0.82,
  },
  {
    id: '0b4a8c1e-1111-4a6f-9a10-000000000002',
    title: 'Budget Sport Earbuds, Ear Hooks', description: 'Lightweight sweat-proof wireless earbuds with ear hooks, 12h battery.',
    brand: 'Kivu', category_path: ['Electronics', 'Audio', 'Headphones'], category_ids: ['cat-audio'],
    image: 'https://images.zakka.example/sport-earbuds.jpg', rating: 4.1, review_count: 640,
    offers: [{ offer_id: '7c9e6679-7425-40de-944b-e07fc1f90002', source_code: 'jumia', kind: 'affiliate', display_price_usd: 14.5,
      delivery_days_min: 2, delivery_days_max: 4, ships_from: 'KE', ships_to: ['KE', 'NG', 'GH', 'EG', 'UG', 'TZ'],
      url: 'https://www.jumia.co.ke/budget-sport-earbuds-mock.html' }],
    min_price_usd: 14.5, ships_to: ['KE', 'NG', 'GH', 'EG', 'UG', 'TZ'], fastest_days: 2, popularity: 0.64,
  },
  {
    id: '0b4a8c1e-1111-4a6f-9a10-000000000003',
    title: 'Mini Earbuds, Touch Control', description: 'Compact true wireless earbuds with touch control and USB-C case.',
    brand: null, category_path: ['Electronics', 'Audio', 'Headphones'], category_ids: ['cat-audio'],
    image: 'https://images.zakka.example/mini-earbuds.jpg', rating: 4.0, review_count: 312,
    offers: [{ offer_id: '7c9e6679-7425-40de-944b-e07fc1f90003', source_code: 'aliexpress_ds', kind: 'dropship', display_price_usd: 17.49,
      delivery_days_min: 9, delivery_days_max: 15, ships_from: 'CN', ships_to: ALL, url: null }],
    min_price_usd: 17.49, ships_to: ALL, fastest_days: 9, popularity: 0.51,
  },
  {
    id: '0b4a8c1e-1111-4a6f-9a10-000000000004',
    title: 'Over-Ear Noise Cancelling Headphones', description: 'Active noise cancelling headphones, 40h battery, foldable.',
    brand: 'Soundora', category_path: ['Electronics', 'Audio', 'Headphones'], category_ids: ['cat-audio'],
    image: 'https://images.zakka.example/anc-headphones.jpg', rating: 4.6, review_count: 2210,
    offers: [{ offer_id: '7c9e6679-7425-40de-944b-e07fc1f90004', source_code: 'amazon', kind: 'affiliate', display_price_usd: 59.99,
      delivery_days_min: 3, delivery_days_max: 6, ships_from: 'US', ships_to: ['US', 'CA', 'AE', 'SA', 'IN', 'GB', 'DE'],
      url: 'https://www.amazon.com/dp/B0MOCK0001?tag=zakka-20' }],
    min_price_usd: 59.99, ships_to: ['US', 'CA', 'AE', 'SA', 'IN', 'GB', 'DE'], fastest_days: 3, popularity: 0.77,
  },
  {
    id: '0b4a8c1e-1111-4a6f-9a10-000000000005',
    title: 'Smartwatch with Heart Rate Monitor', description: 'Fitness smartwatch, AMOLED screen, 7-day battery, water resistant.',
    brand: 'Pulso', category_path: ['Electronics', 'Wearables'], category_ids: ['cat-wearables'],
    image: 'https://images.zakka.example/smartwatch.jpg', rating: 4.3, review_count: 980,
    offers: [{ offer_id: '7c9e6679-7425-40de-944b-e07fc1f90005', source_code: 'cj', kind: 'dropship', display_price_usd: 34.99,
      delivery_days_min: 7, delivery_days_max: 12, ships_from: 'CN', ships_to: ALL, url: null }],
    min_price_usd: 34.99, ships_to: ALL, fastest_days: 7, popularity: 0.7,
  },
  {
    id: '0b4a8c1e-1111-4a6f-9a10-000000000006',
    title: 'Shockproof Phone Case', description: 'Clear shockproof case with raised edges for popular phone models.',
    brand: null, category_path: ['Electronics', 'Phone Accessories'], category_ids: ['cat-phone-acc'],
    image: 'https://images.zakka.example/phone-case.jpg', rating: 4.4, review_count: 4410,
    offers: [{ offer_id: '7c9e6679-7425-40de-944b-e07fc1f90006', source_code: 'temu', kind: 'affiliate', display_price_usd: 6.99,
      delivery_days_min: 7, delivery_days_max: 14, ships_from: 'CN', ships_to: ALL, url: 'https://www.temu.com/mock-phone-case.html' }],
    min_price_usd: 6.99, ships_to: ALL, fastest_days: 7, popularity: 0.9,
  },
];

/** Multilingual synonyms so fixture search works for non-English demo queries. */
const SYNONYMS: Record<string, string> = {
  auriculares: 'earbuds', écouteurs: 'earbuds', ecouteurs: 'earbuds', fones: 'earbuds', kopfhörer: 'headphones',
  'سماعات': 'earbuds', '耳机': 'earbuds', 'ईयरबड्स': 'earbuds', vipokea: 'earbuds', earphones: 'earbuds',
  headphone: 'headphones', earbud: 'earbuds', watch: 'smartwatch', saa: 'smartwatch', reloj: 'smartwatch',
  case: 'case', funda: 'case', coque: 'case', capa: 'case', hülle: 'case', simu: 'phone',
};

export function fixtureSearch(q: string, country: string, perPage = 3): SearchDocument[] {
  const tokens = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1).map((w) => SYNONYMS[w] ?? w);
  const cheap = /cheap|barat|pas cher|billig|günstig|murah|rahisi|便宜|سستا|رخيص|सस्त/i.test(q);
  const scored = FIXTURE_DOCS
    .filter((d) => d.ships_to.includes(country))
    .map((d) => {
      const hay = `${d.title} ${d.description} ${d.category_path.join(' ')}`.toLowerCase();
      return { d, score: tokens.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (cheap ? a.d.min_price_usd - b.d.min_price_usd : b.d.popularity - a.d.popularity));
  return scored.slice(0, perPage).map((x) => x.d);
}
