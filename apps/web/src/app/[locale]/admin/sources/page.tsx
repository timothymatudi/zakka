import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { PRODUCTS, SOURCES } from '@/lib/mock/catalog';
import { Table } from '@/components/admin/Table';

// TODO(live): read from the `public_sources` view (no config column) per the contract update.
export default async function AdminSources({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.cols');
  const offerCount = (code: string) => PRODUCTS.reduce((n, p) => n + p.offers.filter((o) => o.source_code === code).length, 0);
  return (
    <Table
      head={[t('code'), t('name'), t('kind'), t('offers'), t('active')]}
      rows={SOURCES.map((s) => [
        <code key="c">{s.code}</code>,
        s.name,
        <span key="k" className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.kind === 'dropship' ? 'bg-teal-soft text-teal' : 'bg-coral-soft'}`}>
          {s.kind}
        </span>,
        offerCount(s.code),
        s.is_active ? '✓' : '—',
      ])}
    />
  );
}
