import { z } from 'zod';

/**
 * Validates environment variables once at startup. The process refuses to start
 * with a missing or malformed configuration instead of failing later at runtime.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** PostgreSQL sslmode values that actually enforce TLS. */
const SECURE_DB_SSL_MODES = new Set(['require', 'verify-ca', 'verify-full']);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine((url) => url.startsWith('postgresql://') || url.startsWith('postgres://'), {
        message: 'DATABASE_URL must be a PostgreSQL connection string',
      }),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    // Optional in development until the auth step; required in production (see below).
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
    AI_SERVICE_URL: z
      .union([z.literal(''), z.url()])
      .default('')
      .transform((value) => value.replace(/\/+$/, '')),
    AI_SERVICE_API_KEY: z.string().default(''),
    AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    /** Defaults: "silent" under NODE_ENV=test, otherwise "info". */
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Production guard: refuse insecure settings that are acceptable on a laptop.
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

    if (!env.JWT_SECRET) {
      fail('JWT_SECRET', 'is required in production');
    }
    // An empty list is allowed: it blocks all browser origins (native apps send no Origin).
    if (env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      fail('CORS_ORIGINS', 'every origin must use https:// in production');
    }
    if (env.AI_SERVICE_URL) {
      if (!env.AI_SERVICE_URL.startsWith('https://')) {
        fail('AI_SERVICE_URL', 'must use https:// in production');
      }
      if (env.AI_SERVICE_API_KEY.length < 32) {
        fail('AI_SERVICE_API_KEY', 'must be set (at least 32 characters) in production');
      }
    }
    if (!SECURE_DB_SSL_MODES.has(readSslMode(env.DATABASE_URL) ?? '')) {
      fail('DATABASE_URL', 'must set sslmode=require, verify-ca or verify-full in production');
    }
  });

function readSslMode(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).searchParams.get('sslmode');
  } catch {
    return null;
  }
}

export type Env = z.infer<typeof envSchema>;

/** Pure parser (no side effects) so configuration rules can be unit tested. */
export function parseEnv(source: Record<string, string | undefined>) {
  return envSchema.safeParse(source);
}

function loadEnv(): Env {
  const parsed = parseEnv(process.env);
  if (!parsed.success) {
    // Print only variable names and problems - never the values (they may be secrets).
    // console is used deliberately: the logger depends on this configuration.
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${problems.join('\n')}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
