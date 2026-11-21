import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

/** The real app/ directory: tests exercise the actual routes, layouts and guards. */
export const APP_DIR = path.resolve(__dirname, '../../app');

/** Renders the whole app at `initialUrl` and waits until session restoration has finished. */
export async function renderApp(initialUrl = '/') {
  const result = await renderRouter(APP_DIR, { initialUrl });
  await waitFor(() => expect(screen.queryByTestId('session-restoring')).toBeNull());
  return result;
}

/**
 * Holds the next request until `release()` is called (the server handles it immediately; only
 * the response is delayed). Lets a test act while a request is in flight.
 */
export function holdNextResponse(fetchFn: jest.Mock) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const real = fetchFn.getMockImplementation()!;
  fetchFn.mockImplementationOnce(async (...args: unknown[]) => {
    const result = await real(...args);
    await gate;
    return result;
  });
  return { release: () => release() };
}
