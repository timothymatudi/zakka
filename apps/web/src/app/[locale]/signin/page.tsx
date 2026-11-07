import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { authMode, MOCK_CODE, safeNext } from '@/lib/auth-core';
import { getSession } from '@/lib/auth';
import { redirect } from '@/i18n/navigation';
import { SignInForm } from './SignInForm';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('title'), robots: { index: false } };
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next } = await searchParams;
  const target = safeNext(next, `/${locale}/account`);
  if (await getSession()) redirect({ href: target.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/', locale });

  const t = await getTranslations('auth');
  const mode = authMode();
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-2 text-2xl font-extrabold">{t('title')}</h1>
      <p className="mb-4 text-sm text-muted">{t('intro')}</p>
      {mode === 'off' ? (
        <p className="card p-5 text-sm font-semibold" role="alert">
          {t('disabled')}
        </p>
      ) : (
        <SignInForm next={target} mockCode={mode === 'mock' ? MOCK_CODE : null} />
      )}
    </div>
  );
}
