import type { ParentLegalDocument } from '@balswasthya/shared-contracts';

/**
 * Parent Portal privacy notice and terms of use (Step 8, PP13).
 *
 * THE WORDING BELOW IS A PLACEHOLDER. No approved legal / programme text exists yet (DPDP Act
 * review pending). Every document is served with `isPlaceholder: true` and a visible first line.
 * Activation in production is refused while the current version is a placeholder
 * (`allowDraftLegal` is false in production).
 *
 * To publish approved wording: add the approved text as a NEW version (never edit a published
 * version - accounts record which version they accepted), set isPlaceholder false, and update
 * CURRENT_VERSIONS. Accepting these documents is NOT consent to any health-data processing;
 * consent stays purpose-specific (docs/api/consent.md).
 */
const PLACEHOLDER_LINE = {
  en: '[PLACEHOLDER - NOT APPROVED. For development and review only.]',
  hi: '[प्लेसहोल्डर - स्वीकृत नहीं। केवल विकास और समीक्षा के लिए।]',
} as const;

type Kind = ParentLegalDocument['kind'];
type Language = ParentLegalDocument['language'];

const TEXTS: Record<
  Kind,
  Record<string, { isPlaceholder: boolean } & Record<Language, { title: string; body: string }>>
> = {
  PRIVACY_NOTICE: {
    'draft-1': {
      isPlaceholder: true,
      en: {
        title: 'Parent Portal privacy notice',
        body:
          'The Parent Portal shows you information that your health worker has shared about your children. ' +
          'We use your mobile number to verify you and to sign you in. ' +
          'Creating an account does not give consent for any health data use; consent is asked separately for each purpose. ' +
          'You can ask your health worker to stop your access at any time.',
      },
      hi: {
        title: 'अभिभावक पोर्टल गोपनीयता सूचना',
        body:
          'अभिभावक पोर्टल पर आपको वह जानकारी दिखती है जो आपके स्वास्थ्य कार्यकर्ता ने आपके बच्चों के बारे में साझा की है। ' +
          'हम आपका मोबाइल नंबर आपकी पहचान की पुष्टि और साइन इन के लिए उपयोग करते हैं। ' +
          'खाता बनाने से स्वास्थ्य जानकारी के किसी उपयोग की सहमति नहीं मिलती; हर उद्देश्य के लिए सहमति अलग से पूछी जाती है। ' +
          'आप कभी भी अपने स्वास्थ्य कार्यकर्ता से अपनी पहुँच बंद करने को कह सकते हैं।',
      },
    },
  },
  TERMS: {
    'draft-1': {
      isPlaceholder: true,
      en: {
        title: 'Parent Portal terms of use',
        body:
          'Keep your password secret and do not share your account. ' +
          'The portal does not replace advice from a doctor or health worker. ' +
          'In an emergency, go to the nearest health facility.',
      },
      hi: {
        title: 'अभिभावक पोर्टल उपयोग की शर्तें',
        body:
          'अपना पासवर्ड गुप्त रखें और अपना खाता किसी के साथ साझा न करें। ' +
          'यह पोर्टल डॉक्टर या स्वास्थ्य कार्यकर्ता की सलाह की जगह नहीं लेता। ' +
          'आपात स्थिति में नज़दीकी स्वास्थ्य केंद्र जाएँ।',
      },
    },
  },
};

export const CURRENT_LEGAL_VERSIONS: Record<Kind, string> = { PRIVACY_NOTICE: 'draft-1', TERMS: 'draft-1' };

export function legalDocument(kind: Kind, language: Language): ParentLegalDocument {
  const version = CURRENT_LEGAL_VERSIONS[kind];
  const entry = TEXTS[kind][version]!;
  const text = entry[language];
  return {
    kind,
    version,
    language,
    title: text.title,
    text: entry.isPlaceholder ? `${PLACEHOLDER_LINE[language]}\n${text.body}` : text.body,
    isPlaceholder: entry.isPlaceholder,
  };
}

/** True when the current versions may be accepted (approved, or drafts allowed outside production). */
export function legalAcceptable(allowDraft: boolean): boolean {
  return (
    allowDraft ||
    Object.entries(CURRENT_LEGAL_VERSIONS).every(([k, v]) => !TEXTS[k as Kind][v]!.isPlaceholder)
  );
}
