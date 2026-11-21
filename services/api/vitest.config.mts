import { defineConfig } from 'vitest/config';

/**
 * Tests never read services/api/.env. They get this synthetic configuration,
 * and the database is replaced by injected fakes (no real DB is touched).
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/db/**'], // database tests run separately: npm run test:db
    environment: 'node',
    restoreMocks: true,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test_unused',
      CORS_ORIGINS: 'http://localhost:8081',
      AI_SERVICE_URL: '',
      AI_SERVICE_API_KEY: '',
      LOG_LEVEL: 'silent',
    },
  },
});
