import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { routing } from '@/i18n/routing';
import en from '@/messages/en.json';
import { isPolicy, POLICIES, POLICY_DRAFT, POLICY_UPDATED } from '@/lib/policies';

type Props = { params: Promise<{ locale: Locale; policy: string }> };
interface Section {
  h: string;
  p: string[];
}

export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => POLICIES.map((policy) => ({ locale, policy })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, policy } = await params;
  if (!isPolicy(policy)) return {};
  const t = await getTranslations({ locale, namespace: 'policies' });
  return { title: t(`${policy}.title`), robots: POLICY_DRAFT ? { index: false } : undefined };
}

/**
 * Privacy, Terms, Shipping and returns, Contact. The wording lives in messages (`policies.*`); a locale
 * without its own translation shows the English text with a short note.
 */
export default async function PolicyPage({ params }: Props) {
  const { locale, policy } = await params;
  if (!isPolicy(policy)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('policies');

  const company = t.raw('company') as Record<string, string>;
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (whole, key: string) => company[key] ?? whole);
  const sections = t.raw(`${policy}.sections`) as Section[];
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(POLICY_UPDATED));
  // Messages fall back to English, so an unchanged title means this locale has no copy of its own yet.
  const translated = locale === 'en' || t.raw(`${policy}.title`) !== en.policies[policy].title;
  const english = translated ? {} : ({ lang: 'en', dir: 'ltr' } as const);

  return (
    <article className="mx-auto max-w-2xl space-y-4 py-2 leading-relaxed">
      {POLICY_DRAFT && (
        <p role="note" className="rounded-lg border border-line bg-sand px-4 py-3 text-sm font-semibold">
          {t('draftNotice')}
        </p>
      )}
      <h1 className="text-2xl font-extrabold" {...english}>
        {t.raw(`${policy}.title`) as string}
      </h1>
      <p className="text-sm text-muted">{t('updated', { date: updated })}</p>
      {!translated && <p className="text-sm text-muted">{t('englishOnly')}</p>}
      <div className="space-y-4" {...english}>
        <p>{fill(t.raw(`${policy}.intro`) as string)}</p>
        {sections.map((section, i) => (
          <section key={i} className="space-y-2">
            <h2 className="pt-2 text-lg font-extrabold">{section.h}</h2>
            {section.p.map((text, j) => (
              <p key={j}>{fill(text)}</p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
