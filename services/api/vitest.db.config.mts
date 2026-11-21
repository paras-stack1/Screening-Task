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
    // Fixed synthetic settings so results never depend on the developer's .env values.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JWT_SECRET: 'db-test-only-jwt-secret-0123456789abcdef',
      CORS_ORIGINS: 'http://localhost:8081',
      AI_SERVICE_URL: '',
      // Synthetic test-only keys ("test-only-pii-encryption-key-32b" / "...lookup-hmac-key...").
      PII_ENCRYPTION_KEY: 'dGVzdC1vbmx5LXBpaS1lbmNyeXB0aW9uLWtleS0zMmI=',
      PII_LOOKUP_KEY: 'dGVzdC1vbmx5LXBpaS1sb29rdXAtaG1hYy1rZXktMDEyMzQ1Njc4OQ==',
    },
    hookTimeout: 120_000,
  },
});
