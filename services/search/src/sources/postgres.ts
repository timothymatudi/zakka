// Streams products (all translations), categories and offers from Postgres
// (DATABASE_URL) in keyset-paginated pages, so 1M+ products never sit in memory.
//
// Price resolution per offer, in order (search never applies markup):
//   1. offers.display_price_usd, written by the catalog (migration 0005)
//   2. the catalog API: GET /offers/{id}/price?country=<first ships_to> (price_usd)
//   3. affiliate offers only: list_price_usd + shipping_usd (the contract's no-markup rule)
//   otherwise the offer is skipped and a warning is logged.
import pg from 'pg';
import { LOCALES, type Locale, type RawCategory, type RawProduct, type SearchOffer, type SourceCode, type SourceKind, type Translation } from '../types';
import type { PriceLookup } from './catalog-prices';
import { CategoryDirectory } from '../categories';

const num = (v: unknown): number | null => (v == null ? null : Number(v));

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export function popularityFrom(reviewCount: number, recentEvents: number): number {
  const r = Math.min(1, Math.log10(1 + Math.max(0, reviewCount)) / 4); // 10k reviews -> 1
  const e = Math.min(1, Math.log10(1 + Math.max(0, recentEvents)) / 3); // 1k clicks/orders -> 1
  return Math.round((0.5 * r + 0.5 * e) * 1000) / 1000;
}

async function withClient<T>(databaseUrl: string, fn: (c: pg.Client) => Promise<T>, timeoutMs = 5000): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: timeoutMs });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function tryDb<T>(databaseUrl: string, fn: (c: pg.Client) => Promise<T>): Promise<T | null> {
  try {
    return await withClient(databaseUrl, fn, 3000);
  } catch {
    return null;
  }
}

export const loadFxFromDb = (url: string) =>
  tryDb(url, async (c) => {
    const { rows } = await c.query(`select quote, rate::float8 as rate from fx_rates where base = 'USD'`);
    return Object.fromEntries(rows.map((r) => [String(r.quote).trim(), Number(r.rate)])) as Record<string, number>;
  });

export const loadCurrencyDecimalsFromDb = (url: string) =>
  tryDb(url, async (c) => {
    const { rows } = await c.query(`select code, decimals from currencies`);
    return Object.fromEntries(rows.map((r) => [String(r.code).trim(), Number(r.decimals)])) as Record<string, number>;
  });

export const loadActiveCountriesFromDb = (url: string) =>
  tryDb(url, async (c) => {
    const { rows } = await c.query(`select code from countries where is_active order by code`);
    return rows.map((r) => String(r.code).trim().toUpperCase());
  });

export async function loadCategoriesFromDb(url: string): Promise<RawCategory[]> {
  return withClient(url, async (c) => {
    const { rows } = await c.query(
      `select c.id, c.parent_id, c.slug, coalesce(jsonb_object_agg(t.locale, t.name) filter (where t.locale is not null), '{}'::jsonb) as names
         from categories c left join category_translations t on t.category_id = c.id
        group by c.id`,
    );
    return rows.map((r) => ({ id: r.id, parent_id: r.parent_id, slug: r.slug, names: r.names ?? {} }));
  });
}

export interface StreamOptions {
  pageSize?: number;
  /** Only these products (incremental reindex). */
  productIds?: string[];
  prices: PriceLookup;
  categories?: CategoryDirectory;
}

/** Async pages of RawProducts, keyset-paginated by product id. Inactive products are skipped. */
export async function* streamRawProductsFromDb(databaseUrl: string, opts: StreamOptions): AsyncGenerator<RawProduct[]> {
  const pageSize = opts.pageSize ?? 2000;
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const dir = opts.categories ?? new CategoryDirectory(await loadCategoriesFromDb(databaseUrl));
    const ids = opts.productIds?.length ? opts.productIds : null;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const products = await client.query(
        `select p.id, p.category_id, p.brand, p.gtin, p.image_urls, p.rating::float8 as rating, p.review_count
           from products p
          where p.is_active and p.id > $1 ${ids ? 'and p.id = any($3::uuid[])' : ''}
          order by p.id limit $2`,
        ids ? [after, pageSize, ids] : [after, pageSize],
      );
      if (!products.rows.length) return;
      after = products.rows[products.rows.length - 1].id;
      const pageIds = products.rows.map((r) => r.id as string);

      const [translations, offers, events] = await Promise.all([
        client.query(
          `select product_id, locale, title, coalesce(description, '') as description, coalesce(bullet_points, '{}') as bullet_points
             from product_translations where product_id = any($1::uuid[])`,
          [pageIds],
        ),
        client.query(
          `select o.id, o.product_id, o.url, o.list_price_usd::float8 as list_price_usd, o.shipping_usd::float8 as shipping_usd,
                  o.ships_from, o.ships_to, o.delivery_days_min, o.delivery_days_max,
                  o.display_price_usd::float8 as display_price_usd, s.code as source_code, s.kind
             from offers o join sources s on s.id = o.source_id
            where o.product_id = any($1::uuid[]) and o.is_active and s.is_active and (o.stock is null or o.stock > 0)`,
          [pageIds],
        ),
        // Recent demand: affiliate clicks + ordered quantity, last 90 days.
        client.query(
          `select product_id, sum(n)::int as n from (
              select o.product_id, count(*) as n from affiliate_clicks c join offers o on o.id = c.offer_id
               where o.product_id = any($1::uuid[]) and c.clicked_at > now() - interval '90 days' group by o.product_id
              union all
              select oi.product_id, sum(oi.qty) as n from order_items oi join orders od on od.id = oi.order_id
               where oi.product_id = any($1::uuid[]) and od.created_at > now() - interval '90 days'
                 and od.status not in ('cancelled', 'refunded') group by oi.product_id
           ) x group by product_id`,
          [pageIds],
        ),
      ]);

      const trByProduct = new Map<string, Partial<Record<Locale, Translation>>>();
      for (const t of translations.rows) {
        if (!LOCALES.includes(t.locale)) continue;
        const m = trByProduct.get(t.product_id) ?? {};
        m[t.locale as Locale] = { title: t.title, description: t.description, bullet_points: t.bullet_points };
        trByProduct.set(t.product_id, m);
      }
      const eventsByProduct = new Map(events.rows.map((r) => [r.product_id as string, Number(r.n)]));

      const resolved = await mapLimit(offers.rows, 8, async (o): Promise<[string, SearchOffer] | null> => {
        const shipsTo: string[] = (o.ships_to ?? []).map((c: string) => c.trim().toUpperCase());
        if (!shipsTo.length) return null;
        let price = num(o.display_price_usd);
        if (price == null) price = await opts.prices.priceUsd(o.id, shipsTo[0]);
        if (price == null && o.kind === 'affiliate' && o.list_price_usd != null) price = Number(o.list_price_usd) + Number(o.shipping_usd ?? 0);
        if (price == null) {
          console.warn(`[indexer] skipping dropship offer ${o.id}: no display_price_usd and catalog unavailable`);
          return null;
        }
        return [
          o.product_id,
          {
            offer_id: o.id,
            source_code: o.source_code as SourceCode,
            kind: o.kind as SourceKind,
            display_price_usd: price,
            delivery_days_min: num(o.delivery_days_min),
            delivery_days_max: num(o.delivery_days_max),
            ships_from: o.ships_from ? String(o.ships_from).trim() : null,
            ships_to: shipsTo,
            url: o.url ?? null,
          },
        ];
      });
      const offersByProduct = new Map<string, SearchOffer[]>();
      for (const r of resolved) {
        if (!r) continue;
        const arr = offersByProduct.get(r[0]) ?? [];
        arr.push(r[1]);
        offersByProduct.set(r[0], arr);
      }

      yield products.rows.map((p) => ({
        id: p.id,
        translations: trByProduct.get(p.id) ?? {},
        brand: p.brand ?? null,
        gtin: p.gtin ?? null,
        categories: dir.chain(p.category_id),
        image: p.image_urls?.[0] ?? null,
        rating: num(p.rating),
        review_count: Number(p.review_count ?? 0),
        popularity: popularityFrom(Number(p.review_count ?? 0), eventsByProduct.get(p.id) ?? 0),
        offers: offersByProduct.get(p.id) ?? [],
      }));
      if (products.rows.length < pageSize) return;
    }
  } finally {
    await client.end().catch(() => {});
  }
}
