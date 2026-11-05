import type { IndexedDocument, RawProduct, SearchDocument, SearchOffer } from './types';
import { priceBucket, ratingBucket } from './money';
import { median, sellScore } from './ranking';

const round2 = (n: number) => Math.round(n * 100) / 100;

function offerDaysMin(o: SearchOffer): number | null {
  return o.delivery_days_min ?? o.delivery_days_max ?? null;
}
function offerDaysMax(o: SearchOffer): number | null {
  return o.delivery_days_max ?? o.delivery_days_min ?? null;
}
function minOrNull(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.min(...v) : null;
}

/** Offers usable in a country. */
export function offersFor(offers: SearchOffer[], country: string): SearchOffer[] {
  const cc = country.toUpperCase();
  return offers.filter((o) => o.ships_to.includes(cc));
}

/** Build one document (without sell scores; see buildDocuments). */
export function buildDocument(raw: RawProduct): IndexedDocument | null {
  const offers = raw.offers
    .filter((o) => Number.isFinite(o.display_price_usd) && o.display_price_usd > 0 && o.ships_to.length > 0)
    .map((o) => ({ ...o, display_price_usd: round2(o.display_price_usd), ships_to: [...new Set(o.ships_to.map((c) => c.toUpperCase()))].sort() }))
    .sort((a, b) => a.display_price_usd - b.display_price_usd);
  if (!offers.length) return null;

  const shipsTo = [...new Set(offers.flatMap((o) => o.ships_to))].sort();
  const doc: IndexedDocument = {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? '',
    brand: raw.brand,
    category_path: raw.category_path,
    category_ids: raw.category_ids,
    image: raw.image,
    rating: raw.rating,
    review_count: raw.review_count ?? 0,
    offers,
    min_price_usd: offers[0].display_price_usd,
    ships_to: shipsTo,
    fastest_days: minOrNull(offers.map(offerDaysMin)),
    popularity: Math.min(1, Math.max(0, raw.popularity ?? 0)),
    bullets: (raw.bullet_points ?? []).join(' \n '),
    category_slugs: raw.category_slugs,
    source_kinds: [...new Set(offers.map((o) => o.kind))].sort(),
    source_codes: [...new Set(offers.map((o) => o.source_code))].sort(),
    offer_ships_from: [...new Set(offers.map((o) => o.ships_from).filter((x): x is string => !!x))].sort(),
    rating_bucket: ratingBucket(raw.rating),
    rating_sort: raw.rating ?? 0,
  };

  for (const cc of shipsTo) {
    const local = offersFor(offers, cc);
    const price = Math.min(...local.map((o) => o.display_price_usd));
    doc[`cprice_${cc}`] = price;
    doc[`cpbucket_${cc}`] = priceBucket(price);
    const dmin = minOrNull(local.map(offerDaysMin));
    const dmax = minOrNull(local.map(offerDaysMax));
    // Unknown delivery -> large sentinel so "fastest" sorts it last and max_days excludes it.
    doc[`cdays_${cc}`] = dmin ?? 99;
    doc[`cdmax_${cc}`] = dmax ?? 99;
  }
  return doc;
}

/**
 * Build documents for a locale and attach per-country sell scores. The price
 * component compares each product to the median price of its top-level
 * category in the same country, so the whole set is needed.
 */
export function buildDocuments(raws: RawProduct[]): IndexedDocument[] {
  const docs = raws.map(buildDocument).filter((d): d is IndexedDocument => d != null);
  attachSellScores(docs);
  return docs;
}

export function attachSellScores(docs: IndexedDocument[]): void {
  const pricesByKey = new Map<string, number[]>();
  const key = (cat: string, cc: string) => `${cat}|${cc}`;
  for (const d of docs) {
    const top = d.category_slugs[0] ?? '_';
    for (const cc of d.ships_to) {
      for (const k of [key(top, cc), key('_all', cc)]) {
        const arr = pricesByKey.get(k) ?? [];
        arr.push(d[`cprice_${cc}`] as number);
        pricesByKey.set(k, arr);
      }
    }
  }
  for (const d of docs) {
    const top = d.category_slugs[0] ?? '_';
    for (const cc of d.ships_to) {
      const peers = pricesByKey.get(key(top, cc)) ?? [];
      const ref = peers.length >= 3 ? median(peers) : median(pricesByKey.get(key('_all', cc)) ?? []);
      const dmax = d[`cdmax_${cc}`] as number;
      d[`csell_${cc}`] = sellScore({
        popularity: d.popularity,
        rating: d.rating,
        review_count: d.review_count,
        delivery_days: dmax >= 99 ? null : dmax,
        price_usd: d[`cprice_${cc}`] as number,
        reference_price_usd: ref,
      });
    }
  }
}

/**
 * Contract-shaped hit for a shopper's country: only offers that ship there,
 * cheapest first, with min_price_usd / fastest_days for that country.
 * Internal fields are dropped.
 */
export function toHit(doc: IndexedDocument, country: string): SearchDocument {
  const cc = country.toUpperCase();
  const local = offersFor(doc.offers, cc);
  const offers = (local.length ? local : doc.offers).slice().sort((a, b) => a.display_price_usd - b.display_price_usd);
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    brand: doc.brand ?? null,
    category_path: doc.category_path,
    category_ids: doc.category_ids,
    image: doc.image ?? null,
    rating: doc.rating ?? null,
    review_count: doc.review_count,
    offers,
    min_price_usd: offers[0]?.display_price_usd ?? doc.min_price_usd,
    ships_to: doc.ships_to,
    fastest_days: minOrNull(offers.map(offerDaysMin)),
    popularity: doc.popularity,
  };
}
