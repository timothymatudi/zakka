import 'server-only';
import { hasSupabase } from './config';
import { dbCount, dbInsert, dbSelect, dbWrite } from './db';
import { mockClickCount } from './clicks';
import { getMockRules, setMockRules, type MarkupRule } from './mock/admin';
import { CATEGORIES, PRODUCTS, SOURCES, SOURCE_NAME } from './mock/catalog';
import { config } from './config';

/**
 * Admin reads and writes. Live (Supabase service role) when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are set, otherwise the local mock catalog. Only server code that has checked the admin role calls this.
 */
export const adminIsLive = () => hasSupabase();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- markup rules ---------------------------------------------------------------------------------

export async function getMarkupRules(): Promise<MarkupRule[]> {
  if (!adminIsLive()) return getMockRules();
  const rows = await dbSelect<MarkupRule>('markup_rules', 'select=id,scope,scope_id,percent,fixed_usd,round_to,priority,is_active&order=priority.desc,scope.asc');
  return (rows ?? []).map((r) => ({
    ...r,
    percent: Number(r.percent),
    fixed_usd: Number(r.fixed_usd),
    round_to: Number(r.round_to),
  }));
}

/**
 * Replaces the rule set with `rules`: updates rules that have a uuid, inserts new ones, and deletes
 * the rules that were removed in the editor. Returns false if any step failed.
 */
export async function saveMarkupRules(rules: MarkupRule[]): Promise<boolean> {
  if (!adminIsLive()) {
    setMockRules(rules);
    return true;
  }
  const existing = await dbSelect<{ id: string }>('markup_rules', 'select=id');
  if (!existing) return false;
  const row = (r: MarkupRule) => ({
    scope: r.scope,
    scope_id: r.scope === 'global' ? null : r.scope_id,
    percent: r.percent,
    fixed_usd: r.fixed_usd,
    round_to: r.round_to,
    priority: r.priority,
    is_active: r.is_active,
  });
  const keep = rules.filter((r) => UUID_RE.test(r.id) && existing.some((e) => e.id === r.id));
  const added = rules.filter((r) => !keep.includes(r));
  for (const r of keep) {
    if (!(await dbWrite('PATCH', 'markup_rules', `id=eq.${r.id}`, row(r)))) return false;
  }
  if (added.length && !(await dbInsert('markup_rules', added.map(row)))) return false;
  const removed = existing.filter((e) => !keep.some((r) => r.id === e.id)).map((e) => e.id);
  if (removed.length && !(await dbWrite('DELETE', 'markup_rules', `id=in.(${removed.join(',')})`))) return false;
  return true;
}

export interface Target {
  id: string;
  label: string;
}

/** Choices for the markup editor's scope picker. Category labels are slugs; the page translates mock ones. */
export async function getMarkupTargets(): Promise<{ category: Target[]; source: Target[]; product: Target[]; translateCategories: boolean }> {
  if (!adminIsLive()) {
    return {
      category: CATEGORIES.map((c) => ({ id: c.id, label: c.slug })),
      source: SOURCES.filter((s) => s.kind === 'dropship').map((s) => ({ id: s.id, label: s.name })),
      product: PRODUCTS.map((p) => ({ id: p.id, label: p.title })),
      translateCategories: true,
    };
  }
  const [cats, sources, products] = await Promise.all([
    dbSelect<{ id: string; slug: string; category_translations: { name: string }[] }>(
      'categories',
      'select=id,slug,category_translations(name)&category_translations.locale=eq.en&order=sort.asc,slug.asc&limit=2000',
    ),
    dbSelect<{ id: string; name: string }>('sources', 'select=id,name&kind=eq.dropship&order=name.asc'),
    dbSelect<{ id: string; product_translations: { title: string }[] }>(
      'products',
      'select=id,product_translations(title)&product_translations.locale=eq.en&is_active=eq.true&order=updated_at.desc&limit=500',
    ),
  ]);
  return {
    category: (cats ?? []).map((c) => ({ id: c.id, label: c.category_translations?.[0]?.name ?? c.slug })),
    source: (sources ?? []).map((s) => ({ id: s.id, label: s.name })),
    product: (products ?? []).map((p) => ({ id: p.id, label: p.product_translations?.[0]?.title ?? p.id })),
    translateCategories: false,
  };
}

// ---- sources, products, dashboard ------------------------------------------------------------------

export interface AdminSource {
  id: string;
  code: string;
  name: string;
  kind: 'dropship' | 'affiliate';
  is_active: boolean;
  offers: number;
}

export async function getSources(): Promise<AdminSource[]> {
  if (!adminIsLive()) {
    return SOURCES.map((s) => ({
      ...s,
      offers: PRODUCTS.reduce((n, p) => n + p.offers.filter((o) => o.source_code === s.code).length, 0),
    }));
  }
  // Explicit columns: never read sources.config here.
  const rows = await dbSelect<Omit<AdminSource, 'offers'> & { offers: { count: number }[] }>(
    'sources',
    'select=id,code,name,kind,is_active,offers(count)&order=code.asc',
  );
  return (rows ?? []).map((r) => ({ ...r, offers: r.offers?.[0]?.count ?? 0 }));
}

export interface AdminProduct {
  id: string;
  title: string;
  category: string | null;
  sources: string[];
  min_price_usd: number | null;
  rating: number | null;
}

export async function getProducts(limit = 100): Promise<{ rows: AdminProduct[]; categoryIsSlug: boolean }> {
  if (!adminIsLive()) {
    return {
      categoryIsSlug: true,
      rows: PRODUCTS.slice(0, limit).map((p) => ({
        id: p.id,
        title: `${p.icon} ${p.title}`,
        category: p.category_slug,
        sources: p.offers.map((o) => `${SOURCE_NAME[o.source_code]} (${o.kind === 'affiliate' ? 'aff' : 'ds'})`),
        min_price_usd: p.min_price_usd,
        rating: p.rating ?? null,
      })),
    };
  }
  type Row = {
    id: string;
    rating: number | null;
    categories: { slug: string } | null;
    product_translations: { title: string }[];
    offers: { kind?: string; display_price_usd: number | null; sources: { code: string; kind: string } | null }[];
  };
  const rows = await dbSelect<Row>(
    'products',
    'select=id,rating,categories(slug),product_translations(title),offers(display_price_usd,sources(code,kind))' +
      `&product_translations.locale=eq.en&offers.is_active=eq.true&is_active=eq.true&order=updated_at.desc&limit=${limit}`,
  );
  return {
    categoryIsSlug: true,
    rows: (rows ?? []).map((r) => {
      const prices = r.offers.map((o) => Number(o.display_price_usd)).filter((n) => Number.isFinite(n) && n > 0);
      return {
        id: r.id,
        title: r.product_translations?.[0]?.title ?? r.id,
        category: r.categories?.slug ?? null,
        sources: r.offers.map((o) => (o.sources ? `${o.sources.code} (${o.sources.kind === 'affiliate' ? 'aff' : 'ds'})` : '?')),
        min_price_usd: prices.length ? Math.min(...prices) : null,
        rating: r.rating == null ? null : Number(r.rating),
      };
    }),
  };
}

export interface DashboardCounts {
  clicks: number;
  products: number;
  offers: number;
  sources: number;
  clicksLabel: 'session' | 'all';
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  if (!adminIsLive()) {
    return {
      clicks: mockClickCount(),
      products: PRODUCTS.length,
      offers: PRODUCTS.reduce((n, p) => n + p.offers.length, 0),
      sources: SOURCES.filter((s) => s.is_active).length,
      clicksLabel: 'session',
    };
  }
  const [clicks, products, offers, sources] = await Promise.all([
    dbCount('affiliate_clicks'),
    dbCount('products', 'is_active=eq.true'),
    dbCount('offers', 'is_active=eq.true'),
    dbCount('sources', 'is_active=eq.true'),
  ]);
  return { clicks: clicks ?? 0, products: products ?? 0, offers: offers ?? 0, sources: sources ?? 0, clicksLabel: 'all' };
}

// ---- worldwide coverage ----------------------------------------------------------------------------

export interface StoreCoverage {
  code: string;
  name: string;
  kind: 'dropship' | 'affiliate';
  is_active: boolean;
  products: number;
  offers: number;
  origins: string[];
  destinations: number;
  last_synced_at: string | null;
}

export interface CountryCoverage {
  country_code: string;
  stores: number;
  products: number;
  offers?: number;
  fastest_days?: number | null;
}

export interface Coverage {
  stores: StoreCoverage[];
  origins: CountryCoverage[];
  destinations: CountryCoverage[];
}

async function rpc<T>(fn: string): Promise<T[] | null> {
  if (!config.supabaseUrl) return null;
  return dbWrite<T>('POST', `rpc/${fn}`, '', {}, 'return=representation');
}

/** Where our products come from (stores and ship-from countries) and which countries they reach. */
export async function getCoverage(): Promise<Coverage> {
  if (adminIsLive()) {
    const [stores, origins, destinations] = await Promise.all([
      rpc<{
        code: string;
        name: string;
        kind: 'dropship' | 'affiliate';
        is_active: boolean;
        products: number;
        offers: number;
        origin_countries: string[];
        destination_countries: number;
        last_synced_at: string | null;
      }>('admin_source_coverage'),
      rpc<CountryCoverage>('admin_origin_coverage'),
      rpc<CountryCoverage>('admin_destination_coverage'),
    ]);
    return {
      stores: (stores ?? []).map((s) => ({
        code: s.code,
        name: s.name,
        kind: s.kind,
        is_active: s.is_active,
        products: Number(s.products),
        offers: Number(s.offers),
        origins: s.origin_countries ?? [],
        destinations: Number(s.destination_countries),
        last_synced_at: s.last_synced_at,
      })),
      origins: (origins ?? []).map((o) => ({ ...o, stores: Number(o.stores), products: Number(o.products), offers: Number(o.offers) })),
      destinations: (destinations ?? []).map((d) => ({ ...d, stores: Number(d.stores), products: Number(d.products) })),
    };
  }

  // Mock: aggregate the local catalog the same way the SQL functions do.
  const stores = SOURCES.map((s) => {
    const offers = PRODUCTS.flatMap((p) => p.offers.filter((o) => o.source_code === s.code).map((o) => ({ ...o, product_id: p.id })));
    return {
      code: s.code,
      name: s.name,
      kind: s.kind,
      is_active: s.is_active,
      products: new Set(offers.map((o) => o.product_id)).size,
      offers: offers.length,
      origins: [...new Set(offers.map((o) => o.ships_from).filter(Boolean) as string[])].sort(),
      destinations: new Set(offers.flatMap((o) => o.ships_to)).size,
      last_synced_at: null,
    };
  }).sort((a, b) => b.offers - a.offers || a.code.localeCompare(b.code));

  const byCountry = (pick: (o: (typeof PRODUCTS)[number]['offers'][number]) => string[]) => {
    const m = new Map<string, { stores: Set<string>; products: Set<string>; offers: number; fastest: number | null }>();
    for (const p of PRODUCTS) {
      for (const o of p.offers) {
        for (const c of pick(o)) {
          const e = m.get(c) ?? { stores: new Set(), products: new Set(), offers: 0, fastest: null };
          e.stores.add(o.source_code);
          e.products.add(p.id);
          e.offers += 1;
          if (o.delivery_days_min != null) e.fastest = e.fastest == null ? o.delivery_days_min : Math.min(e.fastest, o.delivery_days_min);
          m.set(c, e);
        }
      }
    }
    return [...m.entries()].map(([country_code, e]) => ({
      country_code,
      stores: e.stores.size,
      products: e.products.size,
      offers: e.offers,
      fastest_days: e.fastest,
    }));
  };

  return {
    stores,
    origins: byCountry((o) => (o.ships_from ? [o.ships_from] : [])).sort((a, b) => b.offers - a.offers),
    destinations: byCountry((o) => o.ships_to).sort((a, b) => b.products - a.products),
  };
}
