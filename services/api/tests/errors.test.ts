import { Prisma } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { errorHandler } from '../src/middleware/errorHandler';
import { requestId } from '../src/middleware/requestId';
import { validate } from '../src/middleware/validate';
import { AppError } from '../src/utils/AppError';
import { describeError } from '../src/utils/describeError';
import { logger } from '../src/utils/logger';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const app = createApp({
  health: {
    checkDatabase: () => Promise.resolve(true),
    checkAiService: () => Promise.resolve('not_configured' as const),
  },
});

/** Minimal app with the real middleware, for routes that do not exist in production yet. */
function harness(register: (router: express.Router) => void) {
  const testApp = express();
  testApp.use(requestId);
  testApp.use(express.json());
  const router = express.Router();
  register(router);
  testApp.use(router);
  testApp.use(errorHandler);
  return testApp;
}

describe('error responses', () => {
  it('returns a generic 404 that does not echo the requested path', async () => {
    const res = await request(app).get('/api/v1/children/asha-kumari-2019');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found' });
    expect(res.body.error.requestId).toMatch(UUID);
    expect(res.text).not.toContain('asha');
  });

  it('returns 400 INVALID_JSON for a malformed body', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 (not 500) for a body over the size limit', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides unexpected error details from the client but logs them', async () => {
    const logSpy = vi.spyOn(logger, 'error');
    const testApp = harness((router) =>
      router.get('/boom', () => {
        throw new Error('internal detail: child Asha DOB 2020-01-01');
      }),
    );

    const res = await request(testApp).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(res.text).not.toContain('Asha');
    expect(res.text).not.toContain('stack');
    expect(logSpy).toHaveBeenCalledWith('unhandled_error', expect.objectContaining({ errorType: 'Error' }));
  });

  it('never logs Prisma validation messages (they can contain query values)', async () => {
    const logSpy = vi.spyOn(logger, 'error');
    const testApp = harness((router) =>
      router.get('/prisma', () => {
        throw new Prisma.PrismaClientValidationError('where: { name: "Asha Kumari" }', {
          clientVersion: Prisma.prismaVersion.client,
        });
      }),
    );

    const res = await request(testApp).get('/prisma');
    expect(res.status).toBe(500);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('Asha');
  });

  it('maps AppError to its status and code', async () => {
    const testApp = harness((router) =>
      router.get('/missing', () => {
        throw AppError.notFound('Child not found');
      }),
    );
    const res = await request(testApp).get('/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Child not found' });
  });
});

describe('describeError', () => {
  it('keeps only the code for known Prisma request errors', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on value 9876543210', {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
    });
    const meta = describeError(error);
    expect(meta).toMatchObject({ errorType: 'PrismaClientKnownRequestError', prismaCode: 'P2002' });
    expect(JSON.stringify(meta)).not.toContain('9876543210');
  });
});

describe('validate middleware', () => {
  const testApp = harness((router) =>
    router.post(
      '/measure',
      validate({ body: z.object({ heightCm: z.number().positive() }) }),
      (_req, res) => {
        res.json(res.locals.validated);
      },
    ),
  );

  it('rejects invalid input with field-level details', async () => {
    const res = await request(testApp).post('/measure').send({ heightCm: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('heightCm');
  });

  it('strips unknown fields (no mass assignment)', async () => {
    const res = await request(testApp).post('/measure').send({ heightCm: 90, role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ heightCm: 90 });
  });
});

describe('request id, headers and CORS', () => {
  it('reuses a well-formed client request id', async () => {
    const res = await request(app).get('/api/v1/health').set('x-request-id', 'abcdef12-3456');
    expect(res.headers['x-request-id']).toBe('abcdef12-3456');
  });

  it('replaces a malformed client request id', async () => {
    const res = await request(app).get('/api/v1/health').set('x-request-id', 'bad id<script>');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('allows listed browser origins only', async () => {
    const allowed = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:8081');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');

    const blocked = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
