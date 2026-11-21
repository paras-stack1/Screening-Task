import { z } from 'zod';
import { storageKeys } from '../../src/services/storage/secureStorage';
import { createTestContext, WORKER, type TestContext } from '../support/testServices';

const probe = z.object({ ok: z.boolean() }).passthrough();
let context: TestContext;

beforeEach(async () => {
  context = createTestContext();
  context.backend.user(WORKER);
  await context.services.session.initialize();
  await context.services.session.login(WORKER.loginId, WORKER.password);
  context.backend.calls.length = 0;
});

const api = () => context.services.api;
const probeCalls = () => context.backend.callsTo('/probe');

describe('authenticated API client', () => {
  it('attaches the current access token', async () => {
    await expect(api().get('/probe', probe)).resolves.toMatchObject({ ok: true });
    expect(probeCalls()[0]!.headers.Authorization).toMatch(/^Bearer /);
  });

  it('on 401 refreshes once and retries once', async () => {
    context.backend.expireAccessTokens();
    await expect(api().get('/probe', probe)).resolves.toMatchObject({ ok: true });
    expect(context.backend.callsTo('/auth/refresh')).toHaveLength(1);
    expect(probeCalls()).toHaveLength(2);
  });

  it('never loops: a second 401 after refresh ends the session', async () => {
    context.backend.override('/probe', { status: 401 }, { status: 401 }, { status: 401 }, { status: 401 });
    await expect(api().get('/probe', probe)).rejects.toMatchObject({ status: 401 });
    expect(probeCalls()).toHaveLength(2);
    expect(context.backend.callsTo('/auth/refresh')).toHaveLength(1);
    expect(context.services.session.getState()).toEqual({
      status: 'unauthenticated',
      reason: 'sessionEnded',
    });
    expect(await context.store.getItem(storageKeys.refreshToken)).toBeNull();
  });

  it('a refused refresh ends the session without retrying the request', async () => {
    context.backend.expireAccessTokens();
    context.backend.override('/auth/refresh', { status: 401 });
    await expect(api().get('/probe', probe)).rejects.toMatchObject({ status: 401 });
    expect(probeCalls()).toHaveLength(1);
    expect(context.services.session.getState()).toMatchObject({ reason: 'sessionEnded' });
  });

  it('an account deactivated mid-session is signed out on its next request', async () => {
    context.backend.deactivate(WORKER.loginId);
    await expect(api().get('/probe', probe)).rejects.toMatchObject({ status: 401 });
    expect(context.services.session.getState()).toEqual({
      status: 'unauthenticated',
      reason: 'sessionEnded',
    });
  });

  it('parallel requests that all get 401 share one refresh', async () => {
    context.backend.expireAccessTokens();
    const results = await Promise.all(Array.from({ length: 5 }, () => api().get('/probe', probe)));
    expect(results).toHaveLength(5);
    expect(context.backend.callsTo('/auth/refresh')).toHaveLength(1);
    expect(context.services.session.getState()).toMatchObject({ status: 'authenticated' });
  });

  it('does not retry POST requests on network errors (no idempotency yet)', async () => {
    context.backend.override('/probe', 'network');
    await expect(api().post('/probe', { a: 1 }, probe)).rejects.toMatchObject({ kind: 'network' });
    expect(probeCalls()).toHaveLength(1);
  });

  it('403 PASSWORD_CHANGE_REQUIRED switches the session to the password-change state', async () => {
    context.backend.override('/probe', {
      status: 403,
      body: { error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'x' } },
    });
    await expect(api().get('/probe', probe)).rejects.toMatchObject({ status: 403 });
    expect(context.services.session.getState()).toMatchObject({ user: { mustChangePassword: true } });
  });

  it('other 403s do not change the session', async () => {
    context.backend.override('/probe', { status: 403, body: { error: { code: 'FORBIDDEN', message: 'x' } } });
    await expect(api().get('/probe', probe)).rejects.toMatchObject({ status: 403 });
    expect(context.services.session.getState()).toMatchObject({ user: { mustChangePassword: false } });
  });

  it('clears cached server data when the session ends (account switch)', async () => {
    context.services.queryClient.setQueryData(['children'], { secret: 'previous worker data' });
    await context.services.session.logout();
    expect(context.services.queryClient.getQueryData(['children'])).toBeUndefined();
  });

  it('fails clearly without a session and makes no request', async () => {
    await context.services.session.logout();
    context.backend.calls.length = 0;
    await expect(api().get('/probe', probe)).rejects.toMatchObject({ kind: 'noSession' });
    expect(probeCalls()).toHaveLength(0);
  });
});
