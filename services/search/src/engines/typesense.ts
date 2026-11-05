import Typesense from 'typesense';
import type { Config } from '../config';
import type { EngineQuery, EngineResult, IndexedDocument, Locale, SearchEngine } from '../types';
import { collectionName, collectionSchema } from '../schema';
import { RELEVANCE_BUCKETS } from '../ranking';

type Client = InstanceType<typeof Typesense.Client>;

export function typesenseClient(cfg: Config['typesense']): Client {
  return new Typesense.Client({
    nodes: [{ host: cfg.host, port: cfg.port, protocol: cfg.protocol }],
    apiKey: cfg.apiKey,
    connectionTimeoutSeconds: 3,
    numRetries: 1,
    logLevel: 'warn',
  });
}

export async function typesenseHealthy(client: Client): Promise<boolean> {
  try {
    const h = (await client.health.retrieve()) as { ok?: boolean };
    return !!h.ok;
  } catch {
    return false;
  }
}

const esc = (v: string) => '`' + v.replace(/`/g, '') + '`';
const cc2 = (c: string) => c.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);

export function buildSearchParams(q: EngineQuery): Record<string, string | number | boolean> {
  const cc = cc2(q.country);
  const filters = [`cprice_${cc}:>0`];
  if (q.category) {
    const c = esc(q.category);
    filters.push(`(category_slugs:=${c} || category_ids:=${c} || category_path:=${c})`);
  }
  if (q.min_price != null) filters.push(`cprice_${cc}:>=${q.min_price}`);
  if (q.max_price != null) filters.push(`cprice_${cc}:<=${q.max_price}`);
  if (q.max_days != null) filters.push(`cdmax_${cc}:<=${Math.floor(q.max_days)}`);

  const sortBy: Record<EngineQuery['sort'], string> = {
    relevance: `_text_match(buckets: ${RELEVANCE_BUCKETS}):desc,csell_${cc}:desc`,
    price_asc: `cprice_${cc}:asc,_text_match:desc`,
    fastest: `cdays_${cc}:asc,csell_${cc}:desc`,
    rating: 'rating_sort:desc,review_count:desc',
  };
  const text = q.q.trim() || '*';
  return {
    q: text,
    query_by: 'title,brand,category_path,bullets,description',
    query_by_weights: '6,4,4,2,1',
    filter_by: filters.join(' && '),
    sort_by: text === '*' && q.sort === 'relevance' ? `csell_${cc}:desc` : sortBy[q.sort],
    facet_by: `category_path,source_kinds,offer_ships_from,cpbucket_${cc},rating_bucket`,
    max_facet_values: 20,
    page: q.page,
    per_page: q.per_page,
    num_typos: 1,
    prefix: true,
    drop_tokens_threshold: 10,
    exclude_fields: 'bullets',
  };
}

const FACET_NAMES = (cc: string): Record<string, string> => ({
  category_path: 'category_path',
  source_kinds: 'source_kind',
  offer_ships_from: 'ships_from',
  [`cpbucket_${cc}`]: 'price_bucket',
  rating_bucket: 'rating',
});

export class TypesenseEngine implements SearchEngine {
  readonly name = 'typesense' as const;
  constructor(private client: Client) {}

  async search(q: EngineQuery): Promise<EngineResult> {
    const cc = cc2(q.country);
    const params = buildSearchParams(q);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await this.client.collections(collectionName(q.locale)).documents().search(params as any);
    const names = FACET_NAMES(cc);
    const facets: EngineResult['facets'] = {};
    for (const fc of res.facet_counts ?? []) {
      const key = names[fc.field_name];
      if (key) facets[key] = (fc.counts ?? []).map((c: { value: string; count: number }) => ({ value: c.value, count: c.count }));
    }
    return {
      docs: (res.hits ?? []).map((h: { document: IndexedDocument }) => h.document),
      found: res.found ?? 0,
      facets,
    };
  }
}

/** Create (or recreate) the locale collection and upsert documents. */
export async function indexIntoTypesense(
  client: Client,
  locale: Locale,
  docs: IndexedDocument[],
  opts: { recreate?: boolean } = {},
): Promise<{ imported: number; failed: number }> {
  const name = collectionName(locale);
  let exists = true;
  try {
    await client.collections(name).retrieve();
  } catch {
    exists = false;
  }
  if (exists && opts.recreate) {
    await client.collections(name).delete();
    exists = false;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!exists) await client.collections().create(collectionSchema(locale) as any);
  if (!docs.length) return { imported: 0, failed: 0 };
  const imported: unknown = await client
    .collections(name)
    .documents()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .import(docs as any, { action: 'upsert' })
    .catch((err: { importResults?: unknown[] }) => {
      if (err.importResults) return err.importResults;
      throw err;
    });
  const results = (Array.isArray(imported) ? imported : []) as { success: boolean; error?: string }[];
  const failed = results.filter((r) => !r.success);
  for (const f of failed.slice(0, 5)) console.warn(`[typesense] import failed: ${f.error}`);
  return { imported: results.length - failed.length, failed: failed.length };
}
