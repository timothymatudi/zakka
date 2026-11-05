'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useCart } from './Providers';
import { BagIcon } from './icons';

export function CartLink() {
  const t = useTranslations('nav');
  const { count, ready } = useCart();
  return (
    <Link href="/cart" className="relative rounded-full p-2 hover:bg-teal-soft" aria-label={`${t('cart')} (${count})`}>
      <BagIcon />
      {ready && count > 0 && (
        <span className="absolute -end-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[11px] font-bold text-white">
          {count}
        </span>
      )}
    </Link>
  );
}
