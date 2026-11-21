/**
 * Login IDs are employee codes (decision D6). They are normalised the same way when an account
 * is created and when a user signs in: Unicode NFKC, trimmed, upper-case. So " emp-0042 " and
 * "EMP-0042" are the same account.
 */
export function normalizeLoginId(raw: string): string {
  return raw.normalize('NFKC').trim().toUpperCase();
}

/** Format accepted when an account is created (users module). Sign-in accepts any string. */
export const LOGIN_ID_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,63}$/;
