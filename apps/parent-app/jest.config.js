/** Jest for the Parent Portal app (same setup as the worker app). */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 15_000,
  maxWorkers: '50%',
};
