import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { getMarket } from '@/lib/market.server';
import { CATEGORIES } from '@/lib/mock/catalog';
import { SearchResults, type RawParams } from '@/components/SearchResults';

type Props = { params: Promise<{ locale: Locale; slug: string }>; searchParams: Promise<RawParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'categories' });
  return CATEGORIES.some((c) => c.slug === slug) ? { title: t(slug) } : {};
}

// TODO(live): load top-level categories + category_translations from Supabase instead of the mock list.
export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const cat = CATEGORIES.find((c) => c.slug === slug);
  if (!cat) notFound();
  const sp = await searchParams;
  const t = await getTranslations('categories');
  const market = await getMarket(locale);

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-teal-soft text-3xl" aria-hidden>
          {cat.icon}
        </span>
        <h1 className="text-2xl font-extrabold">{t(slug)}</h1>
      </div>
      <SearchResults sp={sp} locale={locale} market={market} fixedCategory={slug} basePath={`/c/${slug}`} />
    </>
  );
}
