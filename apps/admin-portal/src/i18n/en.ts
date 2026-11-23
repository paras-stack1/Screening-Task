/** English strings of the admin portal (decision P7: English first, Hindi wired up). */
export const en = {
  'app.name': 'BalSwasthya Admin',
  'app.tagline': 'Accounts, roles and area assignments',
  'app.skipToContent': 'Skip to main content',
  'app.notConfigured':
    'The portal is not set up correctly (missing or invalid API address). Contact the technical team.',

  'common.loading': 'Loading…',
  'common.retry': 'Try again',
  'common.signOut': 'Sign out',
  'common.language': 'Language',
  'common.comingSoon': 'Available in the next update',
  'common.requestId': 'Reference: {{id}}',

  'errors.network': 'Cannot reach the server. Check your connection and try again.',
  'errors.timeout': 'The server is taking too long to respond. Please try again.',
  'errors.tooManyRequests': 'Too many attempts. Please wait a few minutes and try again.',
  'errors.server': 'The server had a problem. Please try again later.',
  'errors.forbidden': 'You do not have permission to do this.',
  'errors.sessionEnded': 'Your session has ended. Please sign in again.',
  'errors.notConfigured': 'The portal is not set up correctly. Contact the technical team.',
  'errors.unexpected': 'Something went wrong. Please try again.',

  'login.title': 'Administrator sign in',
  'login.subtitle': 'For state, district and block administrators and supervisors.',
  'login.loginIdLabel': 'Login ID',
  'login.passwordLabel': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.forgotPassword': 'Forgot your password? Ask another administrator to reset it.',
  'login.signedOut': 'You have signed out.',
  'login.errors.loginIdRequired': 'Enter your login ID',
  'login.errors.loginIdTooLong': 'Login ID is too long',
  'login.errors.passwordRequired': 'Enter your password',
  'login.errors.passwordTooLong': 'Password is too long',
  'login.errors.invalidCredentials':
    'Login ID or password is incorrect, or the account is not active. If this continues, contact another administrator.',

  'restore.failed': 'Could not reach the server to continue your session.',

  'changePassword.title': 'Choose a new password',
  'changePassword.intro': 'For your security, set your own password before you continue.',
  'changePassword.voluntaryIntro': 'Changing your password signs you out on every other device and browser.',
  'changePassword.currentLabel': 'Current password',
  'changePassword.newLabel': 'New password',
  'changePassword.newHint': 'At least 8 characters. A short sentence is easy to remember.',
  'changePassword.confirmLabel': 'Confirm new password',
  'changePassword.submit': 'Save new password',
  'changePassword.submitting': 'Saving…',
  'changePassword.done': 'Your password has been changed.',
  'changePassword.errors.currentRequired': 'Enter your current password',
  'changePassword.errors.currentIncorrect': 'Current password is incorrect',
  'changePassword.errors.tooShort': 'Use at least 8 characters',
  'changePassword.errors.tooLong': 'Use at most 128 characters',
  'changePassword.errors.tooCommon': 'This password is too easy to guess. Choose another one.',
  'changePassword.errors.containsLoginId': 'The password must not contain your login ID',
  'changePassword.errors.sameAsCurrent': 'The new password must be different from the current one',
  'changePassword.errors.mismatch': 'The passwords do not match',

  'notAdmin.title': 'This portal is for administrators',
  'notAdmin.body':
    'Your account does not manage user accounts or area assignments. Field workers and medical officers use the BalSwasthya mobile app.',

  'nav.label': 'Main navigation',
  'nav.home': 'Home',
  'nav.users': 'Users',
  'nav.password': 'Change password',

  'header.signedInAs': 'Signed in as {{name}}',

  'home.title': 'Welcome, {{name}}',
  'home.intro': 'From here you will manage worker accounts and the areas they work in.',
  'home.yourAccess': 'Your administrative access',
  'home.noAssignments': 'You have no current assignments.',
  'home.canManageUsers': 'You can create and manage user accounts in these areas.',
  'home.canManageAssignments': 'You can give and change area assignments in these areas.',
  'home.next.title': 'Coming in the next updates',
  'home.next.users': 'User list, creating worker accounts and resetting passwords',
  'home.next.assignments': 'Adding, ending and suspending area assignments',
  'home.privacy': 'This portal never shows children’s or guardians’ details or screening results.',

  'users.title': 'Users',

  'notFound.title': 'Page not found',
  'notFound.back': 'Go to the home page',

  'role.ASHA': 'ASHA',
  'role.ANGANWADI_WORKER': 'Anganwadi Worker',
  'role.MHT_MEDICAL_OFFICER': 'RBSK Mobile Health Team Medical Officer',
  'role.SUPERVISOR': 'Supervisor',
  'role.DISTRICT_ADMIN': 'District Administrator',
  'role.STATE_ADMIN': 'State Administrator',

  'scope.AREA_ONLY': 'This area only',
  'scope.AREA_AND_DESCENDANTS': 'This area and all areas within it',
} as const;

export type TranslationKey = keyof typeof en;
