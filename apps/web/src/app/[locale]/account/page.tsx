import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { AccountForm } from './AccountForm';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('title'), robots: { index: false } };
}

export default async function AccountPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-extrabold">{t('title')}</h1>
      <p className="mb-4 text-sm text-muted">{t('signInTodo')}</p>
      <AccountForm />
    </div>
  );
}
