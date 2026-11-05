import Link from 'next/link';

// Fallback for paths outside any locale (middleware normally redirects to /en/...).
export default function RootNotFound() {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, background: '#FBF8F3', color: '#1F2937' }}>
        <h1>Page not found</h1>
        <Link href="/en" style={{ color: '#0F766E' }}>
          Go to Zakka
        </Link>
      </body>
    </html>
  );
}
