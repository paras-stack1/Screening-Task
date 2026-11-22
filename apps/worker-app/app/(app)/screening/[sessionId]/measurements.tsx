import {
  MEASUREMENT_QUALITIES,
  MEASUREMENT_SOURCES,
  SCREENING_MEASUREMENT_TYPES,
  type MeasurementUnit,
  type ScreeningMeasurement,
  type ScreeningMeasurementType,
} from '@balswasthya/shared-contracts';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ChoiceGroup,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  StatusBadge,
} from '../../../../src/components';
import { formatIndiaDate } from '../../../../src/features/children/labels';
import {
  DemoContentBanner,
  NotADiagnosisNote,
} from '../../../../src/features/screening/components/ScreeningParts';
import { isVersionConflict, sessionErrorKey } from '../../../../src/features/screening/errors';
import {
  useApplySessionUpdate,
  useRefetchSession,
  useScreeningApi,
  useScreeningSession,
} from '../../../../src/features/screening/hooks';
import {
  MEASUREMENT_QUALITY_KEYS,
  MEASUREMENT_SOURCE_KEYS,
  MEASUREMENT_TYPE_KEYS,
} from '../../../../src/features/screening/labels';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { spacing } from '../../../../src/theme';

/** Mirrors the API's data-entry rules so mistakes show before sending (the API decides). */
const UNITS: Record<ScreeningMeasurementType, MeasurementUnit[]> = {
  WEIGHT: ['kg', 'g'],
  HEIGHT: ['cm', 'mm'],
  LENGTH: ['cm', 'mm'],
  MUAC: ['cm', 'mm'],
  HEAD_CIRCUMFERENCE: ['cm', 'mm'],
};
const MAX_DECIMALS: Record<MeasurementUnit, number> = { kg: 2, g: 0, cm: 1, mm: 0 };
const DECIMAL = /^(0|[1-9]\d{0,5})(\.\d{1,3})?$/;

type Source = (typeof MEASUREMENT_SOURCES)[number];
type Quality = (typeof MEASUREMENT_QUALITIES)[number];
interface Form {
  type: ScreeningMeasurementType | '';
  unit: MeasurementUnit | '';
  value: string;
  source: Source | '';
  quality: Quality | '';
  deviceMake: string;
  notes: string;
  correctionReason: string;
}
const EMPTY: Form = {
  type: '',
  unit: '',
  value: '',
  source: '',
  quality: '',
  deviceMake: '',
  notes: '',
  correctionReason: '',
};
type FormError = 'type' | 'unit' | 'value' | 'decimals' | 'source' | 'quality' | 'reason';
const FORM_ERRORS: Record<FormError, TranslationKey> = {
  type: 'screening.measurement.errors.type',
  unit: 'screening.measurement.errors.unit',
  value: 'screening.measurement.errors.value',
  decimals: 'screening.measurement.errors.decimals',
  source: 'screening.measurement.errors.source',
  quality: 'screening.measurement.errors.quality',
  reason: 'screening.measurement.errors.reason',
};

function validate(form: Form, correcting: boolean): FormError | null {
  if (!form.type) return 'type';
  if (!form.unit || !UNITS[form.type].includes(form.unit)) return 'unit';
  const value = form.value.trim();
  if (!DECIMAL.test(value)) return 'value';
  const decimals = value.includes('.') ? value.split('.')[1]!.length : 0;
  if (decimals > MAX_DECIMALS[form.unit]) return 'decimals';
  if (!form.source) return 'source';
  if (!form.quality) return 'quality';
  if (correcting && form.correctionReason.trim().length < 3) return 'reason';
  return null;
}

/**
 * Measurements of this session. Values are sent exactly as typed (decimal text, never rounded);
 * the API checks units, precision and plausibility and never classifies the child. A correction
 * keeps the original visible as "corrected" (decision I).
 */
export default function ScreeningMeasurementsScreen() {
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
  const { t } = useTranslation();
  const api = useScreeningApi();
  const apply = useApplySessionUpdate();
  const refetch = useRefetchSession(sessionId);
  const session = useScreeningSession(sessionId);
  const [form, setForm] = useState<Form>(EMPTY);
  const [correcting, setCorrecting] = useState<ScreeningMeasurement | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [message, setMessage] = useState<{ key: TranslationKey; tone: 'danger' | 'info' } | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  if (session.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-measurements">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (session.isError) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-measurements">
        <ErrorState message={t(apiErrorMessageKey(session.error))} onRetry={() => void session.refetch()} />
      </ScreenContainer>
    );
  }
  const s = session.data;
  const set = (patch: Partial<Form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const startCorrection = (m: ScreeningMeasurement) => {
    setCorrecting(m);
    setForm({ ...EMPTY, type: m.type as ScreeningMeasurementType, unit: m.unit as MeasurementUnit });
    setError(null);
    setMessage(null);
  };

  const submit = async () => {
    if (inFlight.current) return;
    const problem = validate(form, correcting !== null);
    if (problem) {
      setError(problem);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setMessage(null);
    const fields = {
      expectedVersion: s.version,
      value: form.value.trim(),
      unit: form.unit as MeasurementUnit,
      source: form.source as Source,
      quality: form.quality as Quality,
      // The time of entry (the measurement is taken during this visit).
      measuredAt: new Date().toISOString(),
      ...(form.deviceMake.trim() ? { deviceMake: form.deviceMake.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };
    try {
      const response = correcting
        ? await api.correctMeasurement(s.id, correcting.id, {
            ...fields,
            correctionReason: form.correctionReason.trim(),
          })
        : await api.addMeasurement(s.id, { ...fields, type: form.type as ScreeningMeasurementType });
      apply(response);
      setForm(EMPTY);
      setCorrecting(null);
      setMessage({ key: 'screening.measurement.saved', tone: 'info' });
    } catch (err) {
      if (isVersionConflict(err)) void refetch();
      setMessage({ key: sessionErrorKey(err), tone: 'danger' });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="screening-measurements">
      <DemoContentBanner visible={s.usesUnapprovedContent} />
      <SectionHeader title={t('screening.measurement.listTitle')} />
      {s.measurements.length === 0 ? (
        <AppText color="textSecondary" testID="measurements-empty">
          {t('screening.measurement.none')}
        </AppText>
      ) : (
        <View style={styles.list}>
          {s.measurements.map((m) => (
            <AppCard key={m.id} style={styles.card} testID={`measurement-${m.id}`}>
              <AppText variant="bodyStrong">
                {t(
                  MEASUREMENT_TYPE_KEYS[m.type as ScreeningMeasurementType] ?? 'screening.measurement.title',
                )}
              </AppText>
              <AppText variant="body">
                {m.unit === m.converted.unit
                  ? t('screening.measurement.value', { value: m.value, unit: m.unit })
                  : t('screening.measurement.valueConverted', {
                      value: m.value,
                      unit: m.unit,
                      converted: m.converted.value,
                      convertedUnit: m.converted.unit,
                    })}
              </AppText>
              <AppText variant="bodySmall" color="textSecondary">
                {t('screening.measurement.meta', {
                  source: t(MEASUREMENT_SOURCE_KEYS[m.source as Source]),
                  quality: t(MEASUREMENT_QUALITY_KEYS[m.quality as Quality]),
                  date: formatIndiaDate(m.measuredAt),
                  name: m.recordedByName,
                })}
              </AppText>
              {m.correctionReason ? (
                <AppText variant="bodySmall" color="textSecondary">
                  {t('screening.measurement.correctionLine', { reason: m.correctionReason })}
                </AppText>
              ) : null}
              {!m.isCurrent ? (
                <StatusBadge label={t('screening.measurement.corrected')} tone="neutral" />
              ) : null}
              {m.isCurrent && s.canEdit ? (
                <AppButton
                  variant="ghost"
                  icon="pencil-outline"
                  label={t('screening.measurement.correct')}
                  onPress={() => startCorrection(m)}
                  testID={`measurement-correct-${m.id}`}
                />
              ) : null}
            </AppCard>
          ))}
        </View>
      )}

      {s.canEdit ? (
        <>
          <SectionHeader
            title={t(correcting ? 'screening.measurement.correctTitle' : 'screening.measurement.addTitle')}
          />
          {message ? (
            <InlineAlert tone={message.tone} message={t(message.key)} testID="measurement-message" />
          ) : null}
          <ChoiceGroup
            label={t('screening.measurement.typeLabel')}
            options={SCREENING_MEASUREMENT_TYPES.map((type) => ({
              value: type,
              label: t(MEASUREMENT_TYPE_KEYS[type]),
            }))}
            value={form.type}
            disabled={correcting !== null}
            onChange={(type) =>
              set({ type, unit: form.unit && UNITS[type].includes(form.unit) ? form.unit : '' })
            }
            testID="measurement-type"
          />
          {form.type ? (
            <ChoiceGroup
              label={t('screening.measurement.unitLabel')}
              options={UNITS[form.type].map((unit) => ({ value: unit, label: unit }))}
              value={form.unit}
              onChange={(unit) => set({ unit })}
              testID="measurement-unit"
            />
          ) : null}
          <AppInput
            label={t('screening.measurement.valueLabel')}
            hint={
              form.unit
                ? t('screening.measurement.valueHint', { decimals: MAX_DECIMALS[form.unit] })
                : undefined
            }
            value={form.value}
            onChangeText={(value) => set({ value })}
            keyboardType="decimal-pad"
            testID="measurement-value"
          />
          <ChoiceGroup
            label={t('screening.measurement.sourceLabel')}
            options={MEASUREMENT_SOURCES.map((value) => ({
              value,
              label: t(MEASUREMENT_SOURCE_KEYS[value]),
            }))}
            value={form.source}
            onChange={(source) => set({ source })}
            testID="measurement-source"
          />
          <ChoiceGroup
            label={t('screening.measurement.qualityLabel')}
            options={MEASUREMENT_QUALITIES.map((value) => ({
              value,
              label: t(MEASUREMENT_QUALITY_KEYS[value]),
            }))}
            value={form.quality}
            onChange={(quality) => set({ quality })}
            testID="measurement-quality"
          />
          <AppInput
            label={t('screening.measurement.deviceLabel')}
            value={form.deviceMake}
            onChangeText={(deviceMake) => set({ deviceMake })}
            maxLength={64}
            testID="measurement-device"
          />
          {correcting ? (
            <AppInput
              label={t('screening.measurement.reasonLabel')}
              value={form.correctionReason}
              onChangeText={(correctionReason) => set({ correctionReason })}
              maxLength={200}
              testID="measurement-reason"
            />
          ) : null}
          {error ? (
            <AppText variant="bodySmall" color="danger" accessibilityRole="alert" testID="measurement-error">
              {t(FORM_ERRORS[error])}
            </AppText>
          ) : null}
          <PrimaryButton
            icon="content-save-outline"
            label={t(correcting ? 'screening.measurement.saveCorrection' : 'screening.measurement.save')}
            onPress={() => void submit()}
            loading={saving}
            testID="measurement-save"
          />
          {correcting ? (
            <AppButton
              variant="secondary"
              label={t('common.cancel')}
              onPress={() => {
                setCorrecting(null);
                setForm(EMPTY);
              }}
              testID="measurement-cancel-correction"
            />
          ) : null}
        </>
      ) : null}
      <AppText variant="caption" color="textSecondary">
        {t('screening.measurement.dataQualityNote')}
      </AppText>
      <NotADiagnosisNote />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { gap: spacing.xs },
});
