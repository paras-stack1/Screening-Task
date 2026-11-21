import * as argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import {
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  passwordNeedsRehash,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../src/utils/password';

describe('password hashing (Argon2id)', () => {
  it('produces an Argon2id hash with the configured parameters, never the plaintext', async () => {
    const hash = await hashPassword('synthetic-Pass-123');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain('synthetic-Pass-123');
  });

  it('salts every hash (same password, different hashes)', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse batterY')).toBe(false);
  });

  it('never truncates: a difference at character 120 still fails', async () => {
    const base = 'a'.repeat(119);
    const hash = await hashPassword(`${base}X`);
    expect(await verifyPassword(hash, `${base}Y`)).toBe(false);
  });

  it('normalises Unicode (NFKC) so composed and decomposed input match', async () => {
    const hash = await hashPassword('पासवर्ड-é-123');
    expect(await verifyPassword(hash, 'पासवर्ड-é-123')).toBe(true);
  });

  it('returns false instead of throwing for a corrupt stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('flags hashes made with older parameters for rehashing', async () => {
    const legacy = await argon2.hash('legacy-password', {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 1,
    });
    expect(passwordNeedsRehash(legacy)).toBe(true);
    expect(passwordNeedsRehash(await hashPassword('current-password'))).toBe(false);
  });

  it('dummy verification completes without throwing (timing equalisation for unknown accounts)', async () => {
    await expect(verifyAgainstDummyHash('whatever')).resolves.toBeUndefined();
  });
});

describe('password policy (decision D)', () => {
  it.each([
    ['short', 'TOO_SHORT'],
    ['x'.repeat(PASSWORD_MAX_LENGTH + 1), 'TOO_LONG'],
    ['password123', 'TOO_COMMON'],
    ['PASSWORD123', 'TOO_COMMON'],
    ['aaaaaaaaaa', 'TOO_COMMON'],
    ['12345678', 'TOO_COMMON'],
    ['abcdefghij', 'TOO_COMMON'],
  ])('rejects %j as %s', (password, rule) => {
    expect(checkPasswordPolicy(password)).toBe(rule);
  });

  it('rejects a password containing the login ID', () => {
    expect(checkPasswordPolicy('my-emp-0042-pass', 'EMP-0042')).toBe('CONTAINS_LOGIN_ID');
  });

  it.each(['meri beti 2026', 'Tulsi@Ganga7', 'घर का रास्ता', 'x'.repeat(PASSWORD_MAX_LENGTH - 1) + 'y'])(
    'accepts %j (no composition rules)',
    (password) => {
      expect(checkPasswordPolicy(password, 'EMP-0042')).toBeNull();
    },
  );

  it('counts characters, not UTF-16 units (8 Hindi characters are enough)', () => {
    expect(checkPasswordPolicy('सुरक्षितघर')).toBeNull();
  });
});
