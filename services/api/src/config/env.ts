import { z } from 'zod';

/**
 * Validates environment variables once at startup. The process refuses to start
 * with a missing or malformed configuration instead of failing later at runtime.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** PostgreSQL sslmode values that actually enforce TLS. */
const SECURE_DB_SSL_MODES = new Set(['require', 'verify-ca', 'verify-full']);

/** A base64-encoded secret of the given decoded length; empty string = not set. */
function base64Key(minBytes: number, maxBytes: number) {
  return z.string().transform((value, ctx) => {
    if (value === '') return undefined;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'must be base64' });
      return z.NEVER;
    }
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length < minBytes || bytes.length > maxBytes) {
      ctx.addIssue({
        code: 'custom',
        message:
          minBytes === maxBytes
            ? `must decode to exactly ${minBytes} bytes`
            : `must decode to ${minBytes}-${maxBytes} bytes`,
      });
      return z.NEVER;
    }
    return bytes;
  });
}

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
    /** HS256 signing key for access tokens. Use a different random value in every environment. */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    /** Defaults include NODE_ENV so a token from one environment is rejected by another. */
    JWT_ISSUER: z.string().min(1).optional(),
    JWT_AUDIENCE: z.string().min(1).default('balswasthya-worker-app'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    REFRESH_TOKEN_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(180).default(30),
    /** Number of reverse proxies in front of the API (0 = direct). Needed for correct client IPs. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    AI_SERVICE_URL: z
      .union([z.literal(''), z.url()])
      .default('')
      .transform((value) => value.replace(/\/+$/, '')),
    AI_SERVICE_API_KEY: z.string().default(''),
    AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    /**
     * Guardian phone protection (decision D5/F). Base64. PII_ENCRYPTION_KEY: exactly 32 bytes
     * (AES-256-GCM). PII_LOOKUP_KEY: 32+ bytes (HMAC-SHA256 for duplicate search). Required in
     * production; without them elsewhere, phone numbers cannot be stored (503).
     */
    PII_ENCRYPTION_KEY: base64Key(32, 32).optional(),
    PII_LOOKUP_KEY: base64Key(32, 128).optional(),
    /** Defaults: "silent" under NODE_ENV=test, otherwise "info". */
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
    /** Owner credentials for Prisma Migrate. Only checked here so production can refuse them. */
    MIGRATION_DATABASE_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

    if (env.REFRESH_TOKEN_ABSOLUTE_DAYS < env.REFRESH_TOKEN_IDLE_DAYS) {
      fail('REFRESH_TOKEN_ABSOLUTE_DAYS', 'must be greater than or equal to REFRESH_TOKEN_IDLE_DAYS');
    }

    if (env.NODE_ENV !== 'production') return;

    // Production guard: refuse insecure settings that are acceptable on a laptop.
    if (/replace_with|change_me|example/i.test(env.JWT_SECRET)) {
      fail('JWT_SECRET', 'must not be a placeholder value in production');
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
    if (!env.PII_ENCRYPTION_KEY) fail('PII_ENCRYPTION_KEY', 'is required in production');
    if (!env.PII_LOOKUP_KEY) fail('PII_LOOKUP_KEY', 'is required in production');
    if (
      env.PII_ENCRYPTION_KEY &&
      env.PII_LOOKUP_KEY &&
      Buffer.compare(env.PII_ENCRYPTION_KEY, env.PII_LOOKUP_KEY) === 0
    ) {
      fail('PII_LOOKUP_KEY', 'must differ from PII_ENCRYPTION_KEY');
    }
    // Least privilege: the running API must not hold schema-owner credentials.
    if (env.MIGRATION_DATABASE_URL) {
      fail('MIGRATION_DATABASE_URL', 'must not be set for the running API in production');
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
