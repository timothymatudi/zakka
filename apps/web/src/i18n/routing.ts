import { defineRouting } from 'next-intl/routing';
import { LOCALES, RTL_LOCALES, type Locale } from '@shared/types';

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'en',
  localePrefix: 'always',
});

export function isLocale(value: string): value is Locale {
  return (LOCALES as string[]).includes(value);
}

export function dirFor(locale: string): 'rtl' | 'ltr' {
  return (RTL_LOCALES as string[]).includes(locale) ? 'rtl' : 'ltr';
}

/** Native language names for the picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  ar: 'العربية',
  zh: '中文',
  hi: 'हिन्दी',
  sw: 'Kiswahili',
  de: 'Deutsch',
  id: 'Bahasa Indonesia',
};
