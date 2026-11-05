import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { getMockRules } from '@/lib/mock/admin';
import { CATEGORIES, PRODUCTS, SOURCES } from '@/lib/mock/catalog';
import { MarkupEditor } from './MarkupEditor';

export const dynamic = 'force-dynamic';

export default async function AdminMarkup({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin');
  const tc = await getTranslations('categories');
  const targets = {
    category: CATEGORIES.map((c) => ({ id: c.id, label: tc(c.slug) })),
    source: SOURCES.filter((s) => s.kind === 'dropship').map((s) => ({ id: s.id, label: s.name })),
    product: PRODUCTS.map((p) => ({ id: p.id, label: p.title })),
  };
  return (
    <>
      <p className="mb-4 text-sm text-muted">{t('markupHelp')}</p>
      <MarkupEditor initial={getMockRules()} targets={targets} />
    </>
  );
}
