'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useCart, useMarket } from '@/components/Providers';
import { cartUnit, formatMoney } from '@/lib/money';

export function CartView() {
  const t = useTranslations('cart');
  const tp = useTranslations('product');
  const locale = useLocale();
  const market = useMarket();
  const { items, ready, setQty, remove } = useCart();

  if (!ready) return <p className="text-muted">…</p>;
  if (items.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-lg font-bold">{t('empty')}</p>
        <Link href="/" className="btn btn-primary mt-4">
          {t('continue')}
        </Link>
      </div>
    );
  }

  const money = (v: number) => formatMoney(v, market.currency, locale, market.decimals);
  const lines = items.map((i) => ({ ...i, unit: cartUnit(i, market) }));
  const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <ul className="space-y-3">
        {lines.map((l) => (
          <li key={l.offerId} className="card flex gap-3 p-3">
            <Link href={`/p/${l.productId}`} className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-teal-soft text-4xl" aria-hidden>
              {l.icon ?? '🛍️'}
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/p/${l.productId}`} className="line-clamp-2 font-semibold hover:text-teal">
                {l.title}
              </Link>
              {l.deliveryMin != null && l.deliveryMax != null && (
                <p className="text-xs font-medium text-teal">{tp('days', { min: l.deliveryMin, max: l.deliveryMax })}</p>
              )}
              <div className="mt-2 flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <span className="sr-only">{t('qty')}</span>
                  <button type="button" className="h-8 w-8 rounded-full ring-1 ring-line" onClick={() => setQty(l.offerId, l.qty - 1)} aria-label="−">
                    −
                  </button>
                  <span className="w-6 text-center font-bold" aria-live="polite">
                    {l.qty}
                  </span>
                  <button type="button" className="h-8 w-8 rounded-full ring-1 ring-line" onClick={() => setQty(l.offerId, l.qty + 1)} aria-label="+">
                    +
                  </button>
                </label>
                <button type="button" className="text-sm font-semibold text-muted underline" onClick={() => remove(l.offerId)}>
                  {t('remove')}
                </button>
              </div>
            </div>
            <p className="font-extrabold">{money(l.unit * l.qty)}</p>
          </li>
        ))}
        <li className="text-xs text-muted">{t('affiliateNote')}</li>
      </ul>
      <aside className="card h-fit space-y-2 p-4">
        <div className="flex justify-between text-sm">
          <span>{t('subtotal')}</span>
          <span className="font-semibold">{money(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>{t('shipping')}</span>
          <span className="font-semibold text-teal">{t('included')}</span>
        </div>
        <div className="flex justify-between border-t border-line pt-2 text-lg font-extrabold">
          <span>{t('total')}</span>
          <span>{money(subtotal)}</span>
        </div>
        <Link href="/checkout" className="btn btn-primary mt-2 w-full">
          {t('checkout')}
        </Link>
      </aside>
    </div>
  );
}
