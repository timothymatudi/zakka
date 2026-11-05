import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { getMarket } from '@/lib/market.server';
import { SearchResults, type RawParams } from '@/components/SearchResults';

type Props = { params: Promise<{ locale: Locale }>; searchParams: Promise<RawParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'search' });
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  return { title: q ? t('resultsFor', { q }) : t('allProducts'), robots: { index: false } };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('search');
  const market = await getMarket(locale);
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';

  return (
    <>
      <h1 className="mb-4 text-2xl font-extrabold">{q ? t('resultsFor', { q }) : t('allProducts')}</h1>
      <SearchResults sp={sp} locale={locale} market={market} basePath="/search" />
    </>
  );
}
