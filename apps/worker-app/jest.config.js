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
};
