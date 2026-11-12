import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProd = process.env.NODE_ENV === 'production';

// One content policy for every page. Scripts and styles allow 'unsafe-inline' because Next.js inlines its
// bootstrap data and Tailwind uses inline styles; per-request nonces are the next hardening step.
// Product images come from many partner hosts, so any https image is allowed.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isProd ? '' : ' ws: wss:'}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

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
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // /api/out sets its own referrer policy so partner stores can attribute the click.
      { source: '/((?!api/out/).*)', headers: [{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
    ];
  },
};

export default withNextIntl(nextConfig);
