/**
 * Jest for the worker app (docs/frontend/testing.md).
 * jest-expo runs tests in a React Native environment with Expo native modules mocked.
 */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  clearMocks: true,
  restoreMocks: true,
  // Generous: the first render in each worker is slow on CI-class and Windows machines.
  testTimeout: 15_000,
  // Step 5 decision V: full-router screen tests are CPU-heavy. With one worker per core they
  // starved each other and timed out (they always passed alone), so use half the cores.
  maxWorkers: '50%',
};
