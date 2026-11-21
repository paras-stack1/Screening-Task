import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque refresh tokens: 256 bits from the operating system's CSPRNG, base64url-encoded
 * (43 characters). Only the SHA-256 hash is stored. A salt is unnecessary because the token is
 * random and high-entropy (it cannot be guessed or found in a precomputed table).
 */
export const REFRESH_TOKEN_BYTES = 32;

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
