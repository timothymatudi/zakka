import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { PRODUCTS, SOURCE_NAME } from '@/lib/mock/catalog';
import { Table } from '@/components/admin/Table';

export default async function AdminProducts({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.cols');
  const tc = await getTranslations('categories');
  return (
    <Table
      head={[t('product'), t('category'), t('offers'), t('from'), t('rating')]}
      rows={PRODUCTS.map((p) => [
        <Link key="t" href={`/p/${p.id}`} className="font-semibold hover:text-teal">
          {p.icon} {p.title}
        </Link>,
        tc(p.category_slug),
        p.offers.map((o) => `${SOURCE_NAME[o.source_code]} (${o.kind === 'affiliate' ? 'aff' : 'ds'})`).join(', '),
        `$${p.min_price_usd.toFixed(2)}`,
        p.rating?.toFixed(1) ?? '—',
      ])}
    />
  );
}
