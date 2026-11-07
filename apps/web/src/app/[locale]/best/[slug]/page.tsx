import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { getMarket } from '@/lib/market.server';
import { search } from '@/lib/search';
import { regionName } from '@/lib/format';
import { CATEGORIES } from '@/lib/mock/catalog';
import { localeAlternates } from '@/lib/seo';
import { ProductCard } from '@/components/ProductCard';

type Props = {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** SEO landing page: "Best {category} delivered to {country}". Template copy only (no AI at request time). */
async function copy(locale: Locale, slug: string, country?: string | string[]) {
  const market = await getMarket(locale, country);
  const t = await getTranslations({ locale, namespace: 'best' });
  const tc = await getTranslations({ locale, namespace: 'categories' });
  const vars = { category: tc(slug), country: regionName(market.country, locale), currency: market.currency };
  return { market, t, vars, title: t('title', vars), intro: t('intro', vars) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!CATEGORIES.some((c) => c.slug === slug)) return {};
  const { title, intro } = await copy(locale, slug, (await searchParams).country);
  return { title, description: intro, alternates: localeAlternates(locale, `/best/${slug}`) };
}

export default async function BestPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const cat = CATEGORIES.find((c) => c.slug === slug);
  if (!cat) notFound();
  const { market, t, vars, title, intro } = await copy(locale, slug, (await searchParams).country);
  // Top-ranked by the search service's sell score (rating, delivery speed to this country, price, popularity).
  const res = await search({ q: '', locale, country: market.country, category: slug, sort: 'relevance', per_page: 24 });

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-teal-soft text-3xl" aria-hidden>
          {cat.icon}
        </span>
        <h1 className="text-2xl font-extrabold">{title}</h1>
      </div>
      <p className="mb-6 max-w-3xl text-[0.95rem] leading-relaxed text-muted">{intro}</p>
      {res.hits.length === 0 ? (
        <p className="card p-4 font-semibold">{t('empty', vars)}</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {res.hits.map((d) => (
            <li key={d.id}>
              <ProductCard doc={d} market={market} locale={locale} />
            </li>
          ))}
        </ol>
      )}
      <p className="mt-6">
        <Link href={`/c/${slug}`} className="font-bold text-teal hover:underline">
          {t('seeAll', vars)} →
        </Link>
      </p>
    </>
  );
}
