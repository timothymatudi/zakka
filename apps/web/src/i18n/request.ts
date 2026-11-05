import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';
import en from '../messages/en.json';

type Messages = Record<string, unknown>;

/** Deep-merge so any key missing in a locale falls back to English. */
function merge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object'
        ? merge(b as Messages, v as Messages)
        : v;
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages =
    locale === 'en'
      ? en
      : merge(en as Messages, (await import(`../messages/${locale}.json`)).default as Messages);
  return { locale, messages };
});
