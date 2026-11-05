'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useCart, useMarket } from '@/components/Providers';
import { formatMoney, usdToLocal } from '@/lib/money';
import { regionName } from '@/lib/format';
import { methodsFor, type PaymentMethod } from '@/lib/payment-methods';
import { CheckIcon } from '@/components/icons';

const METHOD_MARK: Record<PaymentMethod, string> = { stripe: '💳', paypal: '🅿', flutterwave: '🌍', paystack: '🏦', mpesa: '📲' };

export function CheckoutForm() {
  const t = useTranslations('checkout');
  const tc = useTranslations('cart');
  const locale = useLocale();
  const market = useMarket();
  const { items, ready, clear } = useCart();
  const methods = methodsFor(market.country);
  const [method, setMethod] = useState<PaymentMethod>(methods[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <p className="text-muted">…</p>;
  if (items.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="font-bold">{tc('empty')}</p>
        <Link href="/" className="btn btn-primary mt-4">
          {tc('continue')}
        </Link>
      </div>
    );
  }

  const money = (v: number) => formatMoney(v, market.currency, locale, market.decimals);
  const estimate = items.reduce((s, i) => s + usdToLocal(i.priceUsd, market) * i.qty, 0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale,
          country: market.country,
          provider: method,
          contact: {
            name: fd.get('name'),
            email: fd.get('email'),
            phone: fd.get('phone'),
            line1: fd.get('line1'),
            line2: fd.get('line2'),
            city: fd.get('city'),
            region: fd.get('region'),
            postal_code: fd.get('postal_code'),
          },
          items: items.map((i) => ({ offerId: i.offerId, productId: i.productId, qty: i.qty })),
        }),
      });
      const data = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok || !data.redirectUrl) throw new Error(data.error ?? 'failed');
      clear();
      window.location.assign(data.redirectUrl);
    } catch {
      setError(t('error'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <fieldset className="card space-y-3 p-4">
          <legend className="px-1 text-lg font-extrabold">{t('contact')}</legend>
          <label className="block text-sm font-semibold">
            {t('name')}
            <input name="name" required autoComplete="name" className="field mt-1" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              {t('email')}
              <input name="email" type="email" autoComplete="email" className="field mt-1" />
            </label>
            <label className="block text-sm font-semibold">
              {t('phone')}
              <input name="phone" type="tel" required autoComplete="tel" placeholder="+" pattern="\+[0-9 ]{7,20}" className="field mt-1" dir="ltr" />
            </label>
          </div>
          <label className="block text-sm font-semibold">
            {t('address')}
            <input name="line1" required autoComplete="address-line1" className="field mt-1" />
          </label>
          <label className="block text-sm font-semibold">
            {t('line2')}
            <input name="line2" autoComplete="address-line2" className="field mt-1" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              {t('city')}
              <input name="city" required autoComplete="address-level2" className="field mt-1" />
            </label>
            <label className="block text-sm font-semibold">
              {t('region')}
              <input name="region" autoComplete="address-level1" className="field mt-1" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              {t('postal')}
              <input name="postal_code" autoComplete="postal-code" className="field mt-1" dir="ltr" />
            </label>
            <p className="self-end pb-2 text-sm font-semibold text-muted">{regionName(market.country, locale)}</p>
          </div>
        </fieldset>

        <fieldset className="card p-4">
          <legend className="px-1 text-lg font-extrabold">{t('payment')}</legend>
          <p className="mb-3 text-xs text-muted">{t('localFirst', { country: regionName(market.country, locale) })}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {methods.map((m) => {
              const active = m === method;
              return (
                <label
                  key={m}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${active ? 'border-teal bg-teal-soft' : 'border-line bg-white'}`}
                >
                  <input type="radio" name="method" value={m} checked={active} onChange={() => setMethod(m)} className="sr-only" />
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-xl ring-1 ring-line" aria-hidden>
                    {METHOD_MARK[m]}
                  </span>
                  <span className="flex-1">
                    <span className="block font-bold">{t(`methods.${m}`)}</span>
                    <span className="block text-xs text-muted">{t(`methods.${m}Sub`)}</span>
                  </span>
                  {active && <CheckIcon className="text-teal" />}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <aside className="card h-fit space-y-3 p-4">
        <h2 className="font-extrabold">{t('summary')}</h2>
        <ul className="space-y-1.5 text-sm">
          {items.map((i) => (
            <li key={i.offerId} className="flex justify-between gap-2">
              <span className="line-clamp-1">
                {i.qty} × {i.title}
              </span>
              <span className="shrink-0 font-semibold">{money(usdToLocal(i.priceUsd, market) * i.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line pt-2 text-lg font-extrabold">
          <span>{tc('total')}</span>
          <span>{money(estimate)}</span>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-coral-soft p-2 text-sm">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary w-full disabled:opacity-60">
          {busy ? t('placing') : t('pay', { total: money(estimate) })}
        </button>
        <p className="text-center text-xs text-muted">{t('mockNote')}</p>
      </aside>
    </form>
  );
}
