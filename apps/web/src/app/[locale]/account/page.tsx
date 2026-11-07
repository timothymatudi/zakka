import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { getOwnCustomer, getSession } from '@/lib/auth';
import { authMode, isAdmin } from '@/lib/auth-core';
import { SignOutButton } from '@/components/SignOutButton';
import { AccountForm } from './AccountForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('title'), robots: { index: false } };
}

export default async function AccountPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  const ta = await getTranslations('auth');
  const session = await getSession();
  const customer = session ? await getOwnCustomer(session) : null;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-extrabold">{t('title')}</h1>
      {session ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>
            {ta('signedInAs')} <strong dir="ltr">{session.user.email}</strong>
          </span>
          {isAdmin(session.user) && (
            <Link href="/admin" className="font-semibold text-teal hover:underline">
              {ta('admin')}
            </Link>
          )}
          <SignOutButton label={ta('signOut')} />
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted">
          {authMode() === 'off' ? (
            t('guestNote')
          ) : (
            <>
              {t('guestNote')}{' '}
              <Link href={{ pathname: '/signin', query: { next: `/${locale}/account` } }} className="font-semibold text-teal hover:underline">
                {ta('signIn')}
              </Link>
            </>
          )}
        </p>
      )}
      <AccountForm
        initial={
          customer
            ? {
                whatsapp_opt_in: customer.whatsapp_opt_in,
                marketing_opt_in: customer.marketing_opt_in,
                phone: customer.phone_e164,
              }
            : null
        }
      />
    </div>
  );
}
