import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: t('title') };
}

/** Affiliate program disclosures. Together with the footer, the only customer-facing place partners are named. */
export default async function AffiliateDisclosuresPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  return (
    <article className="mx-auto max-w-2xl space-y-4 py-2 leading-relaxed">
      <h1 className="text-2xl font-extrabold">{t('title')}</h1>
      <p>{t('intro')}</p>
      <h2 className="pt-2 text-lg font-extrabold">{t('programsTitle')}</h2>
      <p>{t('amazon')}</p>
      <p>{t('others')}</p>
      <p className="text-muted">{t('ranking')}</p>
    </article>
  );
}
