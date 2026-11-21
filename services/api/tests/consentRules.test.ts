import {
  CONSENT_PURPOSES,
  recordConsentRequestSchema,
  withdrawConsentRequestSchema,
} from '@balswasthya/shared-contracts';
import { describe, expect, it } from 'vitest';
import {
  CONSENT_NOTICES,
  findNoticeText,
  noticeHash,
  OPTIONAL_PURPOSES,
} from '../src/modules/consent/consentNotices';
import { ACTIVITY_CONSENTS } from '../src/modules/consent/consentPolicy';

/** Step 5 consent rules that need no database. */
describe('consent notice registry (decision I)', () => {
  it('has a notice for every purpose in Hindi and English', () => {
    for (const purpose of CONSENT_PURPOSES) {
      for (const language of ['hi', 'en']) {
        expect(findNoticeText(purpose, 1, language), `${purpose} ${language}`).toBeDefined();
      }
    }
  });

  it('every current notice is visibly marked as a placeholder (no approved wording exists yet)', () => {
    for (const notice of CONSENT_NOTICES) {
      expect(notice.isPlaceholder).toBe(true);
      expect(notice.body.split('\n')[0]).toMatch(/^\[/);
    }
  });

  it('optional purposes say so in both languages; screening is the only non-optional purpose', () => {
    expect([...CONSENT_PURPOSES].filter((p) => !OPTIONAL_PURPOSES.has(p))).toEqual(['SCREENING']);
    for (const notice of CONSENT_NOTICES.filter((n) => OPTIONAL_PURPOSES.has(n.purpose))) {
      expect(notice.body).toMatch(notice.language === 'en' ? /optional/ : /वैकल्पिक/);
    }
  });

  it('hash is stable and changes with any wording change (drift detection)', () => {
    const notice = findNoticeText('SCREENING', 1, 'en')!;
    expect(noticeHash(notice)).toBe(noticeHash({ title: notice.title, body: notice.body }));
    expect(noticeHash({ ...notice, body: `${notice.body} ` })).not.toBe(noticeHash(notice));
    expect(noticeHash(notice)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no duplicate (purpose, version, language) entries', () => {
    const keys = CONSENT_NOTICES.map((n) => `${n.purpose}:${n.version}:${n.language}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('activity requirements never let one consent imply another', () => {
  it('AI analysis requires both the recording consent and AI processing', () => {
    expect(ACTIVITY_CONSENTS.AI_IMAGE_ANALYSIS).toEqual(['SCREENING', 'PHOTO_CAPTURE', 'AI_PROCESSING']);
    expect(ACTIVITY_CONSENTS.AI_VIDEO_ANALYSIS).toContain('VIDEO_CAPTURE');
    expect(ACTIVITY_CONSENTS.AI_AUDIO_ANALYSIS).toContain('AUDIO_CAPTURE');
  });

  it('each capture needs its own purpose (photo is not video or audio)', () => {
    expect(ACTIVITY_CONSENTS.PHOTO_CAPTURE).not.toContain('VIDEO_CAPTURE');
    expect(ACTIVITY_CONSENTS.VIDEO_CAPTURE).not.toContain('PHOTO_CAPTURE');
    expect(ACTIVITY_CONSENTS.AUDIO_CAPTURE).not.toContain('PHOTO_CAPTURE');
  });
});

describe('consent request schemas', () => {
  const valid = {
    clientOperationId: '11111111-1111-4111-8111-111111111111',
    guardianId: '22222222-2222-4222-8222-222222222222',
    purpose: 'PHOTO_CAPTURE',
    decision: 'GRANTED',
    method: 'SIGNATURE',
    templateId: '33333333-3333-4333-8333-333333333333',
  };

  it('accepts one purpose with an explicit decision', () => {
    expect(recordConsentRequestSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['no decision (never defaulted to granted)', { decision: undefined }],
    ['boolean decision', { decision: true }],
    ['pending is not a recordable decision', { decision: 'PENDING' }],
    ['no notice', { templateId: undefined }],
    ['no guardian', { guardianId: undefined }],
    ['verification flag from the client', { verified: true }],
    ['actor from the client', { recordedById: valid.guardianId }],
  ])('rejects %s', (_name, override) => {
    expect(recordConsentRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('withdrawal needs the requesting guardian and a method; no timestamps from the client', () => {
    expect(
      withdrawConsentRequestSchema.safeParse({ guardianId: valid.guardianId, method: 'SIGNATURE' }).success,
    ).toBe(true);
    expect(withdrawConsentRequestSchema.safeParse({ guardianId: valid.guardianId }).success).toBe(false);
    expect(
      withdrawConsentRequestSchema.safeParse({
        guardianId: valid.guardianId,
        method: 'SIGNATURE',
        withdrawnAt: '2020-01-01',
      }).success,
    ).toBe(false);
  });
});
