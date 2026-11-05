// Loads products, translations and offers from Postgres (DATABASE_URL) and
// produces RawProduct rows for one locale.
//
// Price resolution per offer, in order (search never applies markup):
//   1. the catalog API: GET /offers/{id}/price?country=<first ships_to> (price_usd)
//   2. offers.display_price_usd, if the catalog has written that column (contract request)
//   3. affiliate offers only: list_price_usd + shipping_usd (the contract's no-markup rule)
//   otherwise the offer is skipped and a warning is logged.
import pg from 'pg';
import type { Locale, RawProduct, SearchOffer, SourceCode, SourceKind } from '../types';
import type { PriceLookup } from './catalog-prices';

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

export async function loadFxFromDb(databaseUrl: string): Promise<Record<string, number> | null> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    const { rows } = await client.query(`select quote, rate::float8 as rate from fx_rates where base = 'USD'`);
    return Object.fromEntries(rows.map((r) => [String(r.quote).trim(), Number(r.rate)]));
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function loadCurrencyDecimalsFromDb(databaseUrl: string): Promise<Record<string, number> | null> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    const { rows } = await client.query(`select code, decimals from currencies`);
    return Object.fromEntries(rows.map((r) => [String(r.code).trim(), Number(r.decimals)]));
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function loadRawProductsFromDb(
  databaseUrl: string,
  locale: Locale,
  prices: PriceLookup,
): Promise<RawProduct[]> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const hasDisplayCol =
      (
        await client.query(
          `select 1 from information_schema.columns where table_name = 'offers' and column_name = 'display_price_usd'`,
        )
      ).rowCount! > 0;

    // Categories with localized names (fallback en, then slug).
    const cats = await client.query(
      `select c.id, c.parent_id, c.slug, coalesce(t.name, te.name, c.slug) as name
         from categories c
         left join category_translations t  on t.category_id = c.id and t.locale = $1
         left join category_translations te on te.category_id = c.id and te.locale = 'en'`,
      [locale],
    );
    const catById = new Map(cats.rows.map((r) => [r.id as string, r]));
    const chainCache = new Map<string, { ids: string[]; slugs: string[]; names: string[] }>();
    const chain = (id: string | null) => {
      if (!id) return { ids: [], slugs: [], names: [] };
      if (chainCache.has(id)) return chainCache.get(id)!;
      const ids: string[] = [], slugs: string[] = [], names: string[] = [];
      let cur = catById.get(id);
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        ids.unshift(cur.id); slugs.unshift(cur.slug); names.unshift(cur.name);
        cur = cur.parent_id ? catById.get(cur.parent_id) : undefined;
      }
      const r = { ids, slugs, names };
      chainCache.set(id, r);
      return r;
    };

    const products = await client.query(
      `select p.id, p.category_id, p.brand, p.image_urls, p.rating::float8 as rating, p.review_count,
              coalesce(t.title, te.title) as title,
              coalesce(t.description, te.description, '') as description,
              coalesce(t.bullet_points, te.bullet_points, '{}') as bullet_points
         from products p
         left join product_translations t  on t.product_id = p.id and t.locale = $1
         left join product_translations te on te.product_id = p.id and te.locale = 'en'
        where p.is_active and coalesce(t.title, te.title) is not null`,
      [locale],
    );

    // Recent demand signal: affiliate clicks + ordered quantity in the last 90 days.
    const events = await client.query(
      `select product_id, sum(n)::int as n from (
          select o.product_id, count(*) as n
            from affiliate_clicks c join offers o on o.id = c.offer_id
           where c.clicked_at > now() - interval '90 days' group by o.product_id
          union all
          select oi.product_id, sum(oi.qty) as n
            from order_items oi join orders od on od.id = oi.order_id
           where od.created_at > now() - interval '90 days' and od.status not in ('cancelled', 'refunded')
           group by oi.product_id
       ) x group by product_id`,
    );
    const eventsByProduct = new Map(events.rows.map((r) => [r.product_id as string, Number(r.n)]));

    const offers = await client.query(
      `select o.id, o.product_id, o.url, o.list_price_usd::float8 as list_price_usd,
              o.shipping_usd::float8 as shipping_usd, o.ships_from, o.ships_to,
              o.delivery_days_min, o.delivery_days_max, o.stock,
              ${hasDisplayCol ? 'o.display_price_usd::float8' : 'null::float8'} as display_price_usd,
              s.code as source_code, s.kind
         from offers o join sources s on s.id = o.source_id
        where o.is_active and s.is_active and (o.stock is null or o.stock > 0)`,
    );

    const resolved = await mapLimit(offers.rows, 8, async (o): Promise<[string, SearchOffer] | null> => {
      const shipsTo: string[] = (o.ships_to ?? []).map((c: string) => c.trim().toUpperCase());
      if (!shipsTo.length) return null;
      let price = await prices.priceUsd(o.id, shipsTo[0]);
      if (price == null) price = num(o.display_price_usd);
      if (price == null && o.kind === 'affiliate' && o.list_price_usd != null) {
        price = Number(o.list_price_usd) + Number(o.shipping_usd ?? 0);
      }
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

    return products.rows.map((p) => {
      const c = chain(p.category_id);
      return {
        id: p.id,
        locale,
        title: p.title,
        description: p.description ?? '',
        bullet_points: p.bullet_points ?? [],
        brand: p.brand ?? null,
        category_path: c.names,
        category_ids: c.ids,
        category_slugs: c.slugs,
        image: p.image_urls?.[0] ?? null,
        rating: num(p.rating),
        review_count: Number(p.review_count ?? 0),
        popularity: popularityFrom(Number(p.review_count ?? 0), eventsByProduct.get(p.id) ?? 0),
        offers: offersByProduct.get(p.id) ?? [],
      };
    });
  } finally {
    await client.end();
  }
}
