import type { TranslationKey } from './en';

/**
 * Hindi strings. `Record<TranslationKey, string>` makes a missing key a compile error.
 *
 * REVIEW: strings shared with the worker app reuse its wording; the portal-only strings are
 * engineering drafts. Every string must be reviewed by a native Hindi speaker before release.
 */
export const hi: Record<TranslationKey, string> = {
  'app.name': 'बालस्वास्थ्य एडमिन',
  'app.tagline': 'खाते, भूमिकाएँ और क्षेत्र असाइनमेंट',
  'app.skipToContent': 'मुख्य सामग्री पर जाएँ',
  'app.notConfigured':
    'पोर्टल सही तरीके से सेट नहीं है (API पता नहीं है या गलत है)। तकनीकी टीम से संपर्क करें।',

  'common.loading': 'लोड हो रहा है…',
  'common.retry': 'फिर से कोशिश करें',
  'common.signOut': 'साइन आउट करें',
  'common.language': 'भाषा',
  'common.comingSoon': 'अगले अपडेट में उपलब्ध',
  'common.requestId': 'संदर्भ: {{id}}',

  'errors.network': 'सर्वर तक नहीं पहुँच पा रहे। अपना इंटरनेट कनेक्शन जाँचें और फिर से कोशिश करें।',
  'errors.timeout': 'सर्वर जवाब देने में बहुत समय ले रहा है। कृपया फिर से कोशिश करें।',
  'errors.tooManyRequests': 'बहुत अधिक प्रयास हुए। कृपया कुछ मिनट रुककर फिर से कोशिश करें।',
  'errors.server': 'सर्वर में समस्या आई। कृपया बाद में फिर से कोशिश करें।',
  'errors.forbidden': 'आपको इसकी अनुमति नहीं है।',
  'errors.sessionEnded': 'आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।',
  'errors.notConfigured': 'पोर्टल सही तरीके से सेट नहीं है। तकनीकी टीम से संपर्क करें।',
  'errors.unexpected': 'कुछ गलत हो गया। कृपया फिर से कोशिश करें।',

  'login.title': 'प्रशासक साइन इन',
  'login.subtitle': 'राज्य, ज़िला और ब्लॉक प्रशासकों और पर्यवेक्षकों के लिए।',
  'login.loginIdLabel': 'लॉगिन आईडी',
  'login.passwordLabel': 'पासवर्ड',
  'login.submit': 'साइन इन करें',
  'login.submitting': 'साइन इन हो रहा है…',
  'login.forgotPassword': 'पासवर्ड भूल गए? किसी दूसरे प्रशासक से उसे रीसेट करने को कहें।',
  'login.signedOut': 'आपने साइन आउट कर लिया है।',
  'login.errors.loginIdRequired': 'अपनी लॉगिन आईडी दर्ज करें',
  'login.errors.loginIdTooLong': 'लॉगिन आईडी बहुत लंबी है',
  'login.errors.passwordRequired': 'अपना पासवर्ड दर्ज करें',
  'login.errors.passwordTooLong': 'पासवर्ड बहुत लंबा है',
  'login.errors.invalidCredentials':
    'लॉगिन आईडी या पासवर्ड गलत है, या खाता सक्रिय नहीं है। यदि ऐसा होता रहे, तो किसी दूसरे प्रशासक से संपर्क करें।',

  'restore.failed': 'आपका सत्र जारी रखने के लिए सर्वर तक नहीं पहुँच पाए।',

  'changePassword.title': 'नया पासवर्ड चुनें',
  'changePassword.intro': 'आपकी सुरक्षा के लिए, आगे बढ़ने से पहले अपना पासवर्ड बनाएँ।',
  'changePassword.voluntaryIntro': 'पासवर्ड बदलने से आप बाकी सभी डिवाइस और ब्राउज़र से साइन आउट हो जाएँगे।',
  'changePassword.currentLabel': 'वर्तमान पासवर्ड',
  'changePassword.newLabel': 'नया पासवर्ड',
  'changePassword.newHint': 'कम से कम 8 अक्षर। एक छोटा वाक्य याद रखना आसान होता है।',
  'changePassword.confirmLabel': 'नए पासवर्ड की पुष्टि करें',
  'changePassword.submit': 'नया पासवर्ड सहेजें',
  'changePassword.submitting': 'सहेजा जा रहा है…',
  'changePassword.done': 'आपका पासवर्ड बदल दिया गया है।',
  'changePassword.errors.currentRequired': 'अपना वर्तमान पासवर्ड दर्ज करें',
  'changePassword.errors.currentIncorrect': 'वर्तमान पासवर्ड गलत है',
  'changePassword.errors.tooShort': 'कम से कम 8 अक्षरों का उपयोग करें',
  'changePassword.errors.tooLong': 'अधिकतम 128 अक्षरों का उपयोग करें',
  'changePassword.errors.tooCommon': 'इस पासवर्ड का अनुमान आसानी से लगाया जा सकता है। कोई दूसरा चुनें।',
  'changePassword.errors.containsLoginId': 'पासवर्ड में आपकी लॉगिन आईडी नहीं होनी चाहिए',
  'changePassword.errors.sameAsCurrent': 'नया पासवर्ड वर्तमान पासवर्ड से अलग होना चाहिए',
  'changePassword.errors.mismatch': 'पासवर्ड मेल नहीं खाते',

  'notAdmin.title': 'यह पोर्टल प्रशासकों के लिए है',
  'notAdmin.body':
    'आपका खाता उपयोगकर्ता खातों या क्षेत्र असाइनमेंट का प्रबंधन नहीं करता। फ़ील्ड कार्यकर्ता और चिकित्सा अधिकारी बालस्वास्थ्य मोबाइल ऐप का उपयोग करते हैं।',

  'nav.label': 'मुख्य नेविगेशन',
  'nav.home': 'होम',
  'nav.users': 'उपयोगकर्ता',
  'nav.password': 'पासवर्ड बदलें',

  'header.signedInAs': '{{name}} के रूप में साइन इन',

  'home.title': 'स्वागत है, {{name}}',
  'home.intro': 'यहाँ से आप कार्यकर्ताओं के खाते और उनके कार्य-क्षेत्र प्रबंधित करेंगे।',
  'home.yourAccess': 'आपकी प्रशासनिक पहुँच',
  'home.noAssignments': 'आपका कोई वर्तमान असाइनमेंट नहीं है।',
  'home.canManageUsers': 'आप इन क्षेत्रों में उपयोगकर्ता खाते बना और प्रबंधित कर सकते हैं।',
  'home.canManageAssignments': 'आप इन क्षेत्रों में क्षेत्र असाइनमेंट दे और बदल सकते हैं।',
  'home.next.title': 'अगले अपडेट में आ रहा है',
  'home.next.users': 'उपयोगकर्ता सूची, कार्यकर्ता खाते बनाना और पासवर्ड रीसेट करना',
  'home.next.assignments': 'क्षेत्र असाइनमेंट जोड़ना, समाप्त करना और निलंबित करना',
  'home.privacy': 'यह पोर्टल कभी भी बच्चों या अभिभावकों का विवरण या जाँच के परिणाम नहीं दिखाता।',

  'users.title': 'उपयोगकर्ता',

  'notFound.title': 'पेज नहीं मिला',
  'notFound.back': 'होम पेज पर जाएँ',

  'role.ASHA': 'आशा',
  'role.ANGANWADI_WORKER': 'आंगनवाड़ी कार्यकर्ता',
  'role.MHT_MEDICAL_OFFICER': 'आरबीएसके मोबाइल हेल्थ टीम चिकित्सा अधिकारी',
  'role.SUPERVISOR': 'पर्यवेक्षक',
  'role.DISTRICT_ADMIN': 'ज़िला प्रशासक',
  'role.STATE_ADMIN': 'राज्य प्रशासक',

  'scope.AREA_ONLY': 'केवल यह क्षेत्र',
  'scope.AREA_AND_DESCENDANTS': 'यह क्षेत्र और इसके अंतर्गत सभी क्षेत्र',
};
