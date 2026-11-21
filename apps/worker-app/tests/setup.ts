/**
 * Global test setup. Tests never call a real backend or device storage: storage is injected as an
 * in-memory store and network calls are mocked per test.
 */

// Fail on React warnings (missing keys, act() problems...) instead of letting them scroll past.
const originalError = console.error;
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    originalError(...args);
    throw new Error(`console.error during test: ${String(args[0])}`);
  });
});
