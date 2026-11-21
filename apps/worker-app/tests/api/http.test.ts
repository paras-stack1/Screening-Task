import { z } from 'zod';
import { apiErrorMessageKey } from '../../src/services/api/errorMessages';
import { ApiError, isRetryableError } from '../../src/services/api/errors';
import { createHttp, createRequestId } from '../../src/services/api/http';

const BASE = 'https://api.test/api/v1';
const schema = z.object({ value: z.number() });

function response(status: number, body?: unknown, raw?: string) {
  const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'x-request-id' ? 'srv-req-1' : null) },
    text: async () => text,
  } as unknown as Response;
}

function setup(fetchImpl: jest.Mock, baseUrl: string | null = BASE, timeoutMs = 1_000) {
  return createHttp({ baseUrl, timeoutMs, fetchFn: fetchImpl as unknown as typeof fetch });
}

describe('createHttp', () => {
  it('calls the base URL with JSON headers, a request id and the bearer token', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(200, { value: 1 }));
    const request = setup(fetchFn);
    await expect(
      request({ method: 'POST', path: '/x', body: { a: 1 }, schema, accessToken: 'tok-123' }),
    ).resolves.toEqual({ value: 1 });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`${BASE}/x`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.headers['X-Request-Id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('never puts a token in the URL', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(200, { value: 1 }));
    await setup(fetchFn)({ method: 'GET', path: '/x', schema, accessToken: 'secret-token' });
    expect(String(fetchFn.mock.calls[0][0])).not.toContain('secret-token');
  });

  it('request ids always match the API format', () => {
    for (let i = 0; i < 200; i += 1) expect(createRequestId()).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('returns undefined for 204 without a schema', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(204));
    await expect(setup(fetchFn)({ method: 'POST', path: '/logout', body: {} })).resolves.toBeUndefined();
  });

  it('maps the error envelope (code, details, request id)', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      response(400, {
        error: {
          code: 'PASSWORD_POLICY',
          message: 'Too short',
          details: { rule: 'TOO_SHORT' },
          requestId: 'r-9',
        },
      }),
    );
    const error = (await setup(fetchFn)({ method: 'GET', path: '/x', schema }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status: 400, code: 'PASSWORD_POLICY', requestId: 'r-9' });
    expect(error.details).toEqual({ rule: 'TOO_SHORT' });
    // The server message is not copied into the error.
    expect(error.message).not.toContain('Too short');
  });

  it('handles a non-JSON error body (e.g. proxy HTML page)', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(502, undefined, '<html>Bad gateway</html>'));
    await expect(setup(fetchFn)({ method: 'GET', path: '/x', schema })).rejects.toMatchObject({
      kind: 'http',
      status: 502,
      code: undefined,
      requestId: 'srv-req-1',
    });
  });

  it('rejects a 2xx body that breaks the contract', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(200, { value: 'not a number' }));
    await expect(setup(fetchFn)({ method: 'GET', path: '/x', schema })).rejects.toMatchObject({
      kind: 'invalidResponse',
    });
  });

  it('reports network failures', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(setup(fetchFn)({ method: 'GET', path: '/x', schema })).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('times out a request that never answers', async () => {
    jest.useFakeTimers();
    try {
      const fetchFn = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
      const pending = setup(fetchFn, BASE, 1_000)({ method: 'GET', path: '/x', schema });
      jest.advanceTimersByTime(1_001);
      await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports caller cancellation separately from timeouts', async () => {
    const controller = new AbortController();
    const fetchFn = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const pending = setup(fetchFn)({ method: 'GET', path: '/x', schema, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('does not call the network when the app is not configured', async () => {
    const fetchFn = jest.fn();
    await expect(setup(fetchFn, null)({ method: 'GET', path: '/x', schema })).rejects.toMatchObject({
      kind: 'notConfigured',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('error classification', () => {
  it.each([
    [new ApiError('network'), true, 'errors.network'],
    [new ApiError('timeout'), true, 'errors.timeout'],
    [new ApiError('http', { status: 503 }), true, 'errors.server'],
    [new ApiError('http', { status: 429 }), false, 'errors.tooManyRequests'],
    [new ApiError('http', { status: 401 }), false, 'errors.sessionEnded'],
    [new ApiError('http', { status: 403 }), false, 'errors.forbidden'],
    [new ApiError('http', { status: 404 }), false, 'errors.unexpected'],
    [new ApiError('invalidResponse'), false, 'errors.server'],
    [new ApiError('notConfigured'), false, 'errors.notConfigured'],
    [new Error('raw'), false, 'errors.unexpected'],
  ])('%p -> retryable %p, message %p', (error, retryable, key) => {
    expect(isRetryableError(error)).toBe(retryable);
    expect(apiErrorMessageKey(error)).toBe(key);
  });
});
