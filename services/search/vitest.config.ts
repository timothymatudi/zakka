import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests never touch the network: force mock mode regardless of the developer's shell.
    env: { ANTHROPIC_API_KEY: '', TYPESENSE_API_KEY: '', DATABASE_URL: '', SEARCH_ADMIN_TOKEN: '', DEV_CATALOG_PATH: '' },
  },
});
