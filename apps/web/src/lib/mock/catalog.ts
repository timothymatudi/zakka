import type { SearchDocument, SearchOffer, SourceCode, SourceKind } from '@shared/types';

/**
 * Offline mock catalog. Shapes follow the contract's search document.
 * display_price_usd values stand in for the catalog's computed prices
 * (markup already applied for dropship offers); the web app never computes markup.
 * Product names and brands are invented sample data.
 */

export interface MockCategory {
  id: string;
  slug: string;
  icon: string;
  sort: number;
}

export const CATEGORIES: MockCategory[] = [
  { id: 'c0000000-0000-4000-8000-000000000001', slug: 'electronics', icon: '🎧', sort: 1 },
  { id: 'c0000000-0000-4000-8000-000000000002', slug: 'phones', icon: '📱', sort: 2 },
  { id: 'c0000000-0000-4000-8000-000000000003', slug: 'fashion', icon: '👕', sort: 3 },
  { id: 'c0000000-0000-4000-8000-000000000004', slug: 'beauty', icon: '🧴', sort: 4 },
  { id: 'c0000000-0000-4000-8000-000000000005', slug: 'home', icon: '🛋️', sort: 5 },
  { id: 'c0000000-0000-4000-8000-000000000006', slug: 'kitchen', icon: '🍳', sort: 6 },
  { id: 'c0000000-0000-4000-8000-000000000007', slug: 'sports', icon: '⚽', sort: 7 },
  { id: 'c0000000-0000-4000-8000-000000000008', slug: 'toys', icon: '🧸', sort: 8 },
  { id: 'c0000000-0000-4000-8000-000000000009', slug: 'health', icon: '🩺', sort: 9 },
  { id: 'c0000000-0000-4000-8000-000000000010', slug: 'pets', icon: '🐾', sort: 10 },
];

export interface MockSource {
  id: string;
  code: SourceCode;
  kind: SourceKind;
  name: string;
  is_active: boolean;
}

const SOURCE_LIST: [SourceCode, SourceKind, string][] = [
  ['cj', 'dropship', 'CJ Dropshipping'],
  ['aliexpress_ds', 'dropship', 'AliExpress Dropshipping'],
  ['spocket', 'dropship', 'Spocket'],
  ['printful', 'dropship', 'Printful'],
  ['amazon', 'affiliate', 'Amazon'],
  ['temu', 'affiliate', 'Temu'],
  ['shein', 'affiliate', 'Shein'],
  ['aliexpress_aff', 'affiliate', 'AliExpress'],
  ['jumia', 'affiliate', 'Jumia'],
  ['noon', 'affiliate', 'noon'],
  ['flipkart', 'affiliate', 'Flipkart'],
  ['ebay', 'affiliate', 'eBay'],
  ['awin', 'affiliate', 'Awin'],
  ['impact', 'affiliate', 'Impact'],
  ['rakuten', 'affiliate', 'Rakuten Advertising'],
  ['admitad', 'affiliate', 'Admitad'],
  ['mercadolibre', 'affiliate', 'Mercado Libre'],
  ['shopee', 'affiliate', 'Shopee'],
  ['lazada', 'affiliate', 'Lazada'],
  ['rakuten_ichiba', 'affiliate', 'Rakuten Ichiba'],
  ['coupang', 'affiliate', 'Coupang'],
];

export const SOURCES: MockSource[] = SOURCE_LIST.map(([code, kind, name], i) => ({
  id: `50000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  code,
  kind,
  name,
  is_active: true,
}));

export const SOURCE_NAME: Record<SourceCode, string> = Object.fromEntries(
  SOURCES.map((s) => [s.code, s.name]),
) as Record<SourceCode, string>;

export const SOURCE_KIND: Record<SourceCode, SourceKind> = Object.fromEntries(
  SOURCES.map((s) => [s.code, s.kind]),
) as Record<SourceCode, SourceKind>;

// Shipping regions (country codes from lib/markets.ts)
const ALL = ['US', 'GB', 'DE', 'FR', 'ES', 'MX', 'BR', 'AE', 'SA', 'EG', 'NG', 'GH', 'KE', 'TZ', 'ZA', 'IN', 'ID', 'CN'];
const NO_CN = ALL.filter((c) => c !== 'CN');
const EU_UK = ['GB', 'DE', 'FR', 'ES'];
const NA_EU = ['US', 'MX', ...EU_UK];
const GULF = ['AE', 'SA', 'EG'];
const AFRICA = ['NG', 'GH', 'KE', 'TZ', 'ZA', 'EG'];
const JUMIA = ['NG', 'GH', 'KE', 'EG'];

const REGIONS = { ALL, NO_CN, EU_UK, NA_EU, GULF, AFRICA, JUMIA, IN: ['IN'], US: ['US'] } as const;
type Region = keyof typeof REGIONS;

type OfferSpec = [SourceCode, number, number, number, string, Region];

export interface MockProduct extends SearchDocument {
  category_slug: string;
  icon: string;
  bullet_points: string[];
}

let offerSeq = 0;
function offers(productNo: number, specs: OfferSpec[]): SearchOffer[] {
  return specs.map(([source, price, dmin, dmax, from, region]) => {
    offerSeq += 1;
    const kind = SOURCE_KIND[source];
    const offer_id = `0f000000-0000-4000-8000-${String(offerSeq).padStart(12, '0')}`;
    return {
      offer_id,
      source_code: source,
      kind,
      display_price_usd: price,
      delivery_days_min: dmin,
      delivery_days_max: dmax,
      ships_from: from,
      ships_to: [...REGIONS[region]],
      // Mock partner URL (example.com is reserved for documentation). Never a scraped link.
      url: kind === 'affiliate' ? `https://partner.example.com/${source}/item/${productNo}` : null,
    };
  });
}

type ProductSpec = [
  slug: string,
  title: string,
  brand: string,
  icon: string,
  rating: number,
  reviews: number,
  popularity: number,
  description: string,
  bullets: string[],
  offerSpecs: OfferSpec[],
];

const SPECS: ProductSpec[] = [
  // Electronics
  ['electronics', 'Wireless earbuds with noise cancelling', 'Soundly', '🎧', 4.5, 2310, 0.95, 'Compact earbuds with active noise cancelling, 30-hour battery with case and USB-C charging.', ['Active noise cancelling', '30 h total battery', 'IPX4 splash resistant'], [['cj', 24.99, 6, 12, 'CN', 'ALL'], ['amazon', 29.5, 2, 4, 'US', 'US'], ['noon', 27.0, 1, 3, 'AE', 'GULF']]],
  ['electronics', 'Waterproof Bluetooth speaker', 'Soundly', '🔊', 4.4, 980, 0.7, 'Rugged pocket speaker with 12 hours of playtime and a strap for bikes and bags.', ['IP67 waterproof', '12 h playtime', 'Pairs two speakers'], [['aliexpress_ds', 19.99, 8, 15, 'CN', 'ALL'], ['jumia', 23.4, 2, 5, 'NG', 'JUMIA']]],
  ['electronics', '65W GaN USB-C fast charger', 'Volta', '🔌', 4.7, 1540, 0.8, 'Three-port charger that powers a laptop, phone and earbuds at the same time.', ['2× USB-C, 1× USB-A', 'Foldable plug', 'Over-heat protection'], [['cj', 21.49, 5, 10, 'CN', 'ALL'], ['spocket', 26.99, 3, 6, 'US', 'NA_EU']]],
  ['electronics', 'Fitness smartwatch with heart-rate', 'Pulsa', '⌚', 4.2, 3105, 0.9, 'Lightweight watch that tracks steps, sleep and heart rate, with 10-day battery.', ['1.8" bright screen', 'Sleep + SpO2 tracking', '10-day battery'], [['aliexpress_ds', 32.99, 7, 14, 'CN', 'ALL'], ['flipkart', 28.0, 2, 4, 'IN', 'IN'], ['temu', 26.5, 6, 11, 'CN', 'NA_EU']]],
  // Phones
  ['phones', 'Magnetic clear phone case', 'Kivu', '📱', 4.3, 760, 0.6, 'Slim, yellowing-resistant case with a magnetic ring for wireless chargers.', ['Raised camera lip', 'Magnetic ring', 'Drop tested 2 m'], [['cj', 8.99, 6, 12, 'CN', 'ALL'], ['shein', 7.5, 7, 12, 'CN', 'NO_CN']]],
  ['phones', '10,000 mAh slim power bank', 'Volta', '🔋', 4.6, 2044, 0.85, 'Pocket-sized battery with 20W USB-C fast charging and a battery display.', ['20W PD fast charging', 'Digital battery %', 'Airline safe'], [['cj', 17.99, 5, 11, 'CN', 'ALL'], ['jumia', 19.9, 1, 4, 'KE', 'JUMIA'], ['amazon', 22.0, 2, 4, 'US', 'US']]],
  ['phones', 'Phone tripod with Bluetooth remote', 'Lumo', '📸', 4.4, 512, 0.5, 'Extendable selfie stick and tripod in one, with a detachable remote shutter.', ['Extends to 1.1 m', 'Removable remote', '360° rotating clamp'], [['aliexpress_ds', 12.49, 8, 15, 'CN', 'ALL']]],
  ['phones', 'Braided USB-C cable, 2-pack', 'Volta', '🧵', 4.5, 1890, 0.55, 'Two 2-metre nylon-braided cables rated for 60W charging.', ['2 m length', '60W rated', '10,000+ bend test'], [['cj', 7.99, 5, 10, 'CN', 'ALL'], ['temu', 5.99, 6, 12, 'CN', 'NA_EU'], ['noon', 8.5, 1, 2, 'AE', 'GULF']]],
  // Fashion
  ['fashion', 'Breathable linen button shirt', 'Mawa', '👔', 4.1, 340, 0.45, 'Relaxed-fit linen-blend shirt for hot days. Sizes S–3XL.', ['Linen-cotton blend', 'Relaxed fit', 'Machine washable'], [['spocket', 29.99, 4, 8, 'GB', 'NA_EU'], ['shein', 16.0, 7, 12, 'CN', 'NO_CN']]],
  ['fashion', 'Wax-print canvas tote bag', 'Ankara Studio', '👜', 4.8, 220, 0.4, 'Printed-on-demand tote with an original wax-print pattern and inner pocket.', ['Heavy cotton canvas', 'Inner zip pocket', 'Printed to order'], [['printful', 22.99, 5, 9, 'US', 'ALL']]],
  ['fashion', 'Lightweight running sneakers', 'Stride', '👟', 4.3, 1250, 0.75, 'Mesh running shoes with a cushioned sole, under 250 g per shoe.', ['Breathable mesh', 'Cushioned sole', 'Sizes EU 36–46'], [['aliexpress_ds', 34.99, 8, 16, 'CN', 'ALL'], ['jumia', 31.0, 2, 5, 'NG', 'JUMIA'], ['flipkart', 27.0, 2, 5, 'IN', 'IN']]],
  ['fashion', 'Polarized sunglasses', 'Sahara', '🕶️', 4.2, 870, 0.5, 'UV400 polarized lenses in a light, flexible frame with a hard case.', ['UV400 protection', 'Polarized lenses', 'Hard case included'], [['cj', 11.99, 6, 12, 'CN', 'ALL'], ['noon', 14.0, 1, 3, 'AE', 'GULF']]],
  // Beauty
  ['beauty', 'Vitamin C brightening serum 30 ml', 'Nuru', '💧', 4.4, 1430, 0.7, 'Lightweight daily serum with 15% vitamin C and hyaluronic acid.', ['15% vitamin C', 'Fragrance free', 'Dermatologist tested'], [['spocket', 18.99, 4, 8, 'US', 'NA_EU'], ['amazon', 21.0, 2, 3, 'US', 'US'], ['jumia', 16.5, 2, 5, 'KE', 'JUMIA']]],
  ['beauty', 'Raw shea butter body cream', 'Baraka', '🧴', 4.7, 615, 0.6, 'Rich body cream made with unrefined shea butter sourced in West Africa.', ['Unrefined shea', 'No added parabens', '250 ml jar'], [['spocket', 14.99, 3, 7, 'GH', 'ALL'], ['jumia', 9.9, 1, 3, 'GH', 'JUMIA']]],
  ['beauty', 'Ionic hair dryer 1800W', 'Lumo', '💨', 4.3, 905, 0.55, 'Fast-drying ionic dryer with three heat settings and a cool shot.', ['1800W', '3 heat / 2 speed', 'Concentrator + diffuser'], [['cj', 27.99, 6, 12, 'CN', 'ALL'], ['noon', 32.0, 1, 3, 'AE', 'GULF']]],
  ['beauty', 'Makeup brush set, 12 pieces', 'Nuru', '🖌️', 4.5, 1780, 0.65, 'Soft synthetic brushes for face and eyes, with a roll-up travel case.', ['12 vegan brushes', 'Travel case', 'Easy to clean'], [['aliexpress_ds', 10.99, 8, 15, 'CN', 'ALL'], ['shein', 8.5, 7, 12, 'CN', 'NO_CN'], ['temu', 7.99, 6, 12, 'CN', 'NA_EU']]],
  // Home
  ['home', 'LED strip lights 5 m with app', 'Lumo', '💡', 4.2, 2200, 0.7, 'Colour-changing strip lights with app control and music sync.', ['5 m, cuttable', 'App + remote', 'Music sync'], [['cj', 13.99, 6, 12, 'CN', 'ALL'], ['temu', 9.99, 6, 12, 'CN', 'NA_EU'], ['aliexpress_aff', 10.49, 8, 16, 'CN', 'NO_CN']]],
  ['home', 'Thermal blackout curtains, 2 panels', 'Sahara Home', '🪟', 4.4, 640, 0.45, 'Heavy blackout curtains that block light and keep rooms cool.', ['Blocks 99% light', 'Thermal insulated', '2 panels, 140×240 cm'], [['aliexpress_ds', 26.99, 9, 16, 'CN', 'ALL'], ['amazon', 32.0, 2, 4, 'US', 'US']]],
  ['home', 'Memory foam pillow', 'Sahara Home', '🛏️', 4.5, 1310, 0.6, 'Contoured memory foam pillow with a washable bamboo-fibre cover.', ['Contour shape', 'Washable cover', 'Medium-firm'], [['spocket', 24.99, 3, 7, 'US', 'NA_EU'], ['cj', 19.99, 7, 13, 'CN', 'ALL']]],
  ['home', 'Dimmable LED desk lamp', 'Lumo', '🪔', 4.6, 820, 0.5, 'Eye-friendly desk lamp with five brightness levels and a USB charging port.', ['5 brightness levels', 'USB charging port', 'Touch control'], [['cj', 18.49, 5, 11, 'CN', 'ALL'], ['flipkart', 15.0, 2, 4, 'IN', 'IN']]],
  // Kitchen
  ['kitchen', 'Digital air fryer 4 L', 'Pika', '🍟', 4.6, 3400, 0.98, 'Compact air fryer with eight presets and a dishwasher-safe basket.', ['4 L basket', '8 presets', '1400W'], [['cj', 54.99, 7, 13, 'CN', 'ALL'], ['noon', 59.0, 1, 3, 'AE', 'GULF'], ['jumia', 52.0, 2, 6, 'NG', 'JUMIA'], ['amazon', 62.0, 2, 4, 'US', 'US']]],
  ['kitchen', 'Insulated steel water bottle 1 L', 'Pika', '🥤', 4.7, 2650, 0.8, 'Keeps drinks cold for 24 hours or hot for 12. Leak-proof lid.', ['24 h cold / 12 h hot', 'BPA free', 'Leak-proof'], [['spocket', 19.99, 3, 6, 'US', 'NA_EU'], ['aliexpress_ds', 12.99, 8, 15, 'CN', 'ALL']]],
  ['kitchen', 'Electric kettle 1.7 L', 'Pika', '🫖', 4.4, 1120, 0.6, 'Fast-boil kettle with auto shut-off and boil-dry protection.', ['1.7 L', 'Auto shut-off', '360° base'], [['cj', 22.99, 6, 12, 'CN', 'ALL'], ['flipkart', 18.0, 2, 4, 'IN', 'IN'], ['jumia', 21.0, 2, 5, 'KE', 'JUMIA']]],
  ['kitchen', "Chef's knife set with block, 6 pieces", 'Pika', '🔪', 4.3, 480, 0.4, 'Stainless steel knives with a bamboo block and sharpener.', ['High-carbon steel', 'Bamboo block', 'Sharpener included'], [['aliexpress_ds', 29.99, 9, 16, 'CN', 'ALL']]],
  // Sports
  ['sports', 'Non-slip yoga mat 6 mm', 'Stride', '🧘', 4.6, 1990, 0.7, 'Cushioned TPE yoga mat with alignment lines and a carry strap.', ['6 mm cushioning', 'Non-slip both sides', 'Carry strap'], [['cj', 16.99, 6, 12, 'CN', 'ALL'], ['temu', 12.5, 6, 12, 'CN', 'NA_EU'], ['shein', 13.0, 7, 12, 'CN', 'NO_CN']]],
  ['sports', 'Adjustable dumbbells, pair (2–10 kg)', 'Stride', '🏋️', 4.4, 730, 0.55, 'Space-saving dumbbells that adjust from 2 to 10 kg with a twist.', ['2–10 kg each', 'Quick-twist dial', 'Storage tray'], [['spocket', 89.99, 4, 8, 'DE', 'EU_UK'], ['amazon', 95.0, 2, 4, 'US', 'US']]],
  ['sports', 'Resistance bands set, 5 levels', 'Stride', '🎽', 4.5, 1640, 0.6, 'Five latex bands with handles, door anchor and ankle straps.', ['5 resistance levels', 'Door anchor', 'Travel pouch'], [['aliexpress_ds', 14.99, 8, 15, 'CN', 'ALL'], ['jumia', 15.5, 2, 5, 'NG', 'JUMIA']]],
  ['sports', 'Match football, size 5', 'Kivu', '⚽', 4.3, 560, 0.65, 'Hand-stitched training and match ball for grass and turf.', ['Size 5', 'Hand-stitched', 'Butyl bladder'], [['cj', 13.49, 6, 12, 'CN', 'ALL'], ['jumia', 11.0, 1, 4, 'KE', 'JUMIA'], ['noon', 14.5, 1, 3, 'AE', 'GULF']]],
  // Toys
  ['toys', 'Building blocks city set, 500 pieces', 'Pika Kids', '🧱', 4.6, 890, 0.6, 'Compatible building bricks with a fold-out city map and figures.', ['500 pieces', 'Ages 6+', 'Compatible bricks'], [['aliexpress_ds', 24.99, 9, 16, 'CN', 'ALL'], ['temu', 19.0, 6, 12, 'CN', 'NA_EU']]],
  ['toys', 'Off-road RC car 1:16', 'Pika Kids', '🏎️', 4.2, 1030, 0.55, 'All-terrain remote-control car with two rechargeable batteries.', ['20 km/h', '2 batteries', '2.4 GHz remote'], [['cj', 29.99, 6, 12, 'CN', 'ALL'], ['noon', 34.0, 1, 3, 'AE', 'GULF']]],
  ['toys', 'Wooden world map puzzle', 'Baraka Kids', '🧩', 4.8, 310, 0.35, 'Chunky wooden puzzle with continents, animals and flags.', ['Solid wood', 'Ages 3+', 'Non-toxic paint'], [['spocket', 21.99, 4, 8, 'GB', 'NA_EU'], ['cj', 16.99, 7, 13, 'CN', 'ALL']]],
  ['toys', 'Soft plush elephant 30 cm', 'Baraka Kids', '🐘', 4.7, 450, 0.4, 'Super-soft plush toy, machine washable, safety tested.', ['30 cm', 'Machine washable', 'Safety tested'], [['printful', 18.99, 5, 9, 'US', 'ALL'], ['shein', 11.0, 7, 12, 'CN', 'NO_CN']]],
  // Health
  ['health', 'Digital forehead thermometer', 'Afya', '🌡️', 4.3, 1270, 0.6, 'Contactless infrared thermometer with fever alert and memory.', ['1-second reading', 'Fever alert', '32 memories'], [['cj', 14.99, 5, 11, 'CN', 'ALL'], ['jumia', 13.0, 1, 4, 'NG', 'JUMIA'], ['flipkart', 11.5, 2, 4, 'IN', 'IN']]],
  ['health', 'Upper-arm blood pressure monitor', 'Afya', '🩺', 4.5, 980, 0.55, 'Automatic monitor with irregular heartbeat detection and two user memories.', ['2 users × 99 memories', 'Irregular beat alert', 'Large display'], [['aliexpress_ds', 27.99, 8, 15, 'CN', 'ALL'], ['amazon', 33.0, 2, 4, 'US', 'US'], ['noon', 31.0, 1, 3, 'AE', 'GULF']]],
  ['health', 'Percussion massage gun', 'Pulsa', '💪', 4.4, 1540, 0.75, 'Quiet massage gun with six heads and 20 speed levels.', ['20 speeds', '6 heads', '6 h battery'], [['cj', 39.99, 6, 12, 'CN', 'ALL'], ['temu', 34.0, 6, 12, 'CN', 'NA_EU']]],
  ['health', 'Sonic electric toothbrush', 'Afya', '🪥', 4.6, 2120, 0.7, 'Rechargeable sonic toothbrush with four modes and two-minute timer.', ['4 modes', '30-day battery', '4 brush heads'], [['spocket', 24.99, 3, 7, 'US', 'NA_EU'], ['cj', 18.99, 6, 12, 'CN', 'ALL'], ['flipkart', 16.0, 2, 4, 'IN', 'IN']]],
  // Pets
  ['pets', 'Cat scratching post with perch', 'Paka', '🐈', 4.5, 670, 0.5, 'Sisal scratching post with a soft perch and dangling toy.', ['Natural sisal', '60 cm tall', 'Stable base'], [['aliexpress_ds', 21.99, 9, 16, 'CN', 'ALL'], ['temu', 17.5, 6, 12, 'CN', 'NA_EU']]],
  ['pets', 'No-pull dog harness', 'Paka', '🐕', 4.6, 1380, 0.6, 'Padded, reflective harness with front and back leash clips.', ['Reflective trim', '2 leash clips', 'Sizes XS–XL'], [['cj', 15.99, 6, 12, 'CN', 'ALL'], ['amazon', 19.0, 2, 4, 'US', 'US']]],
  ['pets', 'Automatic pet feeder 4 L', 'Paka', '🥣', 4.3, 540, 0.45, 'Programmable feeder with portion control and a voice recorder.', ['4 L hopper', 'Up to 6 meals/day', 'Battery backup'], [['cj', 44.99, 7, 13, 'CN', 'ALL'], ['noon', 49.0, 1, 3, 'AE', 'GULF']]],
  ['pets', 'Reusable pet hair remover roller', 'Paka', '🧹', 4.4, 2900, 0.7, 'Self-cleaning roller that lifts pet hair from sofas and clothes.', ['No sticky sheets', 'Self-cleaning', 'Works on fabric'], [['aliexpress_ds', 9.99, 8, 15, 'CN', 'ALL'], ['shein', 6.5, 7, 12, 'CN', 'NO_CN'], ['jumia', 8.5, 1, 4, 'KE', 'JUMIA']]],
];

export const PRODUCTS: MockProduct[] = SPECS.map((spec, i) => {
  const [slug, title, brand, icon, rating, review_count, popularity, description, bullets, offerSpecs] = spec;
  const n = i + 1;
  const cat = CATEGORIES.find((c) => c.slug === slug)!;
  const productOffers = offers(n, offerSpecs);
  const shipsTo = Array.from(new Set(productOffers.flatMap((o) => o.ships_to)));
  return {
    id: `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title,
    description,
    brand,
    category_path: [slug],
    category_ids: [cat.id],
    category_slug: slug,
    icon,
    bullet_points: bullets,
    image: null,
    rating,
    review_count,
    offers: productOffers,
    min_price_usd: Math.min(...productOffers.map((o) => o.display_price_usd)),
    ships_to: shipsTo,
    fastest_days: Math.min(...productOffers.map((o) => o.delivery_days_max ?? 99)),
    popularity,
  };
});

export function findMockOffer(offerId: string) {
  for (const p of PRODUCTS) {
    const offer = p.offers.find((o) => o.offer_id === offerId);
    if (offer) return { product: p, offer };
  }
  return null;
}
