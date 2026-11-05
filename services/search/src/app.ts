import Fastify, { type FastifyInstance } from 'fastify';
import { LOCALES, type Locale, type SearchSort } from './types';
import type { SearchParams, SearchService } from './search';

export const MAX_QUERY_LENGTH = 200;
const SORTS: SearchSort[] = ['relevance', 'price_asc', 'fastest', 'rating'];

export class BadRequest extends Error {}

function num(v: unknown, name: string, opts: { int?: boolean; min?: number } = {}): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || (opts.int && !Number.isInteger(n)) || (opts.min != null && n < opts.min)) {
    throw new BadRequest(`invalid ${name}`);
  }
  return n;
}

function parseLocaleCountry(qs: Record<string, unknown>): { locale: Locale; country: string } {
  const str = (k: string) => (typeof qs[k] === 'string' ? (qs[k] as string).trim() : undefined);
  const locale = (str('locale') || 'en') as Locale;
  if (!LOCALES.includes(locale)) throw new BadRequest(`unsupported locale; use one of ${LOCALES.join(',')}`);
  const country = (str('country') || 'US').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new BadRequest('country must be an ISO 3166-1 alpha-2 code');
  return { locale, country };
}

export function parseSearchQuery(qs: Record<string, unknown>): SearchParams {
  const str = (k: string) => (typeof qs[k] === 'string' ? (qs[k] as string).trim() : undefined);
  const { locale, country } = parseLocaleCountry(qs);
  const sort = (str('sort') || 'relevance') as SearchSort;
  if (!SORTS.includes(sort)) throw new BadRequest(`sort must be one of ${SORTS.join('|')}`);
  return {
    // Cap very long input: protects the regex parser and the AI call.
    q: (str('q') ?? '').slice(0, MAX_QUERY_LENGTH),
    locale,
    country,
    category: str('category') || undefined,
    min_price: num(qs.min_price, 'min_price', { min: 0 }),
    max_price: num(qs.max_price, 'max_price', { min: 0 }),
    max_days: num(qs.max_days, 'max_days', { min: 1 }),
    min_rating: num(qs.min_rating, 'min_rating', { min: 0 }),
    ships_from: parseCountryList(str('ships_from'), 'ships_from'),
    sort,
    page: num(qs.page, 'page', { int: true, min: 1 }) ?? 1,
    per_page: Math.min(100, num(qs.per_page, 'per_page', { int: true, min: 1 }) ?? 20),
  };
}

/** "CN,ke" -> ["CN","KE"]; undefined when empty. */
function parseCountryList(v: string | undefined, name: string): string[] | undefined {
  if (!v) return undefined;
  const list = [...new Set(v.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return undefined;
  if (list.some((c) => !/^[A-Z]{2}$/.test(c))) throw new BadRequest(`${name} must be comma-separated ISO alpha-2 codes`);
  return list;
}

export interface AppMeta {
  engine: () => string;
  documents: () => Record<string, number>;
  aiMode: 'ai' | 'rules';
}

export function buildApp(service: SearchService, meta: AppMeta, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  // Browser callers (apps/web) may hit this API directly in development.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('access-control-allow-origin', '*');
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'search',
    engine: meta.engine(),
    query_understanding: meta.aiMode,
    documents: meta.documents(),
  }));

  app.get('/search', async (req, reply) => {
    const qs = req.query as Record<string, unknown>;
    let params: SearchParams;
    try {
      params = parseSearchQuery(qs);
    } catch (err) {
      if (err instanceof BadRequest) return reply.code(400).send({ error: err.message });
      throw err;
    }
    const debug = qs.debug === '1' || qs.debug === 'true';
    return service.search(params, { debug });
  });

  app.get('/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    let lc: { locale: Locale; country: string };
    try {
      if (!id || id.length > 100) throw new BadRequest('invalid product id');
      lc = parseLocaleCountry(req.query as Record<string, unknown>);
    } catch (err) {
      if (err instanceof BadRequest) return reply.code(400).send({ error: err.message });
      throw err;
    }
    const hit = await service.product(id, lc.locale, lc.country);
    if (!hit) return reply.code(404).send({ error: 'product not found or not shippable to this country' });
    return hit;
  });

  return app;
}
