import type { TranslationKey } from './en';

/**
 * Hindi strings. The `Record<TranslationKey, string>` type makes a missing key a compile error;
 * tests/localization check placeholders and empty values.
 *
 * REVIEW: every string must be reviewed by a native Hindi speaker from the programme before
 * release. Health and medical terms must be checked by a domain expert, never improvised.
 */
export const hi: Record<TranslationKey, string> = {
  'app.name': 'बालस्वास्थ्य AI',
  'app.tagline': 'आरबीएसके के लिए बाल स्वास्थ्य जाँच सहायता',
  'app.screeningDisclaimer':
    'यह ऐप स्वास्थ्य जाँच में सहायता करता है। यह चिकित्सीय निदान नहीं देता। निदान के लिए बच्चों को हमेशा डॉक्टर या स्वास्थ्य केंद्र भेजें।',

  'common.loading': 'लोड हो रहा है…',
  'common.retry': 'फिर से कोशिश करें',
  'common.cancel': 'रद्द करें',
  'common.confirm': 'पुष्टि करें',
  'common.comingSoon': 'जल्द आ रहा है',
  'common.notAvailableYet': 'अभी उपलब्ध नहीं',
  'common.required': 'आवश्यक',
  'common.error.title': 'कुछ गलत हो गया',
  'common.error.message': 'कृपया फिर से कोशिश करें। समस्या बनी रहे तो अपने पर्यवेक्षक से संपर्क करें।',
  'common.empty.title': 'अभी यहाँ कुछ नहीं है',

  'metric.couldNotLoad': 'लोड नहीं हो सका',
  'metric.a11y.value': '{{label}}: {{value}}',
  'metric.a11y.loading': '{{label}}: लोड हो रहा है',
  'metric.a11y.unavailable': '{{label}}: अभी उपलब्ध नहीं',
  'metric.a11y.error': '{{label}}: लोड नहीं हो सका',

  'action.a11y.unavailable': '{{title}}। {{status}}',

  'password.show': 'पासवर्ड दिखाएँ',
  'password.hide': 'पासवर्ड छिपाएँ',

  'language.label': 'भाषा',

  'errors.network': 'सर्वर तक नहीं पहुँच पा रहे। अपना इंटरनेट कनेक्शन जाँचें और फिर से कोशिश करें।',
  'errors.timeout': 'सर्वर जवाब देने में बहुत समय ले रहा है। कृपया फिर से कोशिश करें।',
  'errors.tooManyRequests': 'बहुत अधिक प्रयास हुए। कृपया कुछ मिनट रुककर फिर से कोशिश करें।',
  'errors.server': 'सर्वर में समस्या आई। कृपया बाद में फिर से कोशिश करें।',
  'errors.forbidden': 'आपको इसकी अनुमति नहीं है।',
  'errors.sessionEnded': 'आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।',
  'errors.notConfigured': 'ऐप सही तरीके से सेट नहीं है। कृपया सहायता टीम से संपर्क करें।',
  'errors.unexpected': 'कुछ गलत हो गया। कृपया फिर से कोशिश करें।',

  'config.error.title': 'ऐप सेटअप में समस्या',

  'auth.signOut': 'साइन आउट करें',
  'auth.restoring': 'आपका साइन-इन जाँचा जा रहा है…',
  'auth.loggedOut': 'आप साइन आउट हो गए हैं।',
  'auth.restoreFailed.title': 'सर्वर से कनेक्ट नहीं हो पा रहा',
  'auth.restoreFailed.message':
    'आप इस फ़ोन पर अभी भी साइन इन हैं। अपना इंटरनेट कनेक्शन जाँचें और फिर से कोशिश करें।',

  'auth.login.title': 'वापसी पर स्वागत है',
  'auth.login.subtitle': 'अपने क्षेत्र में बाल स्वास्थ्य जाँच में सहायता के लिए साइन इन करें।',
  'auth.login.loginIdLabel': 'कर्मचारी आईडी',
  'auth.login.loginIdHint': 'जैसी आपके पर्यवेक्षक ने दी है, उदाहरण के लिए EMP-0042',
  'auth.login.passwordLabel': 'पासवर्ड',
  'auth.login.submit': 'साइन इन करें',
  'auth.login.forgotPassword': 'पासवर्ड भूल गए? अपने पर्यवेक्षक से इसे रीसेट करने के लिए कहें।',
  'auth.login.errors.loginIdRequired': 'अपनी कर्मचारी आईडी दर्ज करें',
  'auth.login.errors.loginIdTooLong': 'कर्मचारी आईडी बहुत लंबी है',
  'auth.login.errors.passwordRequired': 'अपना पासवर्ड दर्ज करें',
  'auth.login.errors.passwordTooLong': 'पासवर्ड बहुत लंबा है',
  'auth.login.errors.invalidCredentials':
    'कर्मचारी आईडी या पासवर्ड गलत है, या खाता सक्रिय नहीं है। यदि ऐसा होता रहे, तो अपने पर्यवेक्षक से संपर्क करें।',

  'auth.changePassword.title': 'नया पासवर्ड चुनें',
  'auth.changePassword.intro': 'आपकी सुरक्षा के लिए, आगे बढ़ने से पहले अपना पासवर्ड बनाएँ।',
  'auth.changePassword.currentLabel': 'वर्तमान (अस्थायी) पासवर्ड',
  'auth.changePassword.newLabel': 'नया पासवर्ड',
  'auth.changePassword.newHint':
    'कम से कम 8 अक्षर। हिंदी या अंग्रेज़ी का एक छोटा वाक्य याद रखना आसान होता है।',
  'auth.changePassword.confirmLabel': 'नए पासवर्ड की पुष्टि करें',
  'auth.changePassword.submit': 'नया पासवर्ड सहेजें',
  'auth.changePassword.errors.currentRequired': 'अपना वर्तमान पासवर्ड दर्ज करें',
  'auth.changePassword.errors.currentIncorrect': 'वर्तमान पासवर्ड गलत है',
  'auth.changePassword.errors.tooShort': 'कम से कम 8 अक्षरों का उपयोग करें',
  'auth.changePassword.errors.tooLong': 'अधिकतम 128 अक्षरों का उपयोग करें',
  'auth.changePassword.errors.tooCommon': 'इस पासवर्ड का अनुमान आसानी से लगाया जा सकता है। कोई दूसरा चुनें।',
  'auth.changePassword.errors.containsLoginId': 'पासवर्ड में आपकी कर्मचारी आईडी नहीं होनी चाहिए',
  'auth.changePassword.errors.sameAsCurrent': 'नया पासवर्ड वर्तमान पासवर्ड से अलग होना चाहिए',
  'auth.changePassword.errors.mismatch': 'पासवर्ड मेल नहीं खाते',

  'nav.dashboard': 'होम',
  'nav.notifications': 'सूचनाएँ',
  'nav.profile': 'प्रोफ़ाइल',
  'nav.settings': 'सेटिंग्स',

  'notFound.title': 'पेज नहीं मिला',
  'notFound.message': 'यह पेज मौजूद नहीं है।',
  'notFound.goHome': 'होम पर जाएँ',

  'connectivity.online': 'ऑनलाइन',
  'connectivity.offline': 'ऑफ़लाइन',
  'connectivity.syncPending': 'सिंक की प्रतीक्षा',
  'connectivity.syncing': 'सिंक हो रहा है…',
  'connectivity.syncFailed': 'सिंक विफल',
  'connectivity.offlineBanner': 'आप ऑफ़लाइन हैं। कनेक्शन लौटने पर जानकारी लोड होगी।',

  'dashboard.greeting': 'नमस्ते, {{name}}',
  'dashboard.subtitle': 'यह आपके काम का सारांश है।',
  'dashboard.openProfile': 'प्रोफ़ाइल खोलें',
  'dashboard.openNotifications': 'सूचनाएँ खोलें',
  'dashboard.metrics.title': 'सारांश',
  'dashboard.metrics.registeredChildren': 'पंजीकृत बच्चे',
  'dashboard.metrics.screenedToday': 'आज जाँचे गए',
  'dashboard.metrics.pendingFollowUps': 'लंबित फ़ॉलो-अप',
  'dashboard.metrics.pendingReferrals': 'लंबित रेफ़रल',
  'dashboard.metrics.notForRole': 'आपकी भूमिका के लिए उपलब्ध नहीं',
  'dashboard.actions.title': 'मुख्य कार्य',
  'dashboard.actions.registerChild.title': 'बच्चे का पंजीकरण करें',
  'dashboard.actions.registerChild.description': 'बच्चे और अभिभावक का विवरण जोड़ें',
  'dashboard.actions.startScreening.title': 'जाँच शुरू करें',
  'dashboard.actions.startScreening.description': 'पंजीकृत बच्चे की निर्देशित स्वास्थ्य जाँच',
  'dashboard.actions.followUps.title': 'फ़ॉलो-अप प्रबंधित करें',
  'dashboard.actions.followUps.description': 'उन बच्चों को देखें जिन्हें फ़ॉलो-अप विज़िट की ज़रूरत है',
  'dashboard.fourD.title': 'आरबीएसके 4-डी जाँच क्षेत्र',
  'dashboard.fourD.subtitle': 'केवल जानकारी। यहाँ जाँच के कोई परिणाम नहीं दिखाए जाते।',

  'fourD.defectsAtBirth.title': 'जन्म के समय दोष',
  'fourD.defectsAtBirth.description': 'जन्म से मौजूद स्थितियाँ',
  'fourD.deficiencies.title': 'कमियाँ',
  'fourD.deficiencies.description': 'पोषण से जुड़ी स्थितियाँ',
  'fourD.diseases.title': 'रोग',
  'fourD.diseases.description': 'बचपन की सामान्य बीमारियाँ',
  'fourD.developmentalDelays.title': 'विकास में देरी और दिव्यांगता',
  'fourD.developmentalDelays.description': 'वृद्धि, चलने-फिरने, बोलने या सीखने में देरी',

  'notifications.empty.title': 'सूचनाएँ अभी उपलब्ध नहीं हैं',
  'notifications.empty.message': 'फ़ॉलो-अप और रेफ़रल से जुड़ी सूचनाएँ भविष्य के संस्करण में यहाँ दिखेंगी।',

  'profile.nameLabel': 'नाम',
  'profile.statusLabel': 'खाते की स्थिति',
  'profile.statusActive': 'सक्रिय',
  'profile.assignmentsTitle': 'आपकी भूमिका और क्षेत्र',
  'profile.roleLabel': 'भूमिका',
  'profile.areaLabel': 'क्षेत्र',
  'profile.areaWithLevel': '{{area}} ({{level}})',
  'profile.scope.AREA_ONLY': 'केवल यह क्षेत्र',
  'profile.scope.AREA_AND_DESCENDANTS': 'यह क्षेत्र और इसके अंतर्गत सभी क्षेत्र',
  'profile.noAssignments': 'कोई सक्रिय नियुक्ति नहीं है। कृपया अपने पर्यवेक्षक से संपर्क करें।',
  'profile.managedNote': 'आपकी भूमिका और क्षेत्र आपके प्रशासक द्वारा प्रबंधित किए जाते हैं।',

  'role.ASHA': 'आशा',
  'role.ANGANWADI_WORKER': 'आंगनवाड़ी कार्यकर्ता',
  'role.MHT_MEDICAL_OFFICER': 'आरबीएसके मोबाइल हेल्थ टीम चिकित्सा अधिकारी',
  'role.SUPERVISOR': 'पर्यवेक्षक',
  'role.DISTRICT_ADMIN': 'ज़िला प्रशासक',
  'role.STATE_ADMIN': 'राज्य प्रशासक',

  'areaLevel.STATE': 'राज्य',
  'areaLevel.DISTRICT': 'ज़िला',
  'areaLevel.BLOCK': 'ब्लॉक',
  'areaLevel.SECTOR': 'सेक्टर',
  'areaLevel.VILLAGE': 'गाँव',

  'settings.logoutConfirm.title': 'साइन आउट करें?',
  'settings.logoutConfirm.message':
    'फिर से साइन इन करने के लिए आपको अपनी कर्मचारी आईडी और पासवर्ड चाहिए होंगे।',
  'settings.about.title': 'ऐप के बारे में',
  'settings.about.version': 'संस्करण {{version}}',
  'settings.privacy.title': 'गोपनीयता',
  'settings.privacy.body':
    'यह फ़ोन सुरक्षित स्टोरेज में केवल आपका साइन-इन सत्र और भाषा की पसंद रखता है। बच्चों के रिकॉर्ड इस फ़ोन पर संग्रहीत नहीं होते। साइन आउट करने पर आपका सत्र इस फ़ोन से हट जाता है।',
};
