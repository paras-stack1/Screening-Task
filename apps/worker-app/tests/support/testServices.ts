import { createAppServices } from '../../src/services/appServices';
import { createMemoryStore, storageKeys, type KeyValueStore } from '../../src/services/storage/secureStorage';
import { createFakeBackend, TEST_BASE_URL, type FakeBackend } from './fakeBackend';

export interface TestContext {
  backend: FakeBackend;
  store: KeyValueStore;
  services: ReturnType<typeof createAppServices>;
  clock: { now: number };
}

/** Real services (http, session, client, query cache) wired to the fake backend and memory store. */
export function createTestContext(
  options: { backend?: FakeBackend; store?: KeyValueStore } = {},
): TestContext {
  const backend = options.backend ?? createFakeBackend();
  const store = options.store ?? createMemoryStore();
  const clock = { now: 1_000_000 };
  const services = createAppServices({
    config: { api: { ok: true, url: TEST_BASE_URL }, requestTimeoutMs: 5_000 },
    store,
    fetchFn: backend.fetchFn as unknown as typeof fetch,
    now: () => clock.now,
  });
  return { backend, store, services, clock };
}

export const WORKER = { loginId: 'EMP-0042', password: 'meri beti 2026', displayName: 'Sunita Devi' };

/** Saves a valid refresh token as if the worker had signed in during an earlier app run. */
export async function seedSavedSession(
  context: TestContext,
  overrides: Partial<Parameters<FakeBackend['user']>[0]> = {},
) {
  context.backend.user({ ...WORKER, ...overrides });
  const response = await context.services.authApi.login({
    loginId: WORKER.loginId,
    password: WORKER.password,
  });
  await context.store.setItem(storageKeys.refreshToken, response.refreshToken);
  context.backend.calls.length = 0;
  context.backend.fetchFn.mockClear();
  return response;
}
