import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale, OrderStatus } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { getOrder } from '@/lib/orders';
import { formatMoney } from '@/lib/money';
import { CURRENCY_DECIMALS } from '@/lib/markets';
import { formatDate, shortOrderId } from '@/lib/format';
import { CheckIcon } from '@/components/icons';

type Props = { params: Promise<{ locale: Locale; id: string }>; searchParams: Promise<{ placed?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'order' });
  return { title: t('title'), robots: { index: false } };
}

const STEPS: OrderStatus[] = ['pending_payment', 'paid', 'forwarded', 'shipped', 'delivered'];
const PROVIDER_NAMES: Record<string, string> = { stripe: 'Card', paypal: 'PayPal', flutterwave: 'Flutterwave', paystack: 'Paystack', mpesa: 'M-Pesa' };

export default async function OrderPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { placed } = await searchParams;
  const t = await getTranslations('order');
  const order = await getOrder(id);

  if (!order) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <p className="font-bold">{t('notFound')}</p>
        <Link href="/orders" className="btn btn-outline mt-4">
          {t('title')}
        </Link>
      </div>
    );
  }

  const stepIndex = STEPS.indexOf(order.status);
  const off = order.status === 'cancelled' || order.status === 'refunded';
  const money = (v: number) => formatMoney(v, order.currency, locale, CURRENCY_DECIMALS[order.currency] ?? 2);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {placed && (
        <p className="flex items-center gap-2 rounded-xl bg-teal px-4 py-3 font-bold text-white" role="status">
          <CheckIcon /> {t('placed')}
        </p>
      )}
      <div>
        <h1 className="text-2xl font-extrabold" dir="ltr">
          {t('number', { id: shortOrderId(order.id) })}
        </h1>
        <p className="text-sm text-muted">{formatDate(order.created_at, locale)}</p>
      </div>

      <section className="card p-4">
        {off ? (
          <p className="font-bold text-coral">{t(`status.${order.status}`)}</p>
        ) : (
          <ol className="grid grid-cols-5 gap-1">
            {STEPS.map((s, i) => {
              const done = i <= stepIndex;
              return (
                <li key={s} className="flex flex-col items-center gap-1.5 text-center">
                  <span className={`h-2 w-full rounded-full ${done ? 'bg-teal' : 'bg-line'}`} />
                  <span className={`text-[11px] leading-tight sm:text-xs ${i === stepIndex ? 'font-extrabold text-teal' : done ? 'font-semibold' : 'text-muted'}`}>
                    {t(`status.${s}`)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {order.shipments.map((s) => (
          <div key={s.tracking_number} className="mt-4 rounded-xl bg-sand p-3 text-sm">
            <p className="font-bold">{t('tracking')}</p>
            <p dir="ltr">{t('trackingNumber', { carrier: s.carrier, number: s.tracking_number })}</p>
            <p className="text-muted">{s.last_event}</p>
            {s.tracking_url && (
              <a href={s.tracking_url} target="_blank" rel="noopener noreferrer" className="font-bold text-teal hover:underline">
                {s.tracking_url}
              </a>
            )}
          </div>
        ))}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-extrabold">{t('items')}</h2>
        <ul className="space-y-1.5 text-sm">
          {order.items.map((i) => (
            <li key={i.offer_id} className="flex justify-between gap-2">
              <Link href={`/p/${i.product_id}`} className="hover:text-teal">
                {i.qty} × {i.title || i.product_id.slice(0, 8)}
              </Link>
              <span className="font-semibold">{money(i.unit_price * i.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-line pt-2 font-extrabold">
          <span>{t('total')}</span>
          <span>{money(order.total)}</span>
        </div>
        {order.payment_provider && (
          <p className="mt-1 text-xs text-muted">{t('paidWith', { provider: PROVIDER_NAMES[order.payment_provider] ?? order.payment_provider })}</p>
        )}
      </section>
    </div>
  );
}
