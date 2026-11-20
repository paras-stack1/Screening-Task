import pino, { type DestinationStream, type LevelWithSilent, type Logger as PinoLogger } from 'pino';
import { env } from '../config/env';

/**
 * Structured JSON logger (pino).
 *
 * PRIVACY RULE: never log request bodies, child names, dates of birth, phone
 * numbers, Aadhaar-like identifiers, tokens or passwords.
 *
 * The redaction list below is a SAFETY NET for common secret/PII field names. It
 * cannot catch personal data stored under other keys, so the rule above still applies.
 */
const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'authorization',
  'cookie',
  'apiKey',
  'secret',
  'jwt',
  'otp',
  'phone',
  'phoneNumber',
  'mobile',
  'dateOfBirth',
  'dob',
  'aadhaar',
  'fullName',
  'childName',
  'guardianName',
] as const;

/** Redacted at the top level and one level deep (e.g. `{ user: { password } }`). */
export const REDACT_PATHS = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
  'headers["x-api-key"]',
  '*.headers["x-api-key"]',
];

export type LogMeta = Record<string, unknown>;

export interface AppLogger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  fatal(message: string, meta?: LogMeta): void;
}

/** Keeps the call style `logger.info('event_name', { ...meta })` independent of pino's API. */
function wrap(instance: PinoLogger): AppLogger {
  return {
    debug: (message, meta) => instance.debug(meta ?? {}, message),
    info: (message, meta) => instance.info(meta ?? {}, message),
    warn: (message, meta) => instance.warn(meta ?? {}, message),
    error: (message, meta) => instance.error(meta ?? {}, message),
    fatal: (message, meta) => instance.fatal(meta ?? {}, message),
  };
}

export function createLogger(level: LevelWithSilent, destination?: DestinationStream): AppLogger {
  const instance = pino(
    {
      level,
      base: undefined, // omit pid/hostname
      messageKey: 'message',
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    destination,
  );
  return wrap(instance);
}

const defaultLevel: LevelWithSilent = env.NODE_ENV === 'test' ? 'silent' : 'info';

export const logger = createLogger(env.LOG_LEVEL ?? defaultLevel);
