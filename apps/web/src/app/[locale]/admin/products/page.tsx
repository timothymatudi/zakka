import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { getProducts } from '@/lib/admin-data';
import { Table } from '@/components/admin/Table';

export const dynamic = 'force-dynamic';

export default async function AdminProducts({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.cols');
  const tc = await getTranslations('categories');
  const { rows } = await getProducts();
  const category = (slug: string | null) => (slug ? (tc.has(slug) ? tc(slug) : slug) : '—');
  return (
    <Table
      head={[t('product'), t('category'), t('offers'), t('from'), t('rating')]}
      rows={rows.map((p) => [
        <Link key="t" href={`/p/${p.id}`} className="font-semibold hover:text-teal">
          {p.title}
        </Link>,
        category(p.category),
        p.sources.join(', '),
        p.min_price_usd == null ? '—' : `$${p.min_price_usd.toFixed(2)}`,
        p.rating?.toFixed(1) ?? '—',
      ])}
    />
  );
}
