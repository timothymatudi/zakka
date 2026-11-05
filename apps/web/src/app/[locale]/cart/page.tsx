import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { CartView } from './CartView';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cart' });
  return { title: t('title'), robots: { index: false } };
}

export default async function CartPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cart');
  return (
    <>
      <h1 className="mb-4 text-2xl font-extrabold">{t('title')}</h1>
      <CartView />
    </>
  );
}
