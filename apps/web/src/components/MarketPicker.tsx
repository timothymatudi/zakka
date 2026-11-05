'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { useRouter as useNextRouter } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALE_NAMES, routing } from '@/i18n/routing';
import { COUNTRIES, COUNTRY_COOKIE } from '@/lib/markets';
import { regionName } from '@/lib/format';
import { useMarket } from './Providers';
import { GlobeIcon } from './icons';
import type { Locale } from '@shared/types';

export function setCountryCookie(code: string) {
  document.cookie = `${COUNTRY_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
}

export function MarketPicker() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const market = useMarket();
  const router = useRouter();
  const nextRouter = useNextRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  const onLocale = (next: string) => {
    start(() => {
      const query = typeof window !== 'undefined' ? Object.fromEntries(new URLSearchParams(window.location.search)) : {};
      router.replace({ pathname, query }, { locale: next as Locale });
    });
  };
  const onCountry = (code: string) => {
    setCountryCookie(code);
    start(() => nextRouter.refresh());
  };

  return (
    <details className="relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden"
        aria-label={`${t('language')} / ${t('country')}`}
      >
        <GlobeIcon width={18} height={18} />
        <span className="uppercase">{locale}</span>
        <span className="text-muted">·</span>
        <span>{market.country}</span>
        {pending && <span className="ms-1 h-2 w-2 animate-pulse rounded-full bg-coral" />}
      </summary>
      <div className="card absolute end-0 z-40 mt-2 w-72 space-y-3 p-4 shadow-lg">
        <label className="block text-sm font-semibold">
          {t('language')}
          <select className="field mt-1" value={locale} onChange={(e) => onLocale(e.target.value)}>
            {routing.locales.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          {t('country')}
          <select className="field mt-1" value={market.country} onChange={(e) => onCountry(e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {regionName(c.code, locale)} ({c.currency})
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}
