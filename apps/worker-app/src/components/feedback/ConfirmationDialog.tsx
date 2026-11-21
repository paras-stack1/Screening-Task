import { Modal, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../localization';
import { colors, layout, radius, shadows, spacing } from '../../theme';
import { AppButton } from '../buttons/AppButton';
import { AppText } from '../common/AppText';

interface ConfirmationDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible actions such as logout. */
  destructive?: boolean;
  /** True while the confirmed action runs: blocks a second confirmation. */
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal yes/no question. The Android back button cancels. */
export function ConfirmationDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  confirming = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={confirming ? () => undefined : onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal accessibilityRole="alert">
          <AppText variant="title" accessibilityRole="header">
            {title}
          </AppText>
          {message ? <AppText variant="body">{message}</AppText> : null}
          <View style={styles.actions}>
            <AppButton
              variant={destructive ? 'danger' : 'primary'}
              label={confirmLabel ?? t('common.confirm')}
              onPress={onConfirm}
              loading={confirming}
              testID="confirm-dialog-confirm"
            />
            <AppButton
              variant="ghost"
              label={cancelLabel ?? t('common.cancel')}
              onPress={onCancel}
              disabled={confirming}
              testID="confirm-dialog-cancel"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.raised,
  },
  // Stacked full-width buttons: long Hindi labels fit and both targets stay large.
  actions: { gap: spacing.sm },
});
