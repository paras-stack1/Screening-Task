import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, JSON_BODY_LIMIT } from '../src/app';

/**
 * API hardening checks that never reach the database: every request here is rejected by
 * middleware (headers, content type, body size, validation, rate limits, token verification)
 * before any query runs. The default Prisma client points at an unreachable address.
 */
const app = () => createApp();

describe('security headers', () => {
  it('sets Helmet headers, no-store caching and hides the framework', async () => {
    const res = await request(app()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('does not grant CORS to an unlisted browser origin', async () => {
    const res = await request(app()).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('grants CORS to a listed origin', async () => {
    const res = await request(app()).get('/api/v1/health').set('Origin', 'http://localhost:8081');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  });
});

describe('request body handling', () => {
  it('rejects non-JSON content types with 415', async () => {
    const res = await request(app())
      .post('/api/v1/auth/login')
      .type('form')
      .send('loginId=EMP-0001&password=whatever123');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it(`rejects bodies over ${JSON_BODY_LIMIT} with 413`, async () => {
    const res = await request(app())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ loginId: 'EMP-0001', password: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
  });

  it('rejects malformed JSON with 400 and no parser internals', async () => {
    const res = await request(app())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"loginId": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/at JSON\.parse|node_modules|SyntaxError/);
  });

  it.each([
    ['missing password', { loginId: 'EMP-0001' }],
    ['missing loginId', { password: 'whatever123' }],
    ['wrong types', { loginId: 42, password: true }],
    ['mass assignment: role', { loginId: 'EMP-0001', password: 'whatever123', role: 'STATE_ADMIN' }],
    ['mass assignment: status', { loginId: 'EMP-0001', password: 'whatever123', status: 'ACTIVE' }],
    ['oversized password', { loginId: 'EMP-0001', password: 'x'.repeat(1025) }],
    ['device label with markup', { loginId: 'EMP-0001', password: 'whatever123', deviceLabel: '<script>' }],
  ])('rejects login input: %s', async (_name, body) => {
    const res = await request(app()).post('/api/v1/auth/login').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unexpected fields on refresh', async () => {
    const res = await request(app())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'x', userId: 'someone' });
    expect(res.status).toBe(400);
  });
});

describe('protected routes without a valid access token', () => {
  it.each([
    ['no Authorization header', undefined],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['empty bearer', 'Bearer '],
    ['not a JWT', 'Bearer not-a-token'],
    ['alg none', 'Bearer eyJhbGciOiJub25lIiwidHlwIjoiYXQrand0In0.eyJzdWIiOiJ4In0.'],
    [
      'forged signature',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDAifQ.c2lnbmF0dXJl',
    ],
  ])('%s -> 401 with WWW-Authenticate and a generic message', async (_name, header) => {
    const req = request(app()).get('/api/v1/auth/me');
    const res = await (header ? req.set('Authorization', header) : req);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Bearer');
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
  });

  /**
   * Route inventory: every non-public endpoint. Public ones are only /health/*, /auth/login,
   * /auth/refresh and /auth/logout. Add every new protected route here.
   */
  const ID = '00000000-0000-4000-8000-000000000000';
  it.each([
    ['get', '/api/v1/auth/me'],
    ['post', '/api/v1/auth/logout-all'],
    ['post', '/api/v1/auth/change-password'],
    ['get', '/api/v1/auth/sessions'],
    ['delete', `/api/v1/auth/sessions/${ID}`],
    ['get', '/api/v1/children'],
    ['get', `/api/v1/children/${ID}`],
    ['post', '/api/v1/children'],
    ['get', '/api/v1/children/registration-areas'],
    ['patch', `/api/v1/children/${ID}`],
    ['get', `/api/v1/children/${ID}/guardians`],
    ['post', `/api/v1/children/${ID}/guardians`],
    ['patch', `/api/v1/children/${ID}/guardians/${ID}`],
    ['delete', `/api/v1/children/${ID}/guardians/${ID}`],
    ['get', `/api/v1/guardians/${ID}`],
    ['patch', `/api/v1/guardians/${ID}`],
    ['get', '/api/v1/users'],
    ['post', '/api/v1/users'],
    ['get', `/api/v1/users/${ID}`],
    ['post', `/api/v1/users/${ID}/status`],
    ['post', `/api/v1/users/${ID}/reset-password`],
    ['post', `/api/v1/users/${ID}/revoke-sessions`],
    ['post', '/api/v1/assignments'],
    ['post', `/api/v1/assignments/${ID}/end`],
    ['post', `/api/v1/assignments/${ID}/suspend`],
    ['post', `/api/v1/assignments/${ID}/reactivate`],
    ['post', `/api/v1/assignments/${ID}/revoke`],
    ['get', '/api/v1/roles'],
  ] as const)('%s %s requires authentication', async (method, path) => {
    const res = await request(app())[method](path);
    expect(res.status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('limits login attempts for one account from one IP (11th attempt -> 429)', async () => {
    const instance = app();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      // Invalid body: rejected by validation AFTER the limiter has counted it - no DB needed.
      const res = await request(instance).post('/api/v1/auth/login').send({ loginId: ' emp-0001 ' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('counts the same account across login-ID spellings (normalised key)', async () => {
    const instance = app();
    for (let i = 0; i < 10; i += 1) {
      await request(instance)
        .post('/api/v1/auth/login')
        .send({ loginId: i % 2 ? 'emp-0002' : 'EMP-0002' });
    }
    const res = await request(instance).post('/api/v1/auth/login').send({ loginId: ' Emp-0002' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(res.headers['ratelimit-policy'] ?? res.headers['ratelimit']).toBeDefined();
  });

  it('does not let one account exhaust the limit of another', async () => {
    const instance = app();
    for (let i = 0; i < 11; i += 1) {
      await request(instance).post('/api/v1/auth/login').send({ loginId: 'EMP-0003' });
    }
    const other = await request(instance).post('/api/v1/auth/login').send({ loginId: 'EMP-0004' });
    expect(other.status).toBe(400);
  });
});
