import type { AreaNode } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { EffectiveAccess } from '../../auth/sessionManager';
import { Alert, Button, Loading, SelectField, TextField } from '../../components/ui';
import { errorMessageKey, useI18n, type TranslationKey } from '../../i18n';
import { grantableRoles, useRoles } from '../users/api';
import { AreaPicker } from '../users/AreaPicker';
import { roleLabel } from '../users/format';
import { reasonField } from '../users/validation';
import { useCreateAssignment } from './api';
import { effectiveFromFor, effectiveToFor, todayInIndia } from './dates';
import { assignmentErrorKey } from './errors';

/**
 * Adds an area assignment for an existing person (stage PD). Same role filtering and area picker
 * as account creation, plus optional first and last days.
 */
export function AddAssignmentForm({
  userId,
  userName,
  access,
  onDone,
  onCancel,
}: {
  userId: string;
  userName: string;
  access: EffectiveAccess;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, language } = useI18n();
  const roles = useRoles();
  const create = useCreateAssignment();
  const [area, setArea] = useState<AreaNode | null>(null);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const today = todayInIndia();

  const schema = z
    .object({
      roleId: z.string().min(1, 'create.errors.roleRequired'),
      areaId: z.string().min(1, 'create.errors.areaRequired'),
      scope: z.enum(['AREA_ONLY', 'AREA_AND_DESCENDANTS']),
      firstDay: z.string().refine((v) => v === '' || v >= today, 'assignment.errors.past'),
      lastDay: z.string().refine((v) => v === '' || v >= today, 'assignment.errors.past'),
      reason: reasonField('create.errors.reasonRequired', 'create.errors.reasonTooLong'),
    })
    .superRefine((values, context) => {
      if (values.lastDay && values.firstDay && values.lastDay < values.firstDay) {
        context.addIssue({ code: 'custom', path: ['lastDay'], message: 'assignment.errors.lastBeforeStart' });
      }
    });
  type Values = z.infer<typeof schema>;

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { roleId: '', areaId: '', scope: 'AREA_ONLY', firstDay: '', lastDay: '', reason: '' },
  });

  const roleOptions = useMemo(
    () => (roles.data ? grantableRoles(roles.data.roles, access.permissions) : []),
    [roles.data, access.permissions],
  );

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await create.mutateAsync({
        userId,
        roleId: values.roleId,
        areaId: values.areaId,
        scope: values.scope,
        effectiveFrom: effectiveFromFor(values.firstDay || undefined, today),
        effectiveTo: effectiveToFor(values.lastDay || undefined),
        reason: values.reason,
      });
      onDone();
    } catch (error) {
      setServerError(assignmentErrorKey(error));
    }
  });

  return (
    <section className="card form-card" aria-labelledby="add-assignment-title">
      <h2 id="add-assignment-title">{t('assignment.addTitle', { name: userName })}</h2>
      {serverError && <Alert tone="error">{t(serverError)}</Alert>}
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {roles.isPending ? (
          <Loading />
        ) : roles.isError ? (
          <Alert tone="error">{t(errorMessageKey(roles.error))}</Alert>
        ) : (
          <SelectField
            label={t('create.roleLabel')}
            hint={t('create.roleHint')}
            errorKey={errors.roleId?.message}
            {...register('roleId')}
          >
            <option value="">—</option>
            {roleOptions.map((role) => (
              <option key={role.id} value={role.id}>
                {roleLabel(t, role.code, role, language)}
              </option>
            ))}
          </SelectField>
        )}
        <Controller
          control={control}
          name="areaId"
          render={({ fieldState }) => (
            <AreaPicker
              label={t('create.areaLabel')}
              value={area}
              errorKey={fieldState.error?.message}
              onChange={(next) => {
                setArea(next);
                setValue('areaId', next?.id ?? '', { shouldValidate: next !== null });
              }}
            />
          )}
        />
        <fieldset className="field">
          <legend>{t('create.scopeLabel')}</legend>
          <p className="field-hint">{t('create.scopeHint')}</p>
          {(['AREA_ONLY', 'AREA_AND_DESCENDANTS'] as const).map((scope) => (
            <label key={scope} className="radio">
              <input type="radio" value={scope} {...register('scope')} /> {t(`scope.${scope}`)}
            </label>
          ))}
        </fieldset>
        <TextField
          label={t('assignment.startLabel')}
          hint={t('assignment.startHint')}
          type="date"
          min={today}
          errorKey={errors.firstDay?.message}
          {...register('firstDay')}
        />
        <TextField
          label={t('assignment.lastDayLabel')}
          hint={t('assignment.lastDayHint')}
          type="date"
          min={today}
          errorKey={errors.lastDay?.message}
          {...register('lastDay')}
        />
        <TextField
          label={t('create.reasonLabel')}
          hint={t('create.reasonHint')}
          autoComplete="off"
          errorKey={errors.reason?.message}
          {...register('reason')}
        />
        <div className="button-row">
          <Button type="submit" busy={isSubmitting}>
            {isSubmitting ? t('assignment.submitting') : t('assignment.submit')}
          </Button>
          <Button variant="link" onClick={onCancel}>
            {t('create.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}
