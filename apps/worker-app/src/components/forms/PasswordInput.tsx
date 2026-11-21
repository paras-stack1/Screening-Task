import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from '../../localization';
import { colors, touchTarget } from '../../theme';
import { AppIcon } from '../common/AppIcon';
import { AppInput, type AppInputProps } from './AppInput';

export type PasswordInputProps = Omit<AppInputProps, 'secureTextEntry' | 'accessory'>;

/**
 * Password field with a show/hide toggle. Autocorrect, capitalisation and suggestions are off so
 * the keyboard never learns or alters the password. The value is never logged or persisted here.
 */
export function PasswordInput({ autoComplete = 'current-password', ...props }: PasswordInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? t('password.hide') : t('password.show');

  return (
    <AppInput
      {...props}
      autoComplete={autoComplete}
      textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      secureTextEntry={!visible}
      accessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toggleLabel}
          accessibilityState={{ checked: visible }}
          onPress={() => setVisible((current) => !current)}
          style={styles.toggle}
          hitSlop={4}
          testID={props.testID ? `${props.testID}-toggle` : undefined}
        >
          <AppIcon name={visible ? 'eye-off' : 'eye'} color={colors.textSecondary} />
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  toggle: {
    minWidth: touchTarget.min,
    minHeight: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
