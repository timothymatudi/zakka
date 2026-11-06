import type { IndexedDocument, Locale, RawProduct, SearchHit, SearchOffer } from './types';
import { currencyDecimals, currencyForCountry, fromUsd, priceBucket, ratingBucket } from './money';
import { sellScore } from './ranking';
import type { CategoryDirectory } from './categories';

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundTo = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;
/** Sentinel for "delivery time unknown": sorts last, excluded by max_days. */
export const UNKNOWN_DAYS = 99;

const daysMin = (o: SearchOffer) => o.delivery_days_min ?? o.delivery_days_max ?? null;
const daysMax = (o: SearchOffer) => o.delivery_days_max ?? o.delivery_days_min ?? null;
function minOrNull(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.min(...v) : null;
}

/** Offers usable in a country. */
export function offersFor(offers: SearchOffer[], country: string): SearchOffer[] {
  const cc = country.toUpperCase();
  return offers.filter((o) => o.ships_to.includes(cc));
}

function cleanOffers(offers: SearchOffer[]): SearchOffer[] {
  return offers
    .filter((o) => Number.isFinite(o.display_price_usd) && o.display_price_usd > 0 && o.ships_to.length > 0)
    .map((o) => ({ ...o, display_price_usd: round2(o.display_price_usd), ships_to: [...new Set(o.ships_to.map((c) => c.trim().toUpperCase()))].sort() }))
    .sort((a, b) => a.display_price_usd - b.display_price_usd);
}

// ---------------------------------------------------------------------------
// Reference (median) prices for the sell score's price component.
// A streaming log-histogram per key keeps memory constant at 1M+ products
// (2% bucket resolution, which is plenty for a ranking signal).

const BUCKET_BASE = Math.log(1.02);
const bucketOf = (price: number) => Math.floor(Math.log(Math.max(price, 0.01) / 0.01) / BUCKET_BASE);
const bucketMid = (b: number) => 0.01 * Math.exp((b + 0.5) * BUCKET_BASE);

/** Keys: `${topSlug}|${CC}`, `${topSlug}|*`, `_all|${CC}`, `_all|*`. Values: median USD. */
export type ReferencePrices = Record<string, number>;
const MIN_SAMPLES = 3;

export class ReferencePriceBuilder {
  private hist = new Map<string, Map<number, number>>();
  constructor(private active: Set<string>) {}

  private add(key: string, price: number) {
    let h = this.hist.get(key);
    if (!h) this.hist.set(key, (h = new Map()));
    const b = bucketOf(price);
    h.set(b, (h.get(b) ?? 0) + 1);
  }

  addProduct(raw: RawProduct): void {
    const offers = cleanOffers(raw.offers);
    if (!offers.length) return;
    const top = raw.categories[0]?.slug ?? '_none';
    this.add(`${top}|*`, offers[0].display_price_usd);
    this.add('_all|*', offers[0].display_price_usd);
    const shipsTo = new Set(offers.flatMap((o) => o.ships_to));
    for (const cc of shipsTo) {
      if (!this.active.has(cc)) continue;
      const price = Math.min(...offersFor(offers, cc).map((o) => o.display_price_usd));
      this.add(`${top}|${cc}`, price);
      this.add(`_all|${cc}`, price);
    }
  }

  result(): ReferencePrices {
    const out: ReferencePrices = {};
    for (const [key, h] of this.hist) {
      let n = 0;
      for (const c of h.values()) n += c;
      if (n < MIN_SAMPLES && !key.startsWith('_all|')) continue;
      const sorted = [...h.entries()].sort((a, b) => a[0] - b[0]);
      let seen = 0;
      for (const [b, c] of sorted) {
        seen += c;
        if (seen * 2 >= n) {
          out[key] = round2(bucketMid(b));
          break;
        }
      }
    }
    return out;
  }
}

export function referencePricesFor(raws: Iterable<RawProduct>, active: Set<string>): ReferencePrices {
  const b = new ReferencePriceBuilder(active);
  for (const r of raws) b.addProduct(r);
  return b.result();
}

function refPrice(refs: ReferencePrices, top: string, cc: string | '*', fallback: number): number {
  return refs[`${top}|${cc}`] ?? refs[`_all|${cc}`] ?? refs[`${top}|*`] ?? refs['_all|*'] ?? fallback;
}

// ---------------------------------------------------------------------------

export interface BuildContext {
  /** Countries that get precomputed per-country fields. */
  active: Set<string>;
  refs: ReferencePrices;
}

/** One document per product, or null when it has no priced, shippable offer or no text. */
export function buildDocument(raw: RawProduct, ctx: BuildContext): IndexedDocument | null {
  const offers = cleanOffers(raw.offers);
  if (!offers.length) return null;
  const locales = Object.keys(raw.translations) as Locale[];
  const base: Locale = raw.translations.en ? 'en' : locales[0];
  const bt = base ? raw.translations[base] : undefined;
  if (!bt?.title) return null;

  const shipsTo = [...new Set(offers.flatMap((o) => o.ships_to))].sort();
  const top = raw.categories[0]?.slug ?? '_none';
  const bestDmax = minOrNull(offers.map(daysMax)) ?? UNKNOWN_DAYS;
  const catRef = refPrice(ctx.refs, top, '*', offers[0].display_price_usd);
  const doc: IndexedDocument = {
    id: raw.id,
    base_locale: base,
    title: bt.title,
    description: bt.description ?? '',
    bullets: (bt.bullet_points ?? []).join(' \n '),
    brand: raw.brand,
    gtin: raw.gtin ?? null,
    category_ids: raw.categories.map((c) => c.id),
    category_slugs: raw.categories.map((c) => c.slug),
    category_terms: [...new Set(raw.categories.flatMap((c) => [c.slug, ...Object.values(c.names).filter((n): n is string => !!n)]))],
    image: raw.image,
    rating: raw.rating,
    rating_sort: raw.rating ?? 0,
    rating_bucket: ratingBucket(raw.rating),
    review_count: raw.review_count ?? 0,
    offers,
    min_price_usd: offers[0].display_price_usd,
    ships_to: shipsTo,
    fastest_days: minOrNull(offers.map(daysMin)),
    best_dmax: bestDmax,
    popularity: Math.min(1, Math.max(0, raw.popularity ?? 0)),
    source_kinds: [...new Set(offers.map((o) => o.kind))].sort(),
    source_codes: [...new Set(offers.map((o) => o.source_code))].sort(),
    offer_ships_from: [...new Set(offers.map((o) => o.ships_from).filter((x): x is string => !!x))].sort(),
    cat_ref_price: catRef,
    sell_global: 0,
    ...(raw.local_prices?.length ? { local_prices: raw.local_prices } : {}),
  };
  doc.sell_global = sellFor(doc, offers[0].display_price_usd, bestDmax, catRef);

  // Only locales with their own translation get fields; queries fall back to the base text.
  for (const loc of locales) {
    const t = raw.translations[loc];
    if (loc === base || !t?.title) continue;
    doc[`title_${loc}`] = t.title;
    if (t.description) doc[`description_${loc}`] = t.description;
  }

  for (const cc of shipsTo) {
    if (!ctx.active.has(cc)) continue;
    const local = offersFor(offers, cc);
    const price = local[0].display_price_usd;
    const dmax = minOrNull(local.map(daysMax)) ?? UNKNOWN_DAYS;
    doc[`cprice_${cc}`] = price;
    doc[`cdmax_${cc}`] = dmax;
    doc[`csell_${cc}`] = sellFor(doc, price, dmax, refPrice(ctx.refs, top, cc, price));
  }
  return doc;
}

function sellFor(doc: IndexedDocument, price: number, dmax: number, ref: number): number {
  return sellScore({
    popularity: doc.popularity,
    rating: doc.rating,
    review_count: doc.review_count,
    delivery_days: dmax >= UNKNOWN_DAYS ? null : dmax,
    price_usd: price,
    reference_price_usd: ref,
  });
}

/** Builds documents for an in-memory set (two passes: reference prices, then documents). */
export function buildDocuments(raws: RawProduct[], active: Set<string>): IndexedDocument[] {
  const ctx: BuildContext = { active, refs: referencePricesFor(raws, active) };
  return raws.map((r) => buildDocument(r, ctx)).filter((d): d is IndexedDocument => d != null);
}

export interface CountryFields {
  price: number;
  dmax: number;
  sell: number;
  bucket: string;
}

/** Per-country values: stored for active countries, computed from offers otherwise. */
export function countryFields(doc: IndexedDocument, country: string): CountryFields | null {
  const cc = country.toUpperCase();
  if (!doc.ships_to.includes(cc)) return null;
  const stored = doc[`cprice_${cc}`];
  if (typeof stored === 'number') {
    return { price: stored, dmax: doc[`cdmax_${cc}`] as number, sell: doc[`csell_${cc}`] as number, bucket: priceBucket(stored) };
  }
  const local = offersFor(doc.offers, cc);
  if (!local.length) return null;
  const price = Math.min(...local.map((o) => o.display_price_usd));
  const dmax = minOrNull(local.map(daysMax)) ?? UNKNOWN_DAYS;
  return { price, dmax, sell: sellFor(doc, price, dmax, doc.cat_ref_price || price), bucket: priceBucket(price) };
}

/** Localized title/description with fallback to the base text. */
export function localizedText(doc: IndexedDocument, locale: Locale): { title: string; description: string } {
  return {
    title: (doc[`title_${locale}`] as string | undefined) ?? doc.title,
    description: (doc[`description_${locale}`] as string | undefined) ?? doc.description,
  };
}

/**
 * Contract-shaped hit for a shopper's country and locale: only offers that ship
 * there, cheapest first, min_price_usd / fastest_days for that country, each
 * offer's price in the country's currency, localized text and category names.
 * Internal fields are dropped. Without an FX rate, local prices are in USD.
 */
export function toHit(doc: IndexedDocument, country: string, locale: Locale, dir: CategoryDirectory): SearchHit {
  const cc = country.toUpperCase();
  const local = offersFor(doc.offers, cc);
  const cur = currencyForCountry(cc);
  const offers = (local.length ? local : doc.offers)
    .slice()
    .sort((a, b) => a.display_price_usd - b.display_price_usd)
    .map((o) => {
      // An affiliate partner's own price wins when it is quoted in the shopper's currency.
      const partner = doc.local_prices?.find((lp) => lp.offer_id === o.offer_id && lp.currency === cur);
      if (partner) return { ...o, display_price_local: roundTo(partner.amount, currencyDecimals(cur)), currency: cur };
      const price = fromUsd(o.display_price_usd, cur);
      return { ...o, display_price_local: price ?? o.display_price_usd, currency: price == null ? 'USD' : cur };
    });
  const text = localizedText(doc, locale);
  return {
    id: doc.id,
    title: text.title,
    description: text.description,
    brand: doc.brand ?? null,
    category_path: doc.category_slugs.map((s) => dir.name(s, locale)),
    category_ids: doc.category_ids,
    image: doc.image ?? null,
    rating: doc.rating ?? null,
    review_count: doc.review_count,
    offers,
    min_price_usd: offers[0]?.display_price_usd ?? doc.min_price_usd,
    ships_to: doc.ships_to,
    fastest_days: minOrNull(offers.map(daysMin)),
    popularity: doc.popularity,
  };
}
