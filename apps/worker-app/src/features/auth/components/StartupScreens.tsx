import { useState } from 'react';
import { AppButton, ErrorState, ScreenContainer } from '../../../components';
import { useTranslation } from '../../../localization';
import { useAuth } from '../AuthProvider';

/**
 * Decision M: a session is saved but the server cannot be reached at start-up. The saved session is
 * kept; the user can retry or sign out. No app screens are shown because no data can be loaded.
 */
export function SessionRestoreErrorScreen() {
  const { t } = useTranslation();
  const { retryRestore, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  const retry = () => {
    setBusy(true);
    retryRestore()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <ScreenContainer testID="restore-failed">
      <ErrorState
        title={t('auth.restoreFailed.title')}
        message={t('auth.restoreFailed.message')}
        onRetry={retry}
        retrying={busy}
      />
      <AppButton variant="ghost" label={t('auth.signOut')} onPress={() => void logout()} disabled={busy} />
    </ScreenContainer>
  );
}

/** Production build without a valid HTTPS API address (decision J). No network calls are made. */
export function ConfigErrorScreen() {
  const { t } = useTranslation();
  return (
    <ScreenContainer testID="config-error">
      <ErrorState title={t('config.error.title')} message={t('errors.notConfigured')} />
    </ScreenContainer>
  );
}
