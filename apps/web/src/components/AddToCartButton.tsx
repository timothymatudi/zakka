'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCart, useMarket, type CartItem } from './Providers';

export function AddToCartButton({ item, className = '' }: { item: Omit<CartItem, 'qty' | 'country'>; className?: string }) {
  const t = useTranslations('product');
  const { add } = useCart();
  const market = useMarket();
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-primary ${className}`}
      onClick={() => {
        add({ ...item, country: market.country });
        setAdded(true);
        setTimeout(() => setAdded(false), 1800);
      }}
      aria-live="polite"
    >
      {added ? t('added') : t('addToCart')}
    </button>
  );
}
