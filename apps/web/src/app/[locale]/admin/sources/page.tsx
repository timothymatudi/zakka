import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { getSources } from '@/lib/admin-data';
import { Table } from '@/components/admin/Table';

export const dynamic = 'force-dynamic';

export default async function AdminSources({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.cols');
  const sources = await getSources();
  return (
    <Table
      head={[t('code'), t('name'), t('kind'), t('offers'), t('active')]}
      rows={sources.map((s) => [
        <code key="c">{s.code}</code>,
        s.name,
        <span key="k" className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.kind === 'dropship' ? 'bg-teal-soft text-teal' : 'bg-coral-soft'}`}>
          {s.kind}
        </span>,
        s.offers.toLocaleString(locale),
        s.is_active ? '✓' : '—',
      ])}
    />
  );
}
