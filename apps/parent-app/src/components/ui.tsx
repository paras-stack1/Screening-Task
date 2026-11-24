import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { colors, font, radius, spacing, touch } from '../theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function T({
  children,
  variant = 'body',
  color = colors.text,
  style,
  testID,
}: {
  children: ReactNode;
  variant?: 'hero' | 'title' | 'large' | 'body' | 'bodyStrong' | 'small';
  color?: string;
  style?: TextStyle;
  testID?: string;
}) {
  return (
    <Text
      testID={testID}
      accessibilityRole={variant === 'title' || variant === 'hero' ? 'header' : undefined}
      maxFontSizeMultiplier={1.8}
      style={[styles[variant], { color }, style]}
    >
      {children}
    </Text>
  );
}

/** Page frame: safe area, scrolling, brand header with back and language switch. */
export function Screen({
  title,
  back = false,
  children,
  testID,
}: {
  title: string;
  back?: boolean;
  children: ReactNode;
  testID?: string;
}) {
  const router = useRouter();
  const { t, language, setLanguage } = useI18n();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {back ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={styles.headerButton}
            testID="header-back"
          >
            <MaterialCommunityIcons name="arrow-left" size={26} color="#FFFFFF" />
          </Pressable>
        ) : (
          <View style={styles.headerButton}>
            <MaterialCommunityIcons name="heart-pulse" size={26} color="#FFFFFF" />
          </View>
        )}
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.language')}
          onPress={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
          style={styles.langButton}
          testID="language-toggle"
        >
          <Text style={styles.langText}>{language === 'hi' ? 'English' : 'हिंदी'}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID={testID}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  testID?: string;
}) {
  const palette = {
    primary: { bg: colors.primary, fg: '#FFFFFF', border: colors.primary },
    secondary: { bg: colors.surface, fg: colors.primary, border: colors.primary },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
    danger: { bg: colors.surface, fg: colors.danger, border: colors.danger },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: inactive ? 0.6 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <MaterialCommunityIcons name={icon} size={22} color={palette.fg} /> : null}
          <Text style={[styles.buttonText, { color: palette.fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  secure = false,
  testID,
  ...input
}: TextInputProps & {
  label: string;
  error?: string | null;
  hint?: string;
  secure?: boolean;
  testID?: string;
}) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, { borderColor: error ? colors.danger : colors.border }]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.disabled}
          style={styles.input}
          secureTextEntry={secure && hidden}
          autoCapitalize="none"
          autoCorrect={false}
          testID={testID}
          {...input}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? t('password.show') : t('password.hide')}
            onPress={() => setHidden((h) => !h)}
            style={styles.eye}
          >
            <MaterialCommunityIcons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={24}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Alert({
  message,
  tone = 'danger',
  testID,
}: {
  message: string;
  tone?: 'danger' | 'info' | 'success' | 'warning';
  testID?: string;
}) {
  const p = {
    danger: [colors.dangerSurface, colors.danger, 'alert-circle-outline'],
    info: [colors.primarySurface, colors.primaryDark, 'information-outline'],
    success: [colors.successSurface, colors.success, 'check-circle-outline'],
    warning: [colors.warningSurface, colors.warning, 'alert-outline'],
  }[tone] as [string, string, IconName];
  return (
    <View
      style={[styles.alert, { backgroundColor: p[0] }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <MaterialCommunityIcons name={p[2]} size={22} color={p[1]} />
      <Text style={[styles.alertText, { color: p[1] }]}>{message}</Text>
    </View>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={[
        styles.checkbox,
        checked && { borderColor: colors.primary, backgroundColor: colors.primarySurface },
      ]}
      testID={testID}
    >
      <MaterialCommunityIcons
        name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={26}
        color={checked ? colors.primary : colors.textSecondary}
      />
      <Text style={styles.checkboxText}>{label}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  testID,
  tone = 'plain',
}: {
  children: ReactNode;
  testID?: string;
  tone?: 'plain' | 'brand';
}) {
  return (
    <View
      style={[
        styles.card,
        tone === 'brand' && { backgroundColor: colors.primary, borderColor: colors.primary },
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

export function Tile({
  icon,
  label,
  hint,
  onPress,
  badge,
  testID,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  badge?: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.primarySurface }]}
      testID={testID}
    >
      <View style={styles.tileIcon}>
        <MaterialCommunityIcons name={icon} size={32} color={colors.teal} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </Pressable>
  );
}

/** Initials only - no photographs of children (PP15). */
export function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.tealSurface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={{ fontSize: size / 2.6, fontWeight: '700', color: colors.teal }}>{initials}</Text>
    </View>
  );
}

export function Loading({ label, testID }: { label: string; testID?: string }) {
  return (
    <View style={styles.loading} testID={testID} accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.small}>{label}</Text>
    </View>
  );
}

export function formatDate(isoDate: string, language: 'hi' | 'en'): string {
  const date = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00+05:30` : isoDate);
  try {
    return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
      ...(isoDate.length > 10 && { hour: 'numeric', minute: '2-digit' }),
    }).format(date);
  } catch {
    return isoDate.slice(0, 10);
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    minHeight: 60,
  },
  headerButton: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: font.large, fontWeight: '700' },
  langButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
  },
  langText: { color: '#FFFFFF', fontSize: font.small, fontWeight: '600' },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  hero: { fontSize: font.hero, fontWeight: '700' },
  title: { fontSize: font.title, fontWeight: '700' },
  large: { fontSize: font.large, fontWeight: '600' },
  body: { fontSize: font.body, lineHeight: 26 },
  bodyStrong: { fontSize: font.body, lineHeight: 26, fontWeight: '700' },
  small: { fontSize: font.small, lineHeight: 22, color: colors.textSecondary },
  button: {
    minHeight: touch,
    borderRadius: radius.md,
    borderWidth: 2,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonText: { fontSize: font.body, fontWeight: '700' },
  field: { gap: spacing.xs },
  label: { fontSize: font.body, fontWeight: '600', color: colors.text },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    minHeight: touch,
  },
  input: {
    flex: 1,
    fontSize: font.large,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  },
  eye: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: font.small, color: colors.textSecondary },
  error: { fontSize: font.small, color: colors.danger, fontWeight: '600' },
  alert: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  alertText: { flex: 1, fontSize: font.body, lineHeight: 24 },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch,
    padding: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  checkboxText: { flex: 1, fontSize: font.body },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 132,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tileIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.tealSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: font.body, fontWeight: '700', color: colors.text },
  tileHint: { fontSize: font.small, color: colors.textSecondary },
  badge: {
    alignSelf: 'flex-start',
    fontSize: 13,
    fontWeight: '700',
    color: colors.warning,
    backgroundColor: colors.warningSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  loading: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
});
