import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';

const validProduction = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:pw@db.internal:5432/balswasthya?sslmode=require',
  JWT_SECRET: 'x'.repeat(48),
  CORS_ORIGINS: 'https://admin.example.in',
  AI_SERVICE_URL: 'https://ai.internal.example.in',
  AI_SERVICE_API_KEY: 'k'.repeat(40),
};

function failingPaths(source: Record<string, string | undefined>): string[] {
  const result = parseEnv(source);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('environment configuration', () => {
  it('accepts a minimal development configuration with defaults', () => {
    const result = parseEnv({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/dev' });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ NODE_ENV: 'development', PORT: 4000, CORS_ORIGINS: [] });
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(failingPaths({ DATABASE_URL: 'mysql://u:p@localhost/db' })).toContain('DATABASE_URL');
  });

  it('rejects a short JWT secret in any environment', () => {
    expect(failingPaths({ DATABASE_URL: 'postgresql://u:p@h/db', JWT_SECRET: 'short' })).toContain(
      'JWT_SECRET',
    );
  });

  it('accepts a secure production configuration', () => {
    expect(failingPaths(validProduction)).toEqual([]);
  });

  it('allows an empty CORS list in production (blocks all browsers)', () => {
    expect(failingPaths({ ...validProduction, CORS_ORIGINS: '' })).toEqual([]);
  });

  it.each([
    ['JWT_SECRET', { JWT_SECRET: undefined }],
    ['CORS_ORIGINS', { CORS_ORIGINS: 'https://ok.example.in,http://insecure.example.in' }],
    ['AI_SERVICE_URL', { AI_SERVICE_URL: 'http://ai.internal' }],
    ['AI_SERVICE_API_KEY', { AI_SERVICE_API_KEY: '' }],
    ['DATABASE_URL', { DATABASE_URL: 'postgresql://app:pw@db.internal:5432/balswasthya' }],
    ['DATABASE_URL', { DATABASE_URL: 'postgresql://app:pw@db.internal:5432/balswasthya?sslmode=prefer' }],
  ])('production rejects an insecure %s', (path, override) => {
    expect(failingPaths({ ...validProduction, ...override })).toContain(path);
  });
});
