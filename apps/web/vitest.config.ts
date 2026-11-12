import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@': path.resolve(__dirname, 'src'),
      // `server-only` throws outside a Next.js server build; tests run in plain Node.
      'server-only': path.resolve(__dirname, 'test/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // next-intl imports 'next/server' without a file extension, which plain Node cannot resolve.
    server: { deps: { inline: ['next-intl'] } },
    // Tests never touch the network: force mock mode regardless of the developer's shell.
    env: {
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SEARCH_API_URL: '',
      CATALOG_API_URL: '',
      CONCIERGE_PUBLIC_URL: '',
      CONCIERGE_INTERNAL_TOKEN: '',
      WEB_BASE_URL: 'http://localhost:3000',
    },
  },
});
