// In-memory search engine over documents (fixtures by default). Used when
// Typesense is unreachable or TYPESENSE_API_KEY is empty, so other agents can
// run offline. It mirrors the Typesense engine's filters, sorts and facets.

import type { EngineQuery, EngineResult, FacetValue, IndexedDocument, Locale, SearchEngine } from '../types';
import { normalize, tokenize, hasCjk } from '../text';

// Relevance is grouped in tiers of 0.1; full matches are kept when partial ones are added below this count.
const RELEVANCE_TIERS = 10;
export const DROP_TOKENS_THRESHOLD = 10;

const FIELD_WEIGHTS = { title: 3, brand: 2, category: 2, bullets: 1, description: 1 } as const;
type Field = keyof typeof FIELD_WEIGHTS;
const MAX_WEIGHT = FIELD_WEIGHTS.title;

interface Entry {
  doc: IndexedDocument;
  fields: Record<Field, Set<string>>;
  categoryKeys: Set<string>;
}

function stem(t: string): string {
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Score of a query token against a field's token set: 1 exact, 0.85 stem/prefix, 0.6 typo. */
function tokenMatch(qt: string, set: Set<string>): number {
  if (set.has(qt)) return 1;
  const qs = stem(qt);
  let best = 0;
  for (const t of set) {
    if (stem(t) === qs) return 0.85;
    if (qt.length >= 3 && t.startsWith(qt)) best = Math.max(best, 0.85);
    else if (qt.length >= 5 && editDistanceAtMostOne(qt, t)) best = Math.max(best, 0.6);
  }
  return best;
}

function entryFor(doc: IndexedDocument): Entry {
  return {
    doc,
    fields: {
      title: new Set(tokenize(doc.title)),
      brand: new Set(tokenize(doc.brand ?? '')),
      category: new Set(tokenize(doc.category_path.join(' '))),
      bullets: new Set(tokenize(doc.bullets ?? '')),
      description: new Set(tokenize(doc.description)),
    },
    categoryKeys: new Set([
      ...doc.category_slugs.map((s) => s.toLowerCase()),
      ...doc.category_ids.map((s) => s.toLowerCase()),
      ...doc.category_path.map((s) => normalize(s)),
    ]),
  };
}

/** Relevance in 0..1, or -1 when the doc does not match enough tokens. */
function relevance(e: Entry, tokens: string[], minMatched: number): number {
  let total = 0;
  let matched = 0;
  for (const qt of tokens) {
    let best = 0;
    for (const f of Object.keys(FIELD_WEIGHTS) as Field[]) {
      const m = tokenMatch(qt, e.fields[f]);
      if (m) best = Math.max(best, m * FIELD_WEIGHTS[f]);
    }
    if (best > 0) matched++;
    total += best;
  }
  if (matched < minMatched) return -1;
  return total / (MAX_WEIGHT * tokens.length);
}

export class MemoryEngine implements SearchEngine {
  readonly name = 'memory' as const;
  private byLocale = new Map<Locale, Entry[]>();

  constructor(docsByLocale: Partial<Record<Locale, IndexedDocument[]>>) {
    for (const [loc, docs] of Object.entries(docsByLocale)) {
      this.byLocale.set(loc as Locale, (docs ?? []).map(entryFor));
    }
  }

  async getById(locale: Locale, id: string): Promise<IndexedDocument | null> {
    return (this.byLocale.get(locale) ?? []).find((e) => e.doc.id === id)?.doc ?? null;
  }

  count(locale: Locale): number {
    return this.byLocale.get(locale)?.length ?? 0;
  }

  async search(q: EngineQuery): Promise<EngineResult> {
    const cc = q.country.toUpperCase();
    const entries = this.byLocale.get(q.locale) ?? this.byLocale.get('en') ?? [];
    const cat = q.category?.toLowerCase();
    const catNorm = q.category ? normalize(q.category) : undefined;

    // Filters (always: ships to the shopper's country).
    const pool = entries.filter(({ doc, categoryKeys }) => {
      const price = doc[`cprice_${cc}`] as number | undefined;
      if (price == null) return false;
      if (cat && !categoryKeys.has(cat) && !categoryKeys.has(catNorm!)) return false;
      if (q.min_price != null && price < q.min_price) return false;
      if (q.max_price != null && price > q.max_price) return false;
      if (q.max_days != null && (doc[`cdmax_${cc}`] as number) > q.max_days) return false;
      if (q.min_rating != null && doc.rating_sort < q.min_rating) return false;
      if (q.ships_from?.length && !doc.offer_ships_from.some((c) => q.ships_from!.includes(c))) return false;
      return true;
    });

    // Text match. Like Typesense's drop_tokens_threshold: when fewer than
    // DROP_TOKENS_THRESHOLD docs match every token, also accept docs matching
    // at least half of them. Relevance is still computed over all tokens, so
    // full matches stay in a higher tier.
    const text = q.q.trim();
    let scored: { e: Entry; rel: number }[];
    if (!text || text === '*') {
      scored = pool.map((e) => ({ e, rel: 1 }));
    } else {
      const tokens = [...new Set(tokenize(text))];
      const strict = hasCjk(text) ? Math.max(1, Math.ceil(tokens.length * 0.6)) : tokens.length;
      const score = (need: number) => pool.map((e) => ({ e, rel: relevance(e, tokens, need) })).filter((x) => x.rel > 0);
      scored = score(strict);
      const loose = Math.max(1, Math.ceil(tokens.length / 2));
      if (scored.length < DROP_TOKENS_THRESHOLD && loose < strict) scored = score(loose);
    }

    const sell = (d: IndexedDocument) => (d[`csell_${cc}`] as number) ?? 0;
    const price = (d: IndexedDocument) => d[`cprice_${cc}`] as number;
    const days = (d: IndexedDocument) => d[`cdays_${cc}`] as number;
    // Relevance tiers of 0.1: near-equal text matches tie, and the sell score decides
    // inside a tier (Typesense does the same with _text_match(buckets: N)).
    const bucket = (rel: number) => Math.round(rel * RELEVANCE_TIERS);

    scored.sort((a, b) => {
      const da = a.e.doc, db = b.e.doc;
      switch (q.sort) {
        case 'price_asc':
          return price(da) - price(db) || b.rel - a.rel;
        case 'fastest':
          return days(da) - days(db) || sell(db) - sell(da);
        case 'rating':
          return db.rating_sort - da.rating_sort || db.review_count - da.review_count;
        default:
          return bucket(b.rel) - bucket(a.rel) || sell(db) - sell(da) || b.rel - a.rel;
      }
    });

    const docs = scored.map((s) => s.e.doc);
    const start = (q.page - 1) * q.per_page;
    return {
      docs: docs.slice(start, start + q.per_page),
      found: docs.length,
      facets: facetsFor(docs, cc),
    };
  }
}

export function facetsFor(docs: IndexedDocument[], cc: string): EngineResult['facets'] {
  const counters: Record<string, Map<string, number>> = {
    category_path: new Map(),
    category_slug: new Map(),
    source_kind: new Map(),
    ships_from: new Map(),
    price_bucket: new Map(),
    rating: new Map(),
  };
  const bump = (k: string, v: string) => counters[k].set(v, (counters[k].get(v) ?? 0) + 1);
  for (const d of docs) {
    d.category_path.forEach((v) => bump('category_path', v));
    d.category_keys.forEach((v) => bump('category_slug', v));
    d.source_kinds.forEach((v) => bump('source_kind', v));
    d.offer_ships_from.forEach((v) => bump('ships_from', v));
    bump('price_bucket', d[`cpbucket_${cc}`] as string);
    bump('rating', d.rating_bucket);
  }
  const out: EngineResult['facets'] = {};
  for (const [k, m] of Object.entries(counters)) {
    out[k] = [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 20);
  }
  out.category_slug = out.category_slug.map(categoryKeyFacet);
  return out;
}

/** "phones|Simu" facet value -> { value: "phones", label: "Simu", count }. */
export function categoryKeyFacet(f: FacetValue): FacetValue {
  const i = f.value.indexOf('|');
  return i < 0 ? f : { value: f.value.slice(0, i), label: f.value.slice(i + 1), count: f.count };
}
