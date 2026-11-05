import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { Link } from '@/i18n/navigation';

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
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-extrabold">{t('title')}</h1>
      {/* Submits to the lookup route which redirects to /orders/{id}. */}
      <form action="/api/orders/lookup" method="get" className="card space-y-3 p-4">
        <input type="hidden" name="l" value={locale} />
        <label className="block text-sm font-semibold">
          {t('lookup')}
          <input name="id" required className="field mt-1" dir="ltr" placeholder="d0000000-…" />
        </label>
        <button className="btn btn-primary w-full">{t('find')}</button>
      </form>
      <Link href={`/orders/${DEMO_ORDER}`} className="mt-4 inline-block text-sm font-bold text-teal hover:underline">
        {t('demo')} →
      </Link>
    </div>
  );
}
