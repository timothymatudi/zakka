import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { listOrders } from '@/lib/orders';
import { getDashboardCounts } from '@/lib/admin-data';

export const dynamic = 'force-dynamic';

/** KPI row of stat tiles: label + compact value. No deltas until there is history to compare against. */
export default async function AdminDashboard({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.stats');
  const [orders, counts] = await Promise.all([listOrders(1000), getDashboardCounts()]);
  const gmv = orders
    .filter((o) => !['pending_payment', 'cancelled', 'refunded'].includes(o.status))
    .reduce((s, o) => s + o.total_usd, 0);

  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

  const tiles: [string, string][] = [
    [t('orders'), compact.format(orders.length)],
    [counts.clicksLabel === 'session' ? t('clicks') : t('clicksAll'), compact.format(counts.clicks)],
    [t('products'), compact.format(counts.products)],
    [t('offers'), compact.format(counts.offers)],
    [t('sources'), compact.format(counts.sources)],
  ];

  return (
    <div className="space-y-3">
      <section className="card p-5">
        <p className="text-sm text-muted">{t('gmv')}</p>
        <p className="num mt-1 text-5xl font-semibold tracking-tight">{usd.format(gmv)}</p>
      </section>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(([label, value]) => (
          <li key={label} className="card p-4">
            <p className="text-sm text-muted">{label}</p>
            <p className="num mt-1 text-2xl font-semibold">{value}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
