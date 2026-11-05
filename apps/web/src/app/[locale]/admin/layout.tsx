import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

// TODO(auth): this whole section is unprotected. Before deploying, gate it in middleware or here with
// Supabase auth + an admin role check (e.g. customers/admins table or a JWT claim), and do the same in /api/admin/*.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('admin');
  const nav = [
    ['/admin', t('nav.dashboard')],
    ['/admin/products', t('nav.products')],
    ['/admin/markup', t('nav.markup')],
    ['/admin/orders', t('nav.orders')],
    ['/admin/sources', t('nav.sources')],
  ] as const;
  return (
    <div>
      <p className="mb-4 rounded-xl border border-line bg-sand px-3 py-2 text-sm font-semibold" role="note">
        {t('authTodo')}
      </p>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold">{t('title')}</h1>
        <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-bold">{t('mock')}</span>
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
