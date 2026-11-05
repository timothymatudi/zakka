import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Logo } from './icons';

export async function Footer() {
  const t = await getTranslations('footer');
  const nav = await getTranslations('nav');
  return (
    <footer className="mt-16 border-t border-line bg-sand/60 pb-24">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-muted md:grid-cols-3">
        <div className="space-y-2">
          <Logo />
          <p>{t('tagline')}</p>
        </div>
        {/* Generic line only: partner/program names appear solely on /legal/affiliates (owner rule). */}
        <p>
          {t('affiliate')}{' '}
          <Link href="/legal/affiliates" className="font-semibold text-teal hover:underline">
            {t('legalLink')}
          </Link>
        </p>
        <ul className="space-y-1.5 font-semibold text-ink">
          <li>
            <Link href="/orders">{nav('orders')}</Link>
          </li>
          <li>
            <Link href="/account">{nav('account')}</Link>
          </li>
          <li>
            <Link href="/cart">{nav('cart')}</Link>
          </li>
        </ul>
        <p className="md:col-span-3">{t('rights', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
