'use client';

import { useEffect } from 'react';

// Last-resort page for an error in the locale layout itself. It replaces the whole document, so it
// cannot use the translations or the stylesheet: plain English and inline styles only.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, background: '#FBF8F3', color: '#1F2937' }}>
        <h1>Something went wrong</h1>
        <p>That didn&apos;t load. Please try again.</p>
        <button
          type="button"
          onClick={reset}
          style={{ padding: '10px 18px', borderRadius: 999, border: 0, background: '#0F766E', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
