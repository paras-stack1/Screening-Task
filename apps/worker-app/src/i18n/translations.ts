import type { SupportedLanguage } from '@balswasthya/shared-contracts';

/**
 * All user-facing strings live here, never hard-coded in screens.
 * English is the source of truth; every key must also exist in Hindi
 * (enforced by the `Record<TranslationKey, string>` type below).
 * Hindi copy should be reviewed by a native speaker / programme staff before release.
 */
const en = {
  appName: 'BalSwasthya AI',
  tagline: 'Child health screening support for RBSK',
  screeningDisclaimer:
    'This app supports health screening. It does not give a medical diagnosis. Always refer children to a doctor or health facility for diagnosis.',
  connectionTitle: 'Server connection',
  connectionChecking: 'Checking connection...',
  connectionOnline: 'Connected',
  connectionOffline: 'Not connected',
  retry: 'Try again',
  languageLabel: 'Language',
  foundationNotice: 'Project setup is ready. Features will be added in the next steps.',
} as const;

export type TranslationKey = keyof typeof en;

const hi: Record<TranslationKey, string> = {
  appName: 'बालस्वास्थ्य AI',
  tagline: 'आरबीएसके के लिए बाल स्वास्थ्य जाँच सहायता',
  screeningDisclaimer:
    'यह ऐप स्वास्थ्य जाँच में सहायता करता है। यह चिकित्सीय निदान नहीं देता। निदान के लिए बच्चों को हमेशा डॉक्टर या स्वास्थ्य केंद्र भेजें।',
  connectionTitle: 'सर्वर कनेक्शन',
  connectionChecking: 'कनेक्शन जाँचा जा रहा है...',
  connectionOnline: 'जुड़ा हुआ',
  connectionOffline: 'जुड़ा नहीं है',
  retry: 'फिर से कोशिश करें',
  languageLabel: 'भाषा',
  foundationNotice: 'प्रोजेक्ट सेटअप तैयार है। अगले चरणों में सुविधाएँ जोड़ी जाएँगी।',
};

export const translations: Record<SupportedLanguage, Record<TranslationKey, string>> = { en, hi };
