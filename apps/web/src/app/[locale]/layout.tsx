import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/noto-sans-arabic';
import '@fontsource-variable/noto-sans-devanagari';
import { dirFor, routing } from '@/i18n/routing';
import { getMarket } from '@/lib/market.server';
import { Providers } from '@/components/Providers';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import type { Locale } from '@shared/types';

// Every page depends on the visitor's country cookie (prices, delivery), so render per request.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    title: { default: t('title'), template: '%s · Zakka' },
    description: t('description'),
    alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])) },
  };
}

export const viewport: Viewport = { themeColor: '#0F766E', width: 'device-width', initialScale: 1 };

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const market = await getMarket(locale as Locale);

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <Providers market={market}>
            <Header />
            <main id="main" className="mx-auto max-w-6xl px-4 pt-4">
              {children}
            </main>
            <Footer />
            <WhatsAppButton />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
