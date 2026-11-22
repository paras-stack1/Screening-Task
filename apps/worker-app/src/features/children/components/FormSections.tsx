import { GUARDIAN_RELATIONSHIPS, SEX_AT_BIRTH } from '@balswasthya/shared-contracts';
import {
  Controller,
  useWatch,
  type Control,
  type FieldErrors,
  type FieldValues,
  type Path,
} from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { AppInput, AppText, ChoiceGroup } from '../../../components';
import { useTranslation } from '../../../localization';
import { spacing } from '../../../theme';
import { validationMessageKey } from '../../auth/authErrors';
import { relationshipLabel, sexLabel } from '../labels';
import type { ChildFieldValues, GuardianFieldValues, LinkFieldValues } from '../validation';

/**
 * Form sections shared by registration and the edit screens. Generic over the form type: each
 * form contains these field names (see validation.ts).
 */
interface SectionProps<T extends FieldValues> {
  control: Control<T>;
  errors: FieldErrors<T>;
  disabled?: boolean;
}

function useFieldError<T extends FieldValues>(errors: FieldErrors<T>) {
  const { t } = useTranslation();
  return (name: string) => {
    const message = (errors as Record<string, { message?: string } | undefined>)[name]?.message;
    const key = validationMessageKey(message);
    return key ? t(key) : undefined;
  };
}

const name = <T extends FieldValues>(field: string) => field as Path<T>;

// ------------------------------------------------------------------------ child

export function ChildFields<T extends FieldValues & ChildFieldValues>({
  control,
  errors,
  disabled,
  hideBirth = false,
}: SectionProps<T> & { hideBirth?: boolean }) {
  const { t } = useTranslation();
  const error = useFieldError(errors);
  const dobMode = useWatch({ control, name: name<T>('dobMode') }) as ChildFieldValues['dobMode'];

  return (
    <View style={styles.section}>
      <Controller
        control={control}
        name={name<T>('fullName')}
        render={({ field }) => (
          <AppInput
            ref={field.ref}
            label={`${t('children.form.childName')} *`}
            value={field.value as string}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={error('fullName')}
            autoCapitalize="words"
            autoComplete="off"
            editable={!disabled}
            testID="child-name"
          />
        )}
      />

      {hideBirth ? null : (
        <Controller
          control={control}
          name={name<T>('dobMode')}
          render={({ field }) => (
            <ChoiceGroup
              label={`${t('children.form.dobKnownQuestion')} *`}
              options={[
                { value: 'exact', label: t('children.form.dobKnownYes') },
                { value: 'estimate', label: t('children.form.dobKnownNo') },
              ]}
              value={field.value as ChildFieldValues['dobMode']}
              onChange={field.onChange}
              error={error('dobMode')}
              disabled={disabled}
              testID="dob-mode"
            />
          )}
        />
      )}

      {!hideBirth && dobMode === 'exact' ? (
        <View style={styles.section}>
          <AppText variant="label">{`${t('children.form.dobLabel')} *`}</AppText>
          <View style={styles.row}>
            {(['day', 'month', 'year'] as const).map((part) => (
              <View key={part} style={part === 'year' ? styles.wide : styles.narrow}>
                <Controller
                  control={control}
                  name={name<T>(part)}
                  render={({ field }) => (
                    <AppInput
                      label={t(`children.form.${part}`)}
                      value={field.value as string}
                      onChangeText={(text) => field.onChange(text.replace(/\D/g, ''))}
                      onBlur={field.onBlur}
                      keyboardType="number-pad"
                      maxLength={part === 'year' ? 4 : 2}
                      placeholder={t(`children.form.${part}Placeholder`)}
                      editable={!disabled}
                      testID={`dob-${part}`}
                    />
                  )}
                />
              </View>
            ))}
          </View>
          {error('day') ? (
            <AppText
              variant="bodySmall"
              color="danger"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {error('day')}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {!hideBirth && dobMode === 'estimate' ? (
        <View style={styles.section}>
          <AppText variant="bodySmall" color="textSecondary">
            {t('children.form.estimateHint')}
          </AppText>
          <View style={styles.row}>
            <View style={styles.half}>
              <Controller
                control={control}
                name={name<T>('ageYears')}
                render={({ field }) => (
                  <AppInput
                    label={`${t('children.form.ageYears')} *`}
                    value={field.value as string}
                    onChangeText={(text) => field.onChange(text.replace(/\D/g, ''))}
                    onBlur={field.onBlur}
                    keyboardType="number-pad"
                    maxLength={2}
                    error={error('ageYears')}
                    editable={!disabled}
                    testID="age-years"
                  />
                )}
              />
            </View>
            <View style={styles.half}>
              <Controller
                control={control}
                name={name<T>('ageMonths')}
                render={({ field }) => (
                  <AppInput
                    label={t('children.form.ageMonths')}
                    value={field.value as string}
                    onChangeText={(text) => field.onChange(text.replace(/\D/g, ''))}
                    onBlur={field.onBlur}
                    keyboardType="number-pad"
                    maxLength={2}
                    error={error('ageMonths')}
                    editable={!disabled}
                    testID="age-months"
                  />
                )}
              />
            </View>
          </View>
        </View>
      ) : null}

      <Controller
        control={control}
        name={name<T>('sexAtBirth')}
        render={({ field }) => (
          <ChoiceGroup
            label={t('children.form.sexLabel')}
            hint={t('children.form.sexHint')}
            options={SEX_AT_BIRTH.filter((v) => v !== 'NOT_RECORDED').map((value) => ({
              value,
              label: sexLabel(t, value),
            }))}
            value={field.value as ChildFieldValues['sexAtBirth']}
            onChange={field.onChange}
            disabled={disabled}
            testID="sex"
          />
        )}
      />
    </View>
  );
}

// ------------------------------------------------------------------------ guardian

export function GuardianFields<T extends FieldValues & GuardianFieldValues>({
  control,
  errors,
  disabled,
}: SectionProps<T>) {
  const { t } = useTranslation();
  const error = useFieldError(errors);
  return (
    <View style={styles.section}>
      <Controller
        control={control}
        name={name<T>('guardianName')}
        render={({ field }) => (
          <AppInput
            ref={field.ref}
            label={`${t('children.form.guardianName')} *`}
            value={field.value as string}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={error('guardianName')}
            autoCapitalize="words"
            autoComplete="off"
            editable={!disabled}
            testID="guardian-name"
          />
        )}
      />
      <Controller
        control={control}
        name={name<T>('guardianPhone')}
        render={({ field }) => (
          <AppInput
            label={t('children.form.guardianPhone')}
            hint={t('children.form.guardianPhoneHint')}
            value={field.value as string}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={error('guardianPhone')}
            keyboardType="phone-pad"
            autoComplete="off"
            textContentType="none"
            maxLength={16}
            editable={!disabled}
            testID="guardian-phone"
          />
        )}
      />
      <Controller
        control={control}
        name={name<T>('guardianLanguage')}
        render={({ field }) => (
          <ChoiceGroup
            label={t('children.form.guardianLanguage')}
            options={[
              { value: 'hi', label: 'हिंदी' },
              { value: 'en', label: 'English' },
            ]}
            value={field.value as 'hi' | 'en'}
            onChange={field.onChange}
            disabled={disabled}
            testID="guardian-language"
          />
        )}
      />
    </View>
  );
}

// ------------------------------------------------------------------------ link

export function LinkFields<T extends FieldValues & LinkFieldValues>({
  control,
  errors,
  disabled,
  showPrimary = true,
}: SectionProps<T> & { showPrimary?: boolean }) {
  const { t } = useTranslation();
  const error = useFieldError(errors);
  return (
    <View style={styles.section}>
      <Controller
        control={control}
        name={name<T>('relationship')}
        render={({ field }) => (
          <ChoiceGroup
            label={`${t('children.form.relationship')} *`}
            options={GUARDIAN_RELATIONSHIPS.map((value) => ({ value, label: relationshipLabel(t, value) }))}
            value={field.value as LinkFieldValues['relationship']}
            onChange={field.onChange}
            error={error('relationship')}
            disabled={disabled}
            testID="relationship"
          />
        )}
      />
      <Controller
        control={control}
        name={name<T>('canGiveConsent')}
        render={({ field }) => (
          <ChoiceGroup
            label={`${t('children.form.consentAuthority')} *`}
            hint={t('children.form.consentAuthorityHint')}
            options={[
              { value: 'yes', label: t('common.yes') },
              { value: 'no', label: t('common.no') },
            ]}
            value={field.value as LinkFieldValues['canGiveConsent']}
            onChange={field.onChange}
            error={error('canGiveConsent')}
            disabled={disabled}
            testID="consent-authority"
          />
        )}
      />
      {showPrimary ? (
        <Controller
          control={control}
          name={name<T>('isPrimaryContact')}
          render={({ field }) => (
            <ChoiceGroup
              label={t('children.form.primaryContact')}
              options={[
                { value: 'yes', label: t('common.yes') },
                { value: 'no', label: t('common.no') },
              ]}
              value={(field.value as boolean) ? 'yes' : 'no'}
              onChange={(value) => field.onChange(value === 'yes')}
              disabled={disabled}
              testID="primary-contact"
            />
          )}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  narrow: { flexGrow: 1, flexBasis: 72 },
  wide: { flexGrow: 2, flexBasis: 110 },
  half: { flexGrow: 1, flexBasis: 120 },
});
