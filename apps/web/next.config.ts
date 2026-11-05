import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allows importing ../../packages/shared (outside this app) per the contract.
  experimental: { externalDir: true },
};

export default withNextIntl(nextConfig);
