// In-memory search engine for development and tests (the offline dataset is
// small). Production uses Typesense. Mirrors the Typesense engine's filters,
// sorts and facets; per-country values come from countryFields().
import type { EngineQuery, EngineResult, IndexedDocument, Locale, SearchEngine } from '../types';
import { tokenize, hasCjk } from '../text';
import { countryFields, type CountryFields } from '../documents';

// Relevance is grouped in tiers of 0.1; partial matches are added when fewer than this many full matches exist.
const RELEVANCE_TIERS = 10;
export const DROP_TOKENS_THRESHOLD = 10;

const W = { localTitle: 4, title: 3, brand: 2, category: 2, localDescription: 1, bullets: 1, description: 1 } as const;
type Field = keyof typeof W;
const MAX_WEIGHT = W.localTitle;

interface Entry {
  doc: IndexedDocument;
  base: Record<'title' | 'brand' | 'category' | 'bullets' | 'description', Set<string>>;
  perLocale: Map<Locale, { title: Set<string>; description: Set<string> }>;
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

/** 1 exact, 0.85 stem/prefix, 0.6 one typo. */
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

const EMPTY = new Set<string>();

function entryFor(doc: IndexedDocument): Entry {
  return {
    doc,
    base: {
      title: new Set(tokenize(doc.title)),
      brand: new Set(tokenize(doc.brand ?? '')),
      category: new Set(tokenize(doc.category_terms.join(' '))),
      bullets: new Set(tokenize(doc.bullets ?? '')),
      description: new Set(tokenize(doc.description)),
    },
    perLocale: new Map(),
  };
}

function localSets(e: Entry, locale: Locale) {
  let s = e.perLocale.get(locale);
  if (!s) {
    s = {
      title: new Set(tokenize((e.doc[`title_${locale}`] as string | undefined) ?? '')),
      description: new Set(tokenize((e.doc[`description_${locale}`] as string | undefined) ?? '')),
    };
    e.perLocale.set(locale, s);
  }
  return s;
}

/** Relevance in 0..1, or -1 when the doc matches fewer than minMatched tokens. */
function relevance(e: Entry, locale: Locale, tokens: string[], minMatched: number): number {
  const loc = locale === e.doc.base_locale ? { title: EMPTY, description: EMPTY } : localSets(e, locale);
  const sets: Record<Field, Set<string>> = {
    localTitle: loc.title,
    title: e.base.title,
    brand: e.base.brand,
    category: e.base.category,
    localDescription: loc.description,
    bullets: e.base.bullets,
    description: e.base.description,
  };
  let total = 0;
  let matched = 0;
  for (const qt of tokens) {
    let best = 0;
    for (const f of Object.keys(W) as Field[]) {
      const m = tokenMatch(qt, sets[f]);
      if (m) best = Math.max(best, m * W[f]);
    }
    if (best > 0) matched++;
    total += best;
  }
  if (matched < minMatched) return -1;
  return Math.min(1, total / (W.title * tokens.length));
}

export class MemoryEngine implements SearchEngine {
  readonly name = 'memory' as const;
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();

  constructor(docs: IndexedDocument[]) {
    this.replaceAll(docs);
  }

  /** Swap in a freshly built dataset (used by POST /admin/reindex). */
  replaceAll(docs: IndexedDocument[]): void {
    this.entries = docs.map(entryFor);
    this.byId = new Map(this.entries.map((e) => [e.doc.id, e]));
  }

  async getById(id: string): Promise<IndexedDocument | null> {
    return this.byId.get(id)?.doc ?? null;
  }

  count(): number {
    return this.entries.length;
  }

  async search(q: EngineQuery): Promise<EngineResult> {
    const cc = q.country.toUpperCase();
    // Filters (always: ships to the shopper's country).
    const pool: { e: Entry; cf: CountryFields }[] = [];
    for (const e of this.entries) {
      const d = e.doc;
      const cf = countryFields(d, cc);
      if (!cf) continue;
      if (q.category && !d.category_slugs.includes(q.category)) continue;
      if (q.min_price != null && cf.price < q.min_price) continue;
      if (q.max_price != null && cf.price > q.max_price) continue;
      if (q.max_days != null && cf.dmax > q.max_days) continue;
      if (q.min_rating != null && d.rating_sort < q.min_rating) continue;
      if (q.ships_from?.length && !d.offer_ships_from.some((c) => q.ships_from!.includes(c))) continue;
      pool.push({ e, cf });
    }

    // Text match, like Typesense's drop_tokens_threshold: with fewer than
    // DROP_TOKENS_THRESHOLD full matches, docs matching half the tokens are added
    // (relevance is still computed over all tokens, so full matches rank higher).
    const text = q.q.trim();
    let scored: { e: Entry; cf: CountryFields; rel: number }[];
    if (!text || text === '*') {
      scored = pool.map((p) => ({ ...p, rel: 1 }));
    } else {
      const tokens = [...new Set(tokenize(text))];
      const strict = hasCjk(text) ? Math.max(1, Math.ceil(tokens.length * 0.6)) : tokens.length;
      const score = (need: number) => pool.map((p) => ({ ...p, rel: relevance(p.e, q.locale, tokens, need) })).filter((x) => x.rel > 0);
      scored = score(strict);
      const loose = Math.max(1, Math.ceil(tokens.length / 2));
      if (scored.length < DROP_TOKENS_THRESHOLD && loose < strict) scored = score(loose);
    }

    const tier = (rel: number) => Math.round(rel * RELEVANCE_TIERS);
    scored.sort((a, b) => {
      switch (q.sort) {
        case 'price_asc':
          return a.cf.price - b.cf.price || b.rel - a.rel;
        case 'fastest':
          return a.cf.dmax - b.cf.dmax || b.cf.sell - a.cf.sell;
        case 'rating':
          return b.e.doc.rating_sort - a.e.doc.rating_sort || b.e.doc.review_count - a.e.doc.review_count;
        default:
          return tier(b.rel) - tier(a.rel) || b.cf.sell - a.cf.sell || b.rel - a.rel;
      }
    });

    const start = (q.page - 1) * q.per_page;
    return {
      docs: scored.slice(start, start + q.per_page).map((s) => s.e.doc),
      found: scored.length,
      facets: facetsFor(scored),
    };
  }
}

function facetsFor(items: { e: Entry; cf: CountryFields }[]): EngineResult['facets'] {
  const counters: Record<string, Map<string, number>> = {
    category_slug: new Map(),
    source_kind: new Map(),
    ships_from: new Map(),
    price_bucket: new Map(),
    rating: new Map(),
  };
  const bump = (k: string, v: string) => counters[k].set(v, (counters[k].get(v) ?? 0) + 1);
  for (const { e, cf } of items) {
    e.doc.category_slugs.forEach((v) => bump('category_slug', v));
    e.doc.source_kinds.forEach((v) => bump('source_kind', v));
    e.doc.offer_ships_from.forEach((v) => bump('ships_from', v));
    bump('price_bucket', cf.bucket);
    bump('rating', e.doc.rating_bucket);
  }
  const out: EngineResult['facets'] = {};
  for (const [k, m] of Object.entries(counters)) {
    out[k] = [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 20);
  }
  return out;
}
