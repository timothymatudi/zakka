import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// The repo root. The app imports ../../packages/shared, so the bundler must be allowed to read from here.
const repoRoot = path.join(__dirname, '..', '..');

const isProd = process.env.NODE_ENV === 'production';

// Pages get a stricter, per-request policy with script nonces from the middleware (src/lib/csp.ts),
// which replaces this one. This fallback covers everything the middleware does not run on: API
// routes, images, feeds and static files. None of those need to run scripts or load anything.
const csp = ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Browsers only honour this over https, so it is harmless on a local http build.
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allows importing ../../packages/shared (outside this app) per the contract.
  experimental: { externalDir: true },
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // /api/out sets its own referrer policy so partner stores can attribute the click.
      { source: '/((?!api/out/).*)', headers: [{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
    ];
  },
};

export default withNextIntl(nextConfig);
