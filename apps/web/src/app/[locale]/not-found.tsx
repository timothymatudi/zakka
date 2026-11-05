import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <div className="card mx-auto my-10 max-w-md p-8 text-center">
      <p className="text-5xl" aria-hidden>
        🧺
      </p>
      <h1 className="mt-3 text-xl font-extrabold">{t('notFound')}</h1>
      <Link href="/" className="btn btn-primary mt-4">
        {t('goHome')}
      </Link>
    </div>
  );
}
