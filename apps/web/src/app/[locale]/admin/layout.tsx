import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/auth-core';
import { adminIsLive } from '@/lib/admin-data';
import { SignOutButton } from '@/components/SignOutButton';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Admin is for Supabase users with app_metadata.role = 'admin'. Middleware already redirects everyone else;
 * this repeats the check so the section stays closed if the middleware matcher ever changes.
 * The admin API checks the role itself (requireAdmin).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session || !isAdmin(session.user)) notFound();
  const t = await getTranslations('admin');
  const nav = [
    ['/admin', t('nav.dashboard')],
    ['/admin/coverage', t('nav.coverage')],
    ['/admin/products', t('nav.products')],
    ['/admin/markup', t('nav.markup')],
    ['/admin/orders', t('nav.orders')],
    ['/admin/sources', t('nav.sources')],
  ] as const;
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold">{t('title')}</h1>
        {!adminIsLive() && <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-bold">{t('mock')}</span>}
        <span className="ms-auto flex items-center gap-3 text-sm text-muted">
          <span dir="ltr">{session.user.email}</span>
          <SignOutButton label={t('signOut')} />
        </span>
      </div>
      <nav className="mb-6 flex gap-1.5 overflow-x-auto pb-1">
        {nav.map(([href, label]) => (
          <Link key={href} href={href} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-bold ring-1 ring-line hover:ring-teal">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
