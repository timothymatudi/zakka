import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@shared/types';
import { adminIsLive, getMarkupRules, getMarkupTargets } from '@/lib/admin-data';
import { MarkupEditor } from './MarkupEditor';

export const dynamic = 'force-dynamic';

export default async function AdminMarkup({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin');
  const tc = await getTranslations('categories');
  const live = adminIsLive();
  const [rules, raw] = await Promise.all([getMarkupRules(), getMarkupTargets()]);
  const targets = {
    category: raw.translateCategories ? raw.category.map((c) => ({ id: c.id, label: tc(c.label) })) : raw.category,
    source: raw.source,
    product: raw.product,
  };
  return (
    <>
      <p className="mb-4 text-sm text-muted">{live ? t('markupHelpLive') : t('markupHelp')}</p>
      <MarkupEditor initial={rules} targets={targets} live={live} />
    </>
  );
}
