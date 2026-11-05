import { getLocale, getTranslations } from 'next-intl/server';
import { SearchIcon } from './icons';

/** Plain GET form: works without JavaScript and keeps the bundle small. */
export async function SearchBox({ defaultValue = '', large = false }: { defaultValue?: string; large?: boolean }) {
  const t = await getTranslations('nav');
  const locale = await getLocale();
  return (
    <form action={`/${locale}/search`} method="get" role="search" className="w-full">
      <label className="relative block">
        <span className="sr-only">{t('search')}</span>
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={t('searchPlaceholder')}
          enterKeyHint="search"
          autoComplete="off"
          className={`w-full rounded-full border-2 border-teal/20 bg-white ps-11 pe-24 shadow-sm outline-none focus:border-teal ${
            large ? 'py-4 text-lg' : 'py-2.5 text-base'
          }`}
        />
        <SearchIcon className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
        <button
          type="submit"
          className={`btn btn-primary absolute end-1.5 top-1/2 -translate-y-1/2 ${large ? 'px-5 py-2.5' : 'px-4 py-1.5 text-sm'}`}
        >
          {t('search')}
        </button>
      </label>
    </form>
  );
}
