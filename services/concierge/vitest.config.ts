import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Rule 4 of the contract: no network in tests. Every client is injected or offline.
    env: { CONCIERGE_OFFLINE: '1', DATABASE_URL: '' },
  },
});
