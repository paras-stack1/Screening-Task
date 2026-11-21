/**
 * English strings - the source of truth for translation keys.
 *
 * Rules (docs/frontend/localization.md):
 *  - Keys are dotted: `<area>.<screen or component>.<item>`.
 *  - Placeholders use `{{name}}` and must appear identically in every language.
 *  - Never concatenate translated fragments in code; add a key with placeholders instead.
 */
export const en = {
  'app.name': 'BalSwasthya AI',
  'app.tagline': 'Child health screening support for RBSK',
  'app.screeningDisclaimer':
    'This app supports health screening. It does not give a medical diagnosis. Always refer children to a doctor or health facility for diagnosis.',

  'common.loading': 'Loading…',
  'common.retry': 'Try again',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.comingSoon': 'Coming soon',
  'common.notAvailableYet': 'Not available yet',
  'common.required': 'Required',
  'common.error.title': 'Something went wrong',
  'common.error.message': 'Please try again. If the problem continues, contact your supervisor.',
  'common.empty.title': 'Nothing here yet',

  'metric.couldNotLoad': 'Could not load',
  'metric.a11y.value': '{{label}}: {{value}}',
  'metric.a11y.loading': '{{label}}: loading',
  'metric.a11y.unavailable': '{{label}}: not available yet',
  'metric.a11y.error': '{{label}}: could not load',

  'action.a11y.unavailable': '{{title}}. {{status}}',

  'password.show': 'Show password',
  'password.hide': 'Hide password',

  'language.label': 'Language',

  'errors.network': 'Cannot reach the server. Check your internet connection and try again.',
  'errors.timeout': 'The server is taking too long to respond. Please try again.',
  'errors.tooManyRequests': 'Too many attempts. Please wait a few minutes and try again.',
  'errors.server': 'The server had a problem. Please try again later.',
  'errors.forbidden': 'You do not have permission for this.',
  'errors.sessionEnded': 'Your session has ended. Please sign in again.',
  'errors.notConfigured': 'The app is not set up correctly. Please contact support.',
  'errors.unexpected': 'Something went wrong. Please try again.',

  'config.error.title': 'App setup problem',

  'auth.signOut': 'Sign out',
  'auth.restoring': 'Checking your sign-in…',
  'auth.loggedOut': 'You have signed out.',
  'auth.restoreFailed.title': 'Cannot connect to the server',
  'auth.restoreFailed.message':
    'You are still signed in on this phone. Check your internet connection and try again.',

  'auth.login.title': 'Welcome back',
  'auth.login.subtitle': 'Sign in to support child health screening in your area.',
  'auth.login.loginIdLabel': 'Employee ID',
  'auth.login.loginIdHint': 'As given by your supervisor, for example EMP-0042',
  'auth.login.passwordLabel': 'Password',
  'auth.login.submit': 'Sign in',
  'auth.login.forgotPassword': 'Forgot your password? Ask your supervisor to reset it.',
  'auth.login.errors.loginIdRequired': 'Enter your employee ID',
  'auth.login.errors.loginIdTooLong': 'Employee ID is too long',
  'auth.login.errors.passwordRequired': 'Enter your password',
  'auth.login.errors.passwordTooLong': 'Password is too long',
  'auth.login.errors.invalidCredentials':
    'Employee ID or password is incorrect, or the account is not active. If this continues, contact your supervisor.',

  'auth.changePassword.title': 'Choose a new password',
  'auth.changePassword.intro': 'For your security, set your own password before you continue.',
  'auth.changePassword.currentLabel': 'Current (temporary) password',
  'auth.changePassword.newLabel': 'New password',
  'auth.changePassword.newHint':
    'At least 8 characters. A short sentence in Hindi or English is easy to remember.',
  'auth.changePassword.confirmLabel': 'Confirm new password',
  'auth.changePassword.submit': 'Save new password',
  'auth.changePassword.errors.currentRequired': 'Enter your current password',
  'auth.changePassword.errors.currentIncorrect': 'Current password is incorrect',
  'auth.changePassword.errors.tooShort': 'Use at least 8 characters',
  'auth.changePassword.errors.tooLong': 'Use at most 128 characters',
  'auth.changePassword.errors.tooCommon': 'This password is too easy to guess. Choose another one.',
  'auth.changePassword.errors.containsLoginId': 'The password must not contain your employee ID',
  'auth.changePassword.errors.sameAsCurrent': 'The new password must be different from the current one',
  'auth.changePassword.errors.mismatch': 'The passwords do not match',

  'nav.dashboard': 'Home',
  'nav.notifications': 'Notifications',
  'nav.profile': 'Profile',
  'nav.settings': 'Settings',

  'notFound.title': 'Page not found',
  'notFound.message': 'This page does not exist.',
  'notFound.goHome': 'Go to home',

  'connectivity.online': 'Online',
  'connectivity.offline': 'Offline',
  'connectivity.syncPending': 'Waiting to sync',
  'connectivity.syncing': 'Syncing…',
  'connectivity.syncFailed': 'Sync failed',
  'connectivity.offlineBanner': 'You are offline. Information will load when the connection returns.',

  'dashboard.greeting': 'Namaste, {{name}}',
  'dashboard.subtitle': 'Here is an overview of your work.',
  'dashboard.openProfile': 'Open profile',
  'dashboard.openNotifications': 'Open notifications',
  'dashboard.metrics.title': 'Overview',
  'dashboard.metrics.registeredChildren': 'Registered children',
  'dashboard.metrics.screenedToday': 'Screened today',
  'dashboard.metrics.pendingFollowUps': 'Pending follow-ups',
  'dashboard.metrics.pendingReferrals': 'Pending referrals',
  'dashboard.metrics.notForRole': 'Not available for your role',
  'dashboard.actions.title': 'Main tasks',
  'dashboard.actions.registerChild.title': 'Register a child',
  'dashboard.actions.registerChild.description': 'Add a child and guardian details',
  'dashboard.actions.startScreening.title': 'Start screening',
  'dashboard.actions.startScreening.description': 'Guided health screening for a registered child',
  'dashboard.actions.followUps.title': 'Manage follow-ups',
  'dashboard.actions.followUps.description': 'See children who need a follow-up visit',
  'dashboard.fourD.title': 'RBSK 4-D screening areas',
  'dashboard.fourD.subtitle': 'Information only. No screening results are shown here.',

  'fourD.defectsAtBirth.title': 'Defects at birth',
  'fourD.defectsAtBirth.description': 'Conditions present from birth',
  'fourD.deficiencies.title': 'Deficiencies',
  'fourD.deficiencies.description': 'Nutrition-related conditions',
  'fourD.diseases.title': 'Diseases',
  'fourD.diseases.description': 'Common childhood illnesses',
  'fourD.developmentalDelays.title': 'Developmental delays and disabilities',
  'fourD.developmentalDelays.description': 'Delays in growth, movement, speech or learning',

  'notifications.empty.title': 'Notifications are not available yet',
  'notifications.empty.message':
    'Alerts about follow-ups and referrals will appear here in a future version.',

  'profile.nameLabel': 'Name',
  'profile.statusLabel': 'Account status',
  'profile.statusActive': 'Active',
  'profile.assignmentsTitle': 'Your role and areas',
  'profile.roleLabel': 'Role',
  'profile.areaLabel': 'Area',
  'profile.areaWithLevel': '{{area}} ({{level}})',
  'profile.scope.AREA_ONLY': 'This area only',
  'profile.scope.AREA_AND_DESCENDANTS': 'This area and all areas within it',
  'profile.noAssignments': 'No active assignment. Please contact your supervisor.',
  'profile.managedNote': 'Your role and areas are managed by your administrator.',

  'role.ASHA': 'ASHA',
  'role.ANGANWADI_WORKER': 'Anganwadi Worker',
  'role.MHT_MEDICAL_OFFICER': 'RBSK Mobile Health Team Medical Officer',
  'role.SUPERVISOR': 'Supervisor',
  'role.DISTRICT_ADMIN': 'District Administrator',
  'role.STATE_ADMIN': 'State Administrator',

  'areaLevel.STATE': 'State',
  'areaLevel.DISTRICT': 'District',
  'areaLevel.BLOCK': 'Block',
  'areaLevel.SECTOR': 'Sector',
  'areaLevel.VILLAGE': 'Village',

  'settings.logoutConfirm.title': 'Sign out?',
  'settings.logoutConfirm.message': 'You will need your employee ID and password to sign in again.',
  'settings.about.title': 'About',
  'settings.about.version': 'Version {{version}}',
  'settings.privacy.title': 'Privacy',
  'settings.privacy.body':
    "This phone keeps only your sign-in session and language choice, in protected storage. Children's records are not stored on this phone. Signing out removes your session from this phone.",
} as const;

export type TranslationKey = keyof typeof en;
