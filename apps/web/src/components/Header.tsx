import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CartLink } from './CartLink';
import { HideOnHome } from './HideOnHome';
import { MarketPicker } from './MarketPicker';
import { SearchBox } from './SearchBox';
import { Logo, TruckIcon, UserIcon } from './icons';

export async function Header({ showSearch = true }: { showSearch?: boolean }) {
  const t = await getTranslations('nav');
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-cream/95 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded focus:bg-white focus:p-2">
        {t('skip')}
      </a>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link href="/" aria-label={t('home')} className="shrink-0">
          <Logo />
        </Link>
        {showSearch && (
          <div className="hidden flex-1 md:block">
            <SearchBox />
          </div>
        )}
        <nav className="ms-auto flex items-center gap-1">
          <MarketPicker />
          <Link href="/orders" className="hidden rounded-full p-2 hover:bg-teal-soft sm:block" aria-label={t('orders')}>
            <TruckIcon />
          </Link>
          <Link href="/account" className="rounded-full p-2 hover:bg-teal-soft" aria-label={t('account')}>
            <UserIcon />
          </Link>
          <CartLink />
        </nav>
      </div>
      {showSearch && (
        <HideOnHome>
          <div className="px-4 pb-2.5 md:hidden">
            <SearchBox />
          </div>
        </HideOnHome>
      )}
    </header>
  );
}
