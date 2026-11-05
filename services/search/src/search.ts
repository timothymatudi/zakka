import type { Config } from './config';
import type { EngineQuery, EngineResult, Facets, Locale, QueryUnderstanding, SearchEngine, SearchHit, SearchQuery } from './types';
import { toHit } from './documents';
import { understandQuery } from './understanding';
import { currencyForCountry, toUsd } from './money';

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
  debug?: { engine: string; understanding: QueryUnderstanding | null; effective: EngineQuery };
}

export class SearchService {
  constructor(
    private engine: SearchEngine,
    private fallback: SearchEngine | null,
    private ai: Config['anthropic'],
  ) {}

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
      doc = await this.engine.getById(locale, id);
    } catch (err) {
      if (!this.fallback) throw err;
      console.warn(`[search] ${this.engine.name} getById failed (${(err as Error).message}); using ${this.fallback.name}`);
      doc = await this.fallback.getById(locale, id);
    }
    const cc = country.toUpperCase();
    if (!doc || !doc.ships_to.includes(cc)) return null;
    return toHit(doc, cc);
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
      });
    }

    // Explicit query params always win over what was inferred from the text.
    let maxPrice = params.max_price;
    if (maxPrice == null && understanding?.max_price != null) {
      maxPrice = toUsd(understanding.max_price, understanding.currency ?? 'USD') ?? undefined;
    }
    const q: EngineQuery = {
      q: understanding ? understanding.keywords || (understanding.category_hint ? '*' : raw) : '*',
      locale: params.locale,
      country,
      category: params.category ?? (understanding && !understanding.keywords ? understanding.category_hint ?? undefined : undefined),
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
    // Keywords found nothing (e.g. the query is in another language than the
    // catalog locale): retry with the inferred category instead of the text.
    if (res.found === 0 && understanding?.category_hint && !params.category && q.q !== '*') {
      const retry: EngineQuery = { ...q, q: '*', category: understanding.category_hint };
      const second = await this.run(retry);
      if (second.res.found > 0) {
        ({ res, engine } = second);
        Object.assign(q, retry);
      }
    }

    const out: SearchOutcome = {
      hits: res.docs.map((d) => toHit(d, country)),
      found: res.found,
      facets: res.facets,
      page,
    };
    if (opts.debug) out.debug = { engine, understanding, effective: q };
    return out;
  }
}
