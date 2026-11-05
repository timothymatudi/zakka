'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/i18n/navigation';

/** The home hero has its own big search bar, so the header's mobile copy is hidden there. */
export function HideOnHome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname === '/' ? null : <>{children}</>;
}
