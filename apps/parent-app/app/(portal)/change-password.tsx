import { useState } from 'react';
import { isApiError } from '../../src/api/http';
import { Alert, Button, Field, Screen } from '../../src/components/ui';
import { errorKey, useI18n, type TranslationKey } from '../../src/i18n';
import { useServices } from '../../src/services';
import { useSession } from '../../src/session/SessionProvider';

export default function ChangePasswordScreen() {
  const { t } = useI18n();
  const { api, isWeb } = useServices();
  const { withToken, adopt } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<TranslationKey | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    if (next !== confirm) return setError('password.mismatch');
    setBusy(true);
    try {
      const tokens = await withToken((token) =>
        api.changePassword(
          token,
          { currentPassword: current, newPassword: next, confirmPassword: confirm },
          isWeb,
        ),
      );
      await adopt(tokens);
      setDone(true);
    } catch (e) {
      if (isApiError(e) && e.code === 'WEAK_PASSWORD') setError('password.weak');
      else setError(errorKey(e, { CURRENT_PASSWORD_WRONG: 'changePassword.wrongCurrent' }));
    } finally {
      setCurrent('');
      setNext('');
      setConfirm('');
      setBusy(false);
    }
  };

  return (
    <Screen title={t('changePassword.title')} back testID="change-password-screen">
      {done ? (
        <Alert tone="success" message={t('changePassword.saved')} testID="change-password-done" />
      ) : null}
      <Field
        label={t('changePassword.current')}
        value={current}
        onChangeText={setCurrent}
        secure
        testID="cp-current"
      />
      <Field
        label={t('password.new')}
        value={next}
        onChangeText={setNext}
        secure
        hint={t('password.rules')}
        testID="cp-new"
      />
      <Field
        label={t('password.confirm')}
        value={confirm}
        onChangeText={setConfirm}
        secure
        testID="cp-confirm"
      />
      {error ? <Alert message={t(error)} testID="change-password-error" /> : null}
      <Button label={t('changePassword.save')} onPress={save} loading={busy} testID="cp-save" />
    </Screen>
  );
}
