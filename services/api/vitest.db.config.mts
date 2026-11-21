import { defineConfig } from 'vitest/config';

/**
 * Database-backed tests (npm run test:db). Requires the local PostgreSQL container.
 * TEST_DATABASE_URL comes from services/api/.env; tests/db/globalSetup.ts refuses any database
 * whose name does not end in "_test", then wipes and re-migrates it.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: TEST_DATABASE_URL must come from the environment (e.g. CI).
}

export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/db/globalSetup.ts'],
    fileParallelism: false, // one shared database
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
