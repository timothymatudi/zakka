'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Market } from '@/lib/markets';

const MarketContext = createContext<Market | null>(null);

export function useMarket(): Market {
  const m = useContext(MarketContext);
  if (!m) throw new Error('useMarket outside provider');
  return m;
}

export interface CartItem {
  offerId: string;
  productId: string;
  title: string;
  icon: string | null;
  image: string | null;
  priceUsd: number; // catalog display_price_usd (markup already applied by the catalog)
  priceLocal?: number | null; // catalog local price in `currency` (preferred for display)
  currency?: string;
  qty: number;
  deliveryMin: number | null;
  deliveryMax: number | null;
  country: string;
}

interface CartApi {
  items: CartItem[];
  count: number;
  ready: boolean;
  add: (item: Omit<CartItem, 'qty'>, qty?: number) => void;
  setQty: (offerId: string, qty: number) => void;
  remove: (offerId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartApi | null>(null);
const CART_KEY = 'zakka_cart_v1';

export function useCart(): CartApi {
  const c = useContext(CartContext);
  if (!c) throw new Error('useCart outside provider');
  return c;
}

export function Providers({ market, children }: { market: Market; children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: hydration-safe localStorage read on mount; `ready` guards the write-back
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
    } catch {
      /* storage unavailable */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable */
    }
  }, [items, ready]);

  const add = useCallback((item: Omit<CartItem, 'qty'>, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.offerId === item.offerId);
      if (existing) return prev.map((i) => (i.offerId === item.offerId ? { ...i, qty: Math.min(99, i.qty + qty) } : i));
      return [...prev, { ...item, qty }];
    });
  }, []);
  const setQty = useCallback((offerId: string, qty: number) => {
    setItems((prev) => prev.map((i) => (i.offerId === offerId ? { ...i, qty: Math.max(1, Math.min(99, qty)) } : i)));
  }, []);
  const remove = useCallback((offerId: string) => setItems((prev) => prev.filter((i) => i.offerId !== offerId)), []);
  const clear = useCallback(() => setItems([]), []);

  const cart = useMemo<CartApi>(
    () => ({ items, count: items.reduce((n, i) => n + i.qty, 0), ready, add, setQty, remove, clear }),
    [items, ready, add, setQty, remove, clear],
  );

  return (
    <MarketContext.Provider value={market}>
      <CartContext.Provider value={cart}>{children}</CartContext.Provider>
    </MarketContext.Provider>
  );
}
