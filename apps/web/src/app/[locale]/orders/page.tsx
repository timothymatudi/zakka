import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { getOwnCustomer, getSession } from '@/lib/auth';
import { listOrdersByCustomer } from '@/lib/orders';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'order' });
  return { title: t('title'), robots: { index: false } };
}

const DEMO_ORDER = 'd0000000-0000-4000-8000-000000000002';

export default async function OrdersLookupPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('order');

  const session = await getSession();
  const customer = session ? await getOwnCustomer(session) : null;
  const myOrders = customer ? await listOrdersByCustomer(customer.id) : [];

  return (
    <div className="mx-auto max-w-md space-y-6">
      {customer && (
        <section>
          <h1 className="mb-3 text-2xl font-extrabold">{t('myOrders')}</h1>
          {myOrders.length === 0 ? (
            <p className="text-sm text-muted">{t('noOrders')}</p>
          ) : (
            <ul className="space-y-2">
              {myOrders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/orders/${order.id}`}
                    className="card flex items-center justify-between p-4 hover:ring-2 hover:ring-teal"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold dir-ltr">{order.id.slice(0, 8)}…</p>
                      <p className="text-xs text-muted">{new Date(order.created_at).toLocaleDateString(locale)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {new Intl.NumberFormat(locale, { style: 'currency', currency: order.currency }).format(order.total)}
                      </p>
                      <p className="text-xs text-muted">{t(`status.${order.status}`)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!customer && (
        <>
          <h1 className="text-2xl font-extrabold">{t('title')}</h1>
          {/* Submits to the lookup route which redirects to /orders/{id}. */}
          <form action="/api/orders/lookup" method="get" className="card space-y-3 p-4">
            <input type="hidden" name="l" value={locale} />
            <label className="block text-sm font-semibold">
              {t('lookup')}
              <input name="id" required className="field mt-1" dir="ltr" placeholder="d0000000-…" />
            </label>
            <button className="btn btn-primary w-full">{t('find')}</button>
          </form>
          <Link href={`/orders/${DEMO_ORDER}`} className="inline-block text-sm font-bold text-teal hover:underline">
            {t('demo')} <span aria-hidden className="inline-block rtl:-scale-x-100">→</span>
          </Link>
        </>
      )}
    </div>
  );
}
