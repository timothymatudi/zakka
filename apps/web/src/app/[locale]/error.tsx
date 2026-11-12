'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** Shown when a page under a locale throws while rendering. The header and footer stay in place. */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card mx-auto my-10 max-w-md p-8 text-center" role="alert">
      <p className="text-5xl" aria-hidden>
        🧺
      </p>
      <h1 className="mt-3 text-xl font-extrabold">{t('errorTitle')}</h1>
      <p className="mt-2 text-muted">{t('errorBody')}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          {t('retry')}
        </button>
        <Link href="/" className="btn btn-outline">
          {t('goHome')}
        </Link>
      </div>
      {/* The digest matches the server log line for this error; it reveals nothing about the cause. */}
      {error.digest && (
        <p className="mt-4 text-xs text-muted" dir="ltr">
          {error.digest}
        </p>
      )}
    </div>
  );
}
