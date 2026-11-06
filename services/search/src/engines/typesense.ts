import Typesense from 'typesense';
import type { Config } from '../config';
import { LOCALES, type EngineQuery, type EngineResult, type IndexedDocument, type SearchEngine } from '../types';
import { COLLECTION, collectionSchema } from '../schema';
import { RELEVANCE_BUCKETS } from '../ranking';
import { PRICE_BUCKETS } from '../money';

export type TsClient = InstanceType<typeof Typesense.Client>;

export function typesenseClient(cfg: Config['typesense'], timeoutSeconds = 3): TsClient {
  return new Typesense.Client({
    nodes: [{ host: cfg.host, port: cfg.port, protocol: cfg.protocol }],
    apiKey: cfg.apiKey,
    connectionTimeoutSeconds: timeoutSeconds,
    numRetries: 1,
    logLevel: 'warn',
  });
}

export async function typesenseHealthy(client: TsClient): Promise<boolean> {
  try {
    const h = (await client.health.retrieve()) as { ok?: boolean };
    return !!h.ok;
  } catch {
    return false;
  }
}

const esc = (v: string) => '`' + v.replace(/`/g, '') + '`';
const cc2 = (c: string) => c.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);

/** Range-facet labels must be simple identifiers; map them back to bucket labels. */
const RANGE_LABELS = PRICE_BUCKETS.map((b, i) => ({ id: `p${i}`, label: b.label, min: i ? PRICE_BUCKETS[i - 1].max : 0, max: b.max }));

/** Field names for a country: per-country fields when active, global fields otherwise. */
export function countryFieldNames(country: string, active: Set<string>) {
  const cc = cc2(country);
  const isActive = active.has(cc);
  return {
    cc,
    isActive,
    price: isActive ? `cprice_${cc}` : 'min_price_usd',
    days: isActive ? `cdmax_${cc}` : 'best_dmax',
    sell: isActive ? `csell_${cc}` : 'sell_global',
  };
}

export function buildSearchParams(q: EngineQuery, active: Set<string>): Record<string, string | number | boolean> {
  const f = countryFieldNames(q.country, active);
  const filters = [f.isActive ? `${f.price}:>0` : `ships_to:=[${f.cc}]`];
  if (q.category) filters.push(`category_slugs:=${esc(q.category)}`);
  if (q.min_price != null) filters.push(`${f.price}:>=${q.min_price}`);
  if (q.max_price != null) filters.push(`${f.price}:<=${q.max_price}`);
  if (q.max_days != null) filters.push(`${f.days}:<=${Math.floor(q.max_days)}`);
  if (q.min_rating != null) filters.push(`rating_sort:>=${q.min_rating}`);
  if (q.ships_from?.length) filters.push(`offer_ships_from:=[${q.ships_from.map(cc2).filter(Boolean).join(',')}]`);

  const text = q.q.trim() || '*';
  const sortBy: Record<EngineQuery['sort'], string> = {
    relevance: text === '*' ? `${f.sell}:desc` : `_text_match(buckets: ${RELEVANCE_BUCKETS}):desc,${f.sell}:desc`,
    price_asc: `${f.price}:asc,_text_match:desc`,
    fastest: `${f.days}:asc,${f.sell}:desc`,
    rating: 'rating_sort:desc,review_count:desc',
  };
  const l = q.locale;
  const queryBy =
    l === 'en'
      ? { by: 'title,brand,category_terms,bullets,description', w: '6,4,4,2,1' }
      : { by: `title_${l},title,brand,category_terms,description_${l},description,bullets`, w: '7,6,4,4,2,1,1' };
  // Don't ship other locales' text or ranking fields back over the wire.
  const exclude = [
    'bullets',
    'category_terms',
    ...LOCALES.filter((x) => x !== 'en' && x !== l).flatMap((x) => [`title_${x}`, `description_${x}`]),
  ];
  const priceRanges = RANGE_LABELS.map((r) => `${r.id}:[${r.min},${Number.isFinite(r.max) ? r.max : ''}]`).join(',');
  return {
    q: text,
    query_by: queryBy.by,
    query_by_weights: queryBy.w,
    filter_by: filters.join(' && '),
    sort_by: sortBy[q.sort],
    facet_by: `category_slugs,source_kinds,offer_ships_from,rating_bucket,${f.price}(${priceRanges})`,
    max_facet_values: 20,
    page: q.page,
    per_page: q.per_page,
    num_typos: 1,
    prefix: true,
    drop_tokens_threshold: 10,
    exclude_fields: exclude.join(','),
  };
}

export class TypesenseEngine implements SearchEngine {
  readonly name = 'typesense' as const;
  constructor(
    readonly client: TsClient,
    private active: Set<string>,
    private collection = COLLECTION,
  ) {}

  async search(q: EngineQuery): Promise<EngineResult> {
    const f = countryFieldNames(q.country, this.active);
    const params = buildSearchParams(q, this.active);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await this.client.collections(this.collection).documents().search(params as any);
    const names: Record<string, string> = {
      category_slugs: 'category_slug',
      source_kinds: 'source_kind',
      offer_ships_from: 'ships_from',
      rating_bucket: 'rating',
      [f.price]: 'price_bucket',
    };
    const facets: EngineResult['facets'] = {};
    for (const fc of res.facet_counts ?? []) {
      const key = names[fc.field_name];
      if (!key) continue;
      facets[key] = (fc.counts ?? []).map((c: { value: string; count: number }) => ({
        value: key === 'price_bucket' ? RANGE_LABELS.find((r) => r.id === c.value)?.label ?? c.value : c.value,
        count: c.count,
      }));
    }
    return {
      docs: (res.hits ?? []).map((h: { document: IndexedDocument }) => h.document),
      found: res.found ?? 0,
      facets,
    };
  }

  async getById(id: string): Promise<IndexedDocument | null> {
    try {
      return (await this.client.collections(this.collection).documents(id).retrieve()) as unknown as IndexedDocument;
    } catch (err) {
      if ((err as { httpStatus?: number }).httpStatus === 404) return null;
      throw err;
    }
  }
}

export async function ensureCollection(client: TsClient, opts: { recreate?: boolean; name?: string } = {}): Promise<void> {
  const name = opts.name ?? COLLECTION;
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
  if (!exists) await client.collections().create(collectionSchema(name) as any);
}

export interface ImportLineResult {
  success: boolean;
  error?: string;
  document?: string;
}

/** JSONL bulk upsert of one batch; returns one result per line. */
export function typesenseImporter(client: TsClient, name = COLLECTION) {
  return async (jsonl: string): Promise<ImportLineResult[]> => {
    const out: unknown = await client
      .collections(name)
      .documents()
      .import(jsonl, { action: 'upsert' })
      .catch((err: { importResults?: unknown }) => {
        // Per-document failures surface as an ImportError carrying the results.
        if (err.importResults) return err.importResults;
        throw err;
      });
    if (Array.isArray(out)) return out as ImportLineResult[];
    return String(out)
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ImportLineResult);
  };
}

/** Remove documents (products deleted or deactivated). Missing ids are ignored. */
export async function deleteFromTypesense(client: TsClient, ids: string[], name = COLLECTION): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await client.collections(name).documents().delete({ filter_by: `id:[${chunk.map(esc).join(',')}]` } as any);
    deleted += Number(res?.num_deleted ?? 0);
  }
  return deleted;
}
