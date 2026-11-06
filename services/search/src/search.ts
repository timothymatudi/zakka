import type { Config } from './config';
import type { EngineQuery, EngineResult, Facets, Locale, QueryUnderstanding, SearchEngine, SearchHit, SearchQuery } from './types';
import { toHit } from './documents';
import { understandQuery } from './understanding';
import { currencyForCountry, toUsd } from './money';
import { CategoryDirectory } from './categories';
import { liveToHit, type LiveAffiliates } from './live';

/** Contract SearchQuery plus the additions not yet in packages/shared. */
export interface SearchParams extends SearchQuery {
  min_rating?: number;
  ships_from?: string[];
}

export interface SearchOutcome {
  hits: SearchHit[];
  found: number;
  facets: Facets;
  page: number;
  /** Only returned with debug=1; not part of the contract shape. */
  debug?: { engine: string; understanding: QueryUnderstanding | null; effective: EngineQuery; live: number };
}

/** Live affiliate hits appended to page 1 at most. */
export const MAX_LIVE_HITS = 10;

export interface SearchServiceOptions {
  fallback?: SearchEngine | null;
  ai: Config['anthropic'];
  categories: CategoryDirectory;
  live?: LiveAffiliates | null;
}

export class SearchService {
  categories: CategoryDirectory;
  private fallback: SearchEngine | null;
  private ai: Config['anthropic'];
  private live: LiveAffiliates | null;

  constructor(
    private engine: SearchEngine,
    opts: SearchServiceOptions,
  ) {
    this.fallback = opts.fallback ?? null;
    this.ai = opts.ai;
    this.categories = opts.categories;
    this.live = opts.live ?? null;
  }

  get engineName(): string {
    return this.engine.name;
  }

  private async run(q: EngineQuery): Promise<{ res: EngineResult; engine: string }> {
    try {
      return { res: await this.engine.search(q), engine: this.engine.name };
    } catch (err) {
      if (!this.fallback) throw err;
      console.warn(`[search] ${this.engine.name} failed (${(err as Error).message}); using ${this.fallback.name}`);
      return { res: await this.fallback.search(q), engine: this.fallback.name };
    }
  }

  /** One product for a country, or null when unknown or not shippable there. */
  async product(id: string, locale: Locale, country: string): Promise<SearchHit | null> {
    let doc;
    try {
      doc = await this.engine.getById(id);
    } catch (err) {
      if (!this.fallback) throw err;
      console.warn(`[search] ${this.engine.name} getById failed (${(err as Error).message}); using ${this.fallback.name}`);
      doc = await this.fallback.getById(id);
    }
    const cc = country.toUpperCase();
    if (!doc || !doc.ships_to.includes(cc)) return null;
    return toHit(doc, cc, locale, this.categories);
  }

  async search(params: SearchParams, opts: { debug?: boolean } = {}): Promise<SearchOutcome> {
    const country = params.country.toUpperCase();
    const page = Math.max(1, params.page ?? 1);
    const per_page = Math.min(100, Math.max(1, params.per_page ?? 20));
    const raw = (params.q ?? '').trim();

    let understanding: QueryUnderstanding | null = null;
    if (raw && raw !== '*') {
      understanding = await understandQuery(raw, { locale: params.locale, country, currency: currencyForCountry(country) }, {
        apiKey: this.ai.apiKey,
        model: this.ai.model,
        categorySlugs: this.categories.size ? this.categories.slugs() : undefined,
      });
    }

    // Live affiliate results start in parallel with the index query (page 1 only).
    const liveQuery = understanding?.keywords || raw;
    const livePromise = this.live && page === 1 && liveQuery ? this.live.search(liveQuery, country, params.locale) : Promise.resolve([]);

    // Explicit query params always win over what was inferred from the text.
    let maxPrice = params.max_price;
    if (maxPrice == null && understanding?.max_price != null) {
      maxPrice = toUsd(understanding.max_price, understanding.currency ?? 'USD') ?? undefined;
    }
    // category accepts a slug, id or localized name; unknown values match nothing.
    const explicitCategory = params.category ? this.categories.resolve(params.category) ?? params.category : undefined;
    const hint = understanding?.category_hint && this.categories.resolve(understanding.category_hint);
    const q: EngineQuery = {
      q: understanding ? understanding.keywords || (hint ? '*' : raw) : '*',
      locale: params.locale,
      country,
      category: explicitCategory ?? (understanding && !understanding.keywords ? hint || undefined : undefined),
      min_price: params.min_price,
      max_price: maxPrice,
      max_days: params.max_days ?? understanding?.max_days ?? undefined,
      min_rating: params.min_rating,
      ships_from: params.ships_from,
      sort: params.sort ?? 'relevance',
      page,
      per_page,
    };

    let { res, engine } = await this.run(q);
    // Keywords found nothing (e.g. another language than the catalog has):
    // retry with the inferred category instead of the text.
    if (res.found === 0 && hint && !params.category && q.q !== '*') {
      const retry: EngineQuery = { ...q, q: '*', category: hint };
      const second = await this.run(retry);
      if (second.res.found > 0) {
        ({ res, engine } = second);
        Object.assign(q, retry);
      }
    }

    const hits = res.docs.map((d) => toHit(d, country, params.locale, this.categories));
    // Federated affiliates go after the indexed results, skipping products already shown (by GTIN or id).
    const seenGtins = new Set(res.docs.map((d) => d.gtin).filter((g): g is string => !!g));
    const seenIds = new Set(hits.map((h) => h.id));
    let liveCount = 0;
    for (const item of await livePromise) {
      if (liveCount >= MAX_LIVE_HITS) break;
      if ((item.gtin && seenGtins.has(item.gtin)) || seenIds.has(item.id)) continue;
      if (q.max_price != null && Math.min(...item.offers.map((o) => o.display_price_usd)) > q.max_price) continue;
      const hit = liveToHit(item, country);
      if (!hit) continue;
      if (item.gtin) seenGtins.add(item.gtin);
      seenIds.add(item.id);
      hits.push(hit);
      liveCount++;
    }

    const out: SearchOutcome = {
      hits,
      found: res.found + liveCount,
      facets: this.publicFacets(res.facets, params.locale),
      page,
    };
    if (opts.debug) out.debug = { engine, understanding, effective: q, live: liveCount };
    return out;
  }

  /** Engine facets -> API facets; category facets get localized names from the directory. */
  private publicFacets(f: Facets, locale: Locale): Facets {
    const slugs = f.category_slug ?? [];
    return {
      category_path: slugs.map((s) => ({ value: this.categories.name(s.value, locale), count: s.count })),
      category_slug: slugs.map((s) => ({ value: s.value, label: this.categories.name(s.value, locale), count: s.count })),
      source_kind: f.source_kind ?? [],
      ships_from: f.ships_from ?? [],
      price_bucket: f.price_bucket ?? [],
      rating: f.rating ?? [],
    };
  }
}
