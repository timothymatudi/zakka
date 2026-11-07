'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';

export function SignOutButton({ label, className = 'font-semibold text-teal hover:underline' }: { label: string; className?: string }) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/signout', { method: 'POST' }).catch(() => null);
        window.location.assign(`/${locale}`);
      }}
    >
      {label}
    </button>
  );
}
