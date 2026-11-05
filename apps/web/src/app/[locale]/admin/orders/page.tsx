import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { listOrders } from '@/lib/orders';
import { formatMoney } from '@/lib/money';
import { CURRENCY_DECIMALS } from '@/lib/markets';
import { formatDate, shortOrderId } from '@/lib/format';
import { Table } from '@/components/admin/Table';

export const dynamic = 'force-dynamic';

export default async function AdminOrders({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.cols');
  const ts = await getTranslations('order.status');
  const orders = await listOrders();
  return (
    <Table
      head={[t('order'), t('date'), t('status'), t('total'), 'USD', t('channel'), t('provider')]}
      rows={orders.map((o) => [
        <Link key="id" href={`/orders/${o.id}`} className="font-semibold text-teal hover:underline" dir="ltr">
          {shortOrderId(o.id)}
        </Link>,
        formatDate(o.created_at, locale),
        ts(o.status),
        formatMoney(o.total, o.currency, locale, CURRENCY_DECIMALS[o.currency] ?? 2),
        `$${o.total_usd.toFixed(2)}`,
        o.channel,
        o.payment_provider ?? '—',
      ])}
    />
  );
}
