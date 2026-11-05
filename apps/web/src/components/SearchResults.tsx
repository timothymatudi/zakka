import { getTranslations } from 'next-intl/server';
import type { Locale, SearchSort } from '@shared/types';
import { Link } from '@/i18n/navigation';
import type { Market } from '@/lib/markets';
import { search } from '@/lib/search';
import { regionName, whatsappLink } from '@/lib/format';
import { CATEGORIES } from '@/lib/mock/catalog';
import { ProductCard } from './ProductCard';

export type RawParams = Record<string, string | string[] | undefined>;

const SORTS: SearchSort[] = ['relevance', 'price_asc', 'fastest', 'rating'];
const DAY_OPTIONS = [3, 5, 7, 14];
const RATING_OPTIONS = [4, 4.5];

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}
function num(v: string | string[] | undefined): number | undefined {
  const s = one(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function SearchResults({
  sp,
  locale,
  market,
  fixedCategory,
  basePath,
}: {
  sp: RawParams;
  locale: Locale;
  market: Market;
  fixedCategory?: string;
  basePath: string;
}) {
  const t = await getTranslations('search');
  const tc = await getTranslations('categories');
  const tw = await getTranslations('whatsapp');

  const q = one(sp.q) ?? '';
  const category = fixedCategory ?? one(sp.category);
  const minLocal = num(sp.min);
  const maxLocal = num(sp.max);
  const maxDays = num(sp.max_days);
  const minRating = num(sp.rating);
  const shipsFrom = one(sp.from)?.toUpperCase().slice(0, 2);
  const sortRaw = one(sp.sort) as SearchSort | undefined;
  const sort: SearchSort = sortRaw && SORTS.includes(sortRaw) ? sortRaw : 'relevance';
  const page = Math.max(1, Math.floor(num(sp.page) ?? 1));

  // The price filter is typed in local currency; the search API filters in USD.
  const toUsd = (v?: number) => (v == null ? undefined : Math.round((v / market.rate) * 100) / 100);

  const res = await search({
    q,
    locale,
    country: market.country,
    category,
    min_price: toUsd(minLocal),
    max_price: toUsd(maxLocal),
    max_days: maxDays,
    min_rating: minRating,
    ships_from: shipsFrom,
    sort,
    page,
    per_page: 24,
  });
  const pages = Math.max(1, Math.ceil(res.found / res.per_page));
  // Facet values may be display names (live) or slugs (mock); only slugs can drive the category filter.
  const catFacet = (res.facets.category_path ?? []).filter((f) => CATEGORIES.some((c) => c.slug === f.value));
  const fromFacet = res.facets.ships_from ?? [];

  const current: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const s = one(v);
    if (s && k !== 'page') current[k] = s;
  }
  const pageHref = (p: number) => ({ pathname: basePath, query: { ...current, page: String(p) } });

  const filters = (
    <form method="get" action={`/${locale}${basePath}`} className="space-y-5 text-sm">
      {q && <input type="hidden" name="q" value={q} />}
      <input type="hidden" name="sort" value={sort} />
      {!fixedCategory && (
        <fieldset>
          <legend className="mb-1.5 font-bold">{t('category')}</legend>
          <select name="category" defaultValue={category ?? ''} className="field">
            <option value="">{t('any')}</option>
            {CATEGORIES.map((c) => {
              const count = catFacet.find((f) => f.value === c.slug)?.count;
              return (
                <option key={c.slug} value={c.slug}>
                  {tc(c.slug)}
                  {count != null ? ` (${count})` : ''}
                </option>
              );
            })}
          </select>
        </fieldset>
      )}
      <fieldset>
        <legend className="mb-1.5 font-bold">{t('price', { currency: market.currency })}</legend>
        <div className="flex gap-2">
          <input name="min" type="number" inputMode="decimal" min={0} placeholder={t('min')} defaultValue={minLocal} className="field" aria-label={t('min')} />
          <input name="max" type="number" inputMode="decimal" min={0} placeholder={t('max')} defaultValue={maxLocal} className="field" aria-label={t('max')} />
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 font-bold">{t('delivery')}</legend>
        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input type="radio" name="max_days" value="" defaultChecked={maxDays == null} className="accent-teal" />
            {t('any')}
          </label>
          {DAY_OPTIONS.map((d) => (
            <label key={d} className="flex items-center gap-2">
              <input type="radio" name="max_days" value={d} defaultChecked={maxDays === d} className="accent-teal" />
              {t('withinDays', { days: d })}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 font-bold">{t('rating')}</legend>
        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input type="radio" name="rating" value="" defaultChecked={minRating == null} className="accent-teal" />
            {t('any')}
          </label>
          {RATING_OPTIONS.map((r) => (
            <label key={r} className="flex items-center gap-2">
              <input type="radio" name="rating" value={r} defaultChecked={minRating === r} className="accent-teal" />
              {t('ratingMin', { rating: r })}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 font-bold">{t('shipsFrom')}</legend>
        <select name="from" defaultValue={shipsFrom ?? ''} className="field">
          <option value="">{t('any')}</option>
          {fromFacet.map((f) => (
            <option key={f.value} value={f.value}>
              {regionName(f.value, locale)} ({f.count})
            </option>
          ))}
        </select>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary flex-1">
          {t('apply')}
        </button>
        <Link href={{ pathname: basePath, query: q ? { q } : {} }} className="btn btn-outline">
          {t('clear')}
        </Link>
      </div>
    </form>
  );

  return (
    <div className="md:grid md:grid-cols-[15rem_1fr] md:gap-8">
      <aside className="hidden md:block">
        <h2 className="mb-3 text-lg font-extrabold">{t('filters')}</h2>
        {filters}
      </aside>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            {t('found', { count: res.found })}
            {res.source === 'mock' && <span className="ms-2 rounded-full bg-sand px-2 py-0.5 text-xs">{t('sampleData')}</span>}
          </p>
          <nav aria-label={t('sort')} className="flex flex-wrap gap-1.5">
            {SORTS.map((s) => {
              const label = { relevance: t('sortRelevance'), price_asc: t('sortPrice'), fastest: t('sortFastest'), rating: t('sortRating') }[s];
              const active = s === sort;
              return (
                <Link
                  key={s}
                  href={{ pathname: basePath, query: { ...current, sort: s } }}
                  aria-current={active ? 'true' : undefined}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${active ? 'bg-ink text-white' : 'bg-white ring-1 ring-line hover:ring-teal'}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <details className="card mb-4 p-3 md:hidden">
          <summary className="cursor-pointer font-bold">{t('filters')}</summary>
          <div className="mt-3">{filters}</div>
        </details>

        {!fixedCategory && catFacet.length > 1 && !category && (
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
            {catFacet.map((f) => (
              <Link
                key={f.value}
                href={{ pathname: basePath, query: { ...current, category: f.value } }}
                className="shrink-0 rounded-full bg-teal-soft px-3 py-1 text-xs font-semibold text-teal"
              >
                {tc(f.value)} · {f.count}
              </Link>
            ))}
          </div>
        )}

        {res.hits.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-lg font-bold">{t('noResults')}</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t('noResultsHint')}</p>
            <a href={whatsappLink(q ? `${tw('prefill')} ${q}` : tw('prefill'))} target="_blank" rel="noopener noreferrer" className="btn mt-4 bg-wa text-white">
              {tw('chat')}
            </a>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {res.hits.map((d) => (
              <li key={d.id}>
                <ProductCard doc={d} market={market} locale={locale} />
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-3 text-sm font-semibold" aria-label="pagination">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="btn btn-outline py-1.5">
                {t('prev')}
              </Link>
            )}
            <span>{t('page', { page, pages })}</span>
            {page < pages && (
              <Link href={pageHref(page + 1)} className="btn btn-outline py-1.5">
                {t('next')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
