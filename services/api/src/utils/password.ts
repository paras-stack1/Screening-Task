import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * Password hashing and policy (decision D: 8-128 characters, no composition rules, common
 * passwords and the login ID refused).
 *
 * - Argon2id with the OWASP baseline parameters (19 MiB, 2 iterations, 1 lane). Memory is kept
 *   modest on purpose: a flood of login attempts must not exhaust server memory.
 * - Passwords are Unicode-normalised (NFKC) before hashing and verifying, so the same password
 *   typed on different keyboards matches. They are never truncated: over-long input is refused.
 * - Verification is constant-time inside the argon2 library.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

function normalize(password: string): string {
  return password.normalize('NFKC');
}

/** Length in characters (code points), not UTF-16 units, so Hindi text is counted fairly. */
function characterCount(value: string): number {
  return [...value].length;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(normalize(password), ARGON2_OPTIONS);
}

/** Returns false (never throws) for a wrong password or an unreadable stored hash. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, normalize(password));
  } catch {
    return false;
  }
}

/** True when the stored hash uses older parameters and should be re-hashed after a successful login. */
export function passwordNeedsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return true;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same verification time as a real check. Used when the account does not exist, so
 * response timing does not reveal which login IDs are registered.
 */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, password);
}

/**
 * A short block-list of the most common passwords and obvious patterns. Not exhaustive; the
 * real protection against guessing is Argon2id plus rate limiting and temporary lockout.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'welcome1',
  'welcome123',
  'admin123',
  'administrator',
  'letmein1',
  'abc12345',
  'abcd1234',
  'india123',
  'bharat123',
  'changeme',
  'balswasthya',
  'balswasthya123',
  'asha1234',
  'anganwadi',
]);

export type PasswordPolicyViolation = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_COMMON' | 'CONTAINS_LOGIN_ID';

export function checkPasswordPolicy(password: string, loginId?: string): PasswordPolicyViolation | null {
  const normalized = normalize(password);
  const length = characterCount(normalized);
  if (length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';

  const lower = normalized.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'TOO_COMMON';
  // One repeated character (e.g. "aaaaaaaa") or a plain digit/letter run.
  if (/^(.)\1+$/u.test(lower)) return 'TOO_COMMON';
  if ('0123456789012345678901234567890'.includes(lower) || 'abcdefghijklmnopqrstuvwxyz'.includes(lower)) {
    return 'TOO_COMMON';
  }
  if (loginId && loginId.length >= 4 && lower.includes(loginId.toLowerCase())) return 'CONTAINS_LOGIN_ID';
  return null;
}

export const PASSWORD_POLICY_MESSAGES: Record<PasswordPolicyViolation, string> = {
  TOO_SHORT: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  TOO_LONG: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  TOO_COMMON: 'Password is too common or too easy to guess',
  CONTAINS_LOGIN_ID: 'Password must not contain your login ID',
};

/** Unambiguous characters only (no 0/O, 1/I/L), so it can be read aloud or copied by hand. */
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * A one-time password issued by an administrator (account creation, password reset). Format
 * XXXX-XXXX-XXXX: 12 random characters from 31 symbols, about 59 bits. The account is created
 * with mustChangePassword = true, so it only works until the user chooses their own password.
 */
export function generateTemporaryPassword(): string {
  const chars = Array.from(
    { length: 12 },
    () => TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)],
  );
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((group) => group.join('')).join('-');
}
