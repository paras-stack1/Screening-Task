/** Fail on React warnings instead of letting them scroll past. Tests never call a real backend. */
const originalError = console.error;
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    originalError(...args);
    throw new Error(`console.error during test: ${String(args[0])}`);
  });
});
