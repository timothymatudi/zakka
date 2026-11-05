import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { getMarket } from '@/lib/market.server';
import { search } from '@/lib/search';
import { CATEGORIES } from '@/lib/mock/catalog';
import { regionName } from '@/lib/format';
import { SearchBox } from '@/components/SearchBox';
import { Rail } from '@/components/Rail';
import { CheckIcon } from '@/components/icons';

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const tc = await getTranslations('categories');
  const market = await getMarket(locale);
  const country = regionName(market.country, locale);

  const base = { locale, country: market.country, q: '' };
  const [trending, fast, value] = await Promise.all([
    search({ ...base, sort: 'relevance', per_page: 10 }),
    search({ ...base, sort: 'fastest', max_days: 5, per_page: 10 }),
    search({ ...base, sort: 'price_asc', min_rating: 4.4, per_page: 30 }),
  ]);

  const suggestions = t('suggestions').split(/[,،、，]\s*/).filter(Boolean);

  return (
    <>
      <section className="relative overflow-hidden rounded-[1.75rem] bg-teal px-5 py-8 text-white md:px-12 md:py-14">
        <div className="relative max-w-2xl">
          <h1 className="text-[1.9rem] font-extrabold leading-tight md:text-5xl">{t('heroTitle')}</h1>
          <p className="mt-3 text-white/85 md:text-lg">{t('heroSub', { country, currency: market.currency })}</p>
          <div className="mt-6 text-ink">
            <SearchBox large />
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/85">
            <span>{t('try')}</span>
            {suggestions.map((s) => (
              <Link
                key={s}
                href={{ pathname: '/search', query: { q: s } }}
                className="rounded-full bg-white/15 px-3 py-1 font-semibold text-white hover:bg-white/25"
              >
                {s}
              </Link>
            ))}
          </p>
        </div>
      </section>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold text-muted">
        {[t('trust1'), t('trust2'), t('trust3')].map((x) => (
          <li key={x} className="flex items-center gap-1.5">
            <CheckIcon width={16} height={16} className="shrink-0 text-teal" />
            {x}
          </li>
        ))}
      </ul>

      <section className="mt-10" aria-labelledby="cats">
        <h2 id="cats" className="mb-3 text-xl font-extrabold">
          {t('categories')}
        </h2>
        <ul className="grid grid-cols-5 gap-2 md:gap-3">
          {CATEGORIES.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/c/${c.slug}`}
                className="flex h-full flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center hover:bg-white md:py-4"
              >
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-2xl ring-1 ring-line md:h-14 md:w-14 md:text-3xl" aria-hidden>
                  {c.icon}
                </span>
                <span className="text-[11px] font-semibold leading-tight md:text-sm">{tc(c.slug)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Rail title={t('trending', { country })} href="/search" seeAll={t('seeAll')} docs={trending.hits} market={market} locale={locale} />
      <Rail
        title={t('fast')}
        subtitle={t('fastSub')}
        href="/search?sort=fastest&max_days=5"
        seeAll={t('seeAll')}
        docs={fast.hits}
        market={market}
        locale={locale}
      />
      <Rail
        title={t('value')}
        subtitle={t('valueSub')}
        href="/search?sort=price_asc&rating=4.4"
        seeAll={t('seeAll')}
        docs={value.hits.slice(0, 10)}
        market={market}
        locale={locale}
      />
    </>
  );
}
