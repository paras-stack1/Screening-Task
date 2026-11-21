import { createHash } from 'node:crypto';
import type { ConsentPurpose } from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Consent notice wording (Step 5 decision I).
 *
 * !!! EVERY TEXT BELOW IS A PLACEHOLDER WRITTEN BY THE ENGINEERING TEAM. !!!
 * It is NOT approved legal, medical or programme wording and must not be used with real families.
 * The Hindi text is an engineering draft and also needs review by a qualified translator.
 * Production refuses DRAFT notices (consent policy `allowDraftNotices: false`).
 *
 * How wording changes (never edit a published version in place):
 *  1. Add a NEW entry with version + 1 for the purpose and BOTH languages.
 *  2. Run the seed (creates the DRAFT ConsentTemplate rows with the text hashes).
 *  3. Approval: set the template rows to APPROVED with approvalReference/approvedAt (a DBA step;
 *     there is deliberately no API for it yet), and RETIRE the old version if renewal is required.
 * Old entries stay here so history screens can show exactly what a guardian was shown.
 *
 * The database stores only the SHA-256 of {title, body}; the API refuses to record a decision
 * against a template whose hash does not match the text it serves (wording drift).
 */
export interface ConsentNoticeText {
  purpose: ConsentPurpose;
  version: number;
  language: 'hi' | 'en';
  title: string;
  body: string;
  isPlaceholder: boolean;
}

/** Screening participation is the programme activity itself; every other purpose is optional. */
export const OPTIONAL_PURPOSES: ReadonlySet<ConsentPurpose> = new Set<ConsentPurpose>([
  'PHOTO_CAPTURE',
  'VIDEO_CAPTURE',
  'AUDIO_CAPTURE',
  'AI_PROCESSING',
  'REFERRAL_DATA_SHARING',
  'SMS_REMINDERS',
]);

const MARK_EN = '[PLACEHOLDER - NOT APPROVED WORDING. DO NOT USE WITH FAMILIES.]';
const MARK_HI = '[अस्थायी पाठ - स्वीकृत शब्द नहीं। परिवारों के साथ उपयोग न करें।]';
const OPTIONAL_EN =
  'This is optional. Saying no will not stop your child from receiving the other programme services.';
const OPTIONAL_HI = 'यह वैकल्पिक है। मना करने पर भी आपके बच्चे को कार्यक्रम की अन्य सेवाएँ मिलती रहेंगी।';
const WITHDRAW_EN = 'You can change your mind later by telling the health worker.';
const WITHDRAW_HI = 'आप बाद में स्वास्थ्य कार्यकर्ता को बताकर अपना निर्णय बदल सकते हैं।';

const PLACEHOLDERS: Record<ConsentPurpose, { en: [string, string]; hi: [string, string] }> = {
  SCREENING: {
    en: [
      'Child health check',
      'The health worker would like to check your child for health and development needs under the government child health programme, and keep a record of the check.',
    ],
    hi: [
      'बच्चे की स्वास्थ्य जाँच',
      'स्वास्थ्य कार्यकर्ता सरकारी बाल स्वास्थ्य कार्यक्रम के अंतर्गत आपके बच्चे के स्वास्थ्य और विकास की जाँच करना और जाँच का रिकॉर्ड रखना चाहते हैं।',
    ],
  },
  PHOTO_CAPTURE: {
    en: [
      'Photographs',
      'The health worker would like to take photographs of your child as part of the health check.',
    ],
    hi: [
      'फ़ोटो',
      'स्वास्थ्य कार्यकर्ता स्वास्थ्य जाँच के हिस्से के रूप में आपके बच्चे की फ़ोटो लेना चाहते हैं।',
    ],
  },
  VIDEO_CAPTURE: {
    en: [
      'Video recording',
      'The health worker would like to record a short video of your child as part of the health check.',
    ],
    hi: [
      'वीडियो रिकॉर्डिंग',
      'स्वास्थ्य कार्यकर्ता स्वास्थ्य जाँच के हिस्से के रूप में आपके बच्चे का छोटा वीडियो रिकॉर्ड करना चाहते हैं।',
    ],
  },
  AUDIO_CAPTURE: {
    en: [
      'Voice recording',
      "The health worker would like to record your child's voice as part of the health check.",
    ],
    hi: [
      'आवाज़ की रिकॉर्डिंग',
      'स्वास्थ्य कार्यकर्ता स्वास्थ्य जाँच के हिस्से के रूप में आपके बच्चे की आवाज़ रिकॉर्ड करना चाहते हैं।',
    ],
  },
  AI_PROCESSING: {
    en: [
      'Computer-assisted checking',
      'Photos, videos or recordings you have separately agreed to may be checked by a computer program that helps health workers notice possible concerns. The program does not make a diagnosis; a health worker or doctor reviews the result.',
    ],
    hi: [
      'कंप्यूटर की सहायता से जाँच',
      'जिन फ़ोटो, वीडियो या रिकॉर्डिंग के लिए आपने अलग से सहमति दी है, उन्हें एक कंप्यूटर प्रोग्राम से जाँचा जा सकता है जो स्वास्थ्य कार्यकर्ताओं को संभावित समस्याएँ पहचानने में मदद करता है। यह प्रोग्राम कोई निदान नहीं करता; परिणाम को स्वास्थ्य कार्यकर्ता या डॉक्टर देखते हैं।',
    ],
  },
  REFERRAL_DATA_SHARING: {
    en: [
      'Sharing with a referral facility',
      "If your child needs further care, the health worker would like to share your child's health check record with the health facility your child is referred to.",
    ],
    hi: [
      'रेफ़रल केंद्र के साथ जानकारी साझा करना',
      'यदि आपके बच्चे को आगे इलाज की ज़रूरत हो, तो स्वास्थ्य कार्यकर्ता आपके बच्चे की जाँच का रिकॉर्ड उस स्वास्थ्य केंद्र के साथ साझा करना चाहते हैं जहाँ बच्चे को भेजा जाएगा।',
    ],
  },
  SMS_REMINDERS: {
    en: [
      'Text message reminders',
      'The programme would like to send reminders about follow-up visits to your phone number by text message.',
    ],
    hi: [
      'एसएमएस अनुस्मारक',
      'कार्यक्रम आपके फ़ोन नंबर पर फ़ॉलो-अप के बारे में एसएमएस से अनुस्मारक भेजना चाहता है।',
    ],
  },
};

function buildPlaceholders(): ConsentNoticeText[] {
  const notices: ConsentNoticeText[] = [];
  for (const [purpose, text] of Object.entries(PLACEHOLDERS) as Array<
    [ConsentPurpose, (typeof PLACEHOLDERS)[ConsentPurpose]]
  >) {
    const optional = OPTIONAL_PURPOSES.has(purpose);
    notices.push({
      purpose,
      version: 1,
      language: 'en',
      title: text.en[0],
      body: [MARK_EN, text.en[1], optional ? OPTIONAL_EN : '', WITHDRAW_EN].filter(Boolean).join('\n\n'),
      isPlaceholder: true,
    });
    notices.push({
      purpose,
      version: 1,
      language: 'hi',
      title: text.hi[0],
      body: [MARK_HI, text.hi[1], optional ? OPTIONAL_HI : '', WITHDRAW_HI].filter(Boolean).join('\n\n'),
      isPlaceholder: true,
    });
  }
  return notices;
}

/** Every notice version ever published (append new versions; never edit or remove). */
export const CONSENT_NOTICES: readonly ConsentNoticeText[] = buildPlaceholders();

export function noticeHash(notice: Pick<ConsentNoticeText, 'title' | 'body'>): string {
  return createHash('sha256')
    .update(JSON.stringify({ title: notice.title, body: notice.body }), 'utf8')
    .digest('hex');
}

export function findNoticeText(
  purpose: string,
  version: number,
  language: string,
): ConsentNoticeText | undefined {
  return CONSENT_NOTICES.find(
    (n) => n.purpose === purpose && n.version === version && n.language === language,
  );
}

/**
 * Creates missing ConsentTemplate rows (as DRAFT) for every notice in the registry. Never
 * changes an existing row: approval status is managed separately. Returns rows whose stored hash
 * differs from the registry text (wording drift - must be investigated, never auto-fixed).
 */
export async function ensureConsentTemplates(db: PrismaClient | Prisma.TransactionClient): Promise<string[]> {
  const drift: string[] = [];
  for (const notice of CONSENT_NOTICES) {
    const key = { purpose: notice.purpose, version: notice.version, languageCode: notice.language };
    const existing = await db.consentTemplate.findUnique({ where: { purpose_version_languageCode: key } });
    if (!existing) {
      await db.consentTemplate.create({ data: { ...key, textSha256: noticeHash(notice), status: 'DRAFT' } });
    } else if (existing.textSha256 !== noticeHash(notice)) {
      drift.push(`${notice.purpose} v${notice.version} ${notice.language}`);
    }
  }
  return drift;
}
