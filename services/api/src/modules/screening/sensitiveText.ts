import type { PiiCrypto } from '../../utils/piiCrypto';

/**
 * Encryption of screening free text (Step 6F): text answers, answer notes, not-assessed reasons,
 * area notes, measurement notes and correction reasons, cancel reasons. These are the fields most
 * likely to contain personal or health details. Structured answers (yes/no, codes, numbers) stay
 * queryable for later reporting.
 *
 * Every value is bound to its session and exact field, e.g.
 *   screening:<sessionId>:obs:<questionId>:notes
 *   screening:<sessionId>:cat:DISEASES:notes
 *   screening:<sessionId>:measurement:<measurementId>:correctionReason
 *   screening:<sessionId>:session:cancelReason
 * so a ciphertext moved to another row or field fails to decrypt.
 */
export type TextField =
  | { kind: 'obs'; questionId: string; field: 'valueText' | 'notes' | 'notAssessedReason' }
  | { kind: 'cat'; category: string; field: 'notes' }
  | { kind: 'measurement'; measurementId: string; field: 'notes' | 'correctionReason' }
  | { kind: 'session'; field: 'cancelReason' }
  // Step 6G amendments: the reason / review notes, and free text inside old/new values.
  | { kind: 'amendment'; amendmentId: string; field: 'reason' | 'reviewNotes' }
  | {
      kind: 'amendmentChange';
      changeId: string;
      side: 'old' | 'new';
      field: 'value' | 'notes' | 'notAssessedReason';
    };

function contextOf(sessionId: string, f: TextField): string {
  switch (f.kind) {
    case 'obs':
      return `screening:${sessionId}:obs:${f.questionId}:${f.field}`;
    case 'cat':
      return `screening:${sessionId}:cat:${f.category}:${f.field}`;
    case 'measurement':
      return `screening:${sessionId}:measurement:${f.measurementId}:${f.field}`;
    case 'session':
      return `screening:${sessionId}:session:${f.field}`;
    case 'amendment':
      return `screening:${sessionId}:amendment:${f.amendmentId}:${f.field}`;
    case 'amendmentChange':
      return `screening:${sessionId}:amendmentChange:${f.changeId}:${f.side}:${f.field}`;
  }
}

export interface SessionTextSealer {
  seal(field: TextField, value: string | null | undefined): string | null;
  open(field: TextField, value: string | null): string | null;
}

export function sessionTextSealer(pii: PiiCrypto, sessionId: string): SessionTextSealer {
  return {
    seal: (field, value) =>
      value === null || value === undefined ? null : pii.encryptText(value, contextOf(sessionId, field)),
    open: (field, value) => (value === null ? null : pii.decryptText(value, contextOf(sessionId, field))),
  };
}
