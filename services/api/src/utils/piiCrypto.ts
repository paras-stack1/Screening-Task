import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { AppError } from './AppError';

/**
 * Application-level protection of guardian phone numbers (decision D5 / Step 5 decision F).
 *
 *  - encrypt/decrypt: AES-256-GCM. Stored format: [version=1][12-byte IV][16-byte tag][ciphertext].
 *    The guardian id is bound as additional authenticated data, so a ciphertext copied onto
 *    another guardian row fails to decrypt.
 *  - lookupHash: HMAC-SHA256 of the normalised number with a separate key, so duplicates can be
 *    found without decrypting and without a plain hash that could be brute-forced (the space of
 *    Indian mobile numbers is small).
 *
 * Keys come from the secret manager (env). They are never logged. Key rotation: bump the version
 * byte and keep the old key for decryption (not needed yet).
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface PiiKeys {
  encryptionKey?: Buffer | undefined;
  lookupKey?: Buffer | undefined;
}

export interface PiiCrypto {
  readonly available: boolean;
  encryptPhone(normalized: string, guardianId: string): Uint8Array<ArrayBuffer>;
  decryptPhone(stored: Uint8Array, guardianId: string): string;
  phoneLookupHash(normalized: string): string;
  /**
   * Free text that may contain personal or health details (Step 6F): AES-256-GCM with the same
   * key, stored in a text column as `enc1:<base64 of [version][IV][tag][ciphertext]>`. `context`
   * is bound as additional authenticated data (record + field), so a value copied to another
   * place does not decrypt.
   */
  encryptText(plain: string, context: string): string;
  decryptText(stored: string, context: string): string;
}

export const TEXT_PREFIX = 'enc1:';

function unavailable(): AppError {
  // Configuration problem, not a client error: phone numbers must never be stored unprotected.
  return new AppError(
    503,
    'PHONE_STORAGE_UNAVAILABLE',
    'Phone numbers cannot be saved right now. Save without a phone number or try again later.',
  );
}

export function createPiiCrypto({ encryptionKey, lookupKey }: PiiKeys): PiiCrypto {
  const available = Boolean(encryptionKey && lookupKey);
  const aad = (guardianId: string) => Buffer.from(`guardian:${guardianId}:phone`, 'utf8');

  return {
    available,

    encryptPhone(normalized, guardianId) {
      if (!encryptionKey) throw unavailable();
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      cipher.setAAD(aad(guardianId));
      const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
      const out = new Uint8Array(new ArrayBuffer(1 + IV_BYTES + TAG_BYTES + ciphertext.length));
      out[0] = VERSION;
      out.set(iv, 1);
      out.set(cipher.getAuthTag(), 1 + IV_BYTES);
      out.set(ciphertext, 1 + IV_BYTES + TAG_BYTES);
      return out;
    },

    decryptPhone(stored, guardianId) {
      if (!encryptionKey) throw unavailable();
      const data = Buffer.from(stored);
      if (data.length <= 1 + IV_BYTES + TAG_BYTES || data[0] !== VERSION) {
        throw new Error('Unsupported phone ciphertext format');
      }
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(1, 1 + IV_BYTES));
      decipher.setAAD(aad(guardianId));
      decipher.setAuthTag(data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    },

    phoneLookupHash(normalized) {
      if (!lookupKey) throw unavailable();
      return createHmac('sha256', lookupKey).update(normalized, 'utf8').digest('hex');
    },

    encryptText(plain, context) {
      if (!encryptionKey) throw textUnavailable();
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      cipher.setAAD(Buffer.from(`text:${context}`, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const packed = Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
      return TEXT_PREFIX + packed.toString('base64');
    },

    decryptText(stored, context) {
      if (!stored.startsWith(TEXT_PREFIX)) {
        // Never served as if it were protected: plaintext here means data written outside the API.
        throw new Error('Unencrypted sensitive text found');
      }
      if (!encryptionKey) throw textUnavailable();
      const data = Buffer.from(stored.slice(TEXT_PREFIX.length), 'base64');
      if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== VERSION) {
        throw new Error('Unsupported text ciphertext format');
      }
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(1, 1 + IV_BYTES));
      decipher.setAAD(Buffer.from(`text:${context}`, 'utf8'));
      decipher.setAuthTag(data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

function textUnavailable(): AppError {
  return new AppError(
    503,
    'SENSITIVE_TEXT_UNAVAILABLE',
    'Notes and text answers cannot be saved or shown right now. Try again later.',
  );
}
