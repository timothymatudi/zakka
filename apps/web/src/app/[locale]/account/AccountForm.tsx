'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALE_NAMES, routing } from '@/i18n/routing';
import { COUNTRIES, getCountryInfo } from '@/lib/markets';
import { regionName } from '@/lib/format';
import { useMarket } from '@/components/Providers';
import { setCountryCookie } from '@/components/MarketPicker';
import type { Locale } from '@shared/types';

export interface AccountInitial {
  whatsapp_opt_in: boolean;
  marketing_opt_in: boolean;
  phone: string | null;
}

export function AccountForm({ initial }: { initial: AccountInitial | null }) {
  const t = useTranslations('account');
  const locale = useLocale();
  const market = useMarket();
  const router = useRouter();
  const pathname = usePathname();
  const [lang, setLang] = useState(locale);
  const [country, setCountry] = useState(market.country);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('saving');
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locale: lang,
        country,
        whatsapp_opt_in: fd.get('whatsapp_opt_in') === 'on',
        marketing_opt_in: fd.get('marketing_opt_in') === 'on',
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setStatus('error');
      return;
    }
    setCountryCookie(country);
    setStatus('saved');
    if (lang !== locale) router.replace(pathname, { locale: lang as Locale });
    else router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <h2 className="text-lg font-extrabold">{t('prefs')}</h2>
      <label className="block text-sm font-semibold">
        {t('language')}
        <select className="field mt-1" value={lang} onChange={(e) => setLang(e.target.value)}>
          {routing.locales.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        {t('country')}
        <select className="field mt-1" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {regionName(c.code, locale)}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted">{t('currency', { currency: getCountryInfo(country).currency })}</span>
      </label>
      <label className="block text-sm font-semibold">
        {t('phone')}
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          className="field mt-1"
          dir="ltr"
          placeholder="+"
          defaultValue={initial?.phone ?? ''}
          readOnly={Boolean(initial?.phone)}
        />
        <span className="mt-1 block text-xs font-normal text-muted">{t('phoneHint')}</span>
      </label>
      {/* Opt-ins are unticked by default (contract rule 3). */}
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="whatsapp_opt_in" defaultChecked={initial?.whatsapp_opt_in ?? false} className="mt-1 h-4 w-4 accent-teal" />
        <span>
          <span className="font-semibold">{t('whatsappOptIn')}</span>
          <span className="block text-xs text-muted">{t('whatsappOptInHint')}</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="marketing_opt_in" defaultChecked={initial?.marketing_opt_in ?? false} className="mt-1 h-4 w-4 accent-teal" />
        <span className="font-semibold">{t('marketingOptIn')}</span>
      </label>
      <button type="submit" className="btn btn-primary w-full" disabled={status === 'saving'}>
        {status === 'saved' ? `${t('saved')} ✓` : t('save')}
      </button>
      {status === 'error' && (
        <p className="text-sm font-semibold text-coral" role="alert">
          {t('saveError')}
        </p>
      )}
    </form>
  );
}
