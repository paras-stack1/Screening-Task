import type { AreaNode, TemporaryPasswordResponse } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { isApiError } from '../../api/errors';
import type { EffectiveAccess } from '../../auth/sessionManager';
import { Alert, Button, Loading, SelectField, TextField } from '../../components/ui';
import { errorMessageKey, LANGUAGE_OPTIONS, useI18n, type TranslationKey } from '../../i18n';
import { grantableRoles, useCreateUser, useRoles } from './api';
import { AreaPicker } from './AreaPicker';
import { roleLabel } from './format';
import { TemporaryPasswordPanel } from './TemporaryPasswordPanel';
import { createUserFormSchema, type CreateUserFormInput, type CreateUserFormValues } from './validation';

/** Server refusal codes shown as specific messages (all other errors: generic, translated). */
const CREATE_ERRORS: Record<string, TranslationKey> = {
  OUT_OF_SCOPE: 'create.errors.outOfScope',
  ROLE_EXCEEDS_OWN_PERMISSIONS: 'create.errors.roleTooHigh',
};

export function CreateUserPage({ access }: { access: EffectiveAccess }) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const roles = useRoles();
  const create = useCreateUser();
  const [area, setArea] = useState<AreaNode | null>(null);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [created, setCreated] = useState<TemporaryPasswordResponse | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserFormInput, unknown, CreateUserFormValues>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: {
      loginId: '',
      displayName: '',
      preferredLanguage: 'hi',
      roleId: '',
      areaId: '',
      scope: 'AREA_ONLY',
      reason: '',
    },
  });

  const roleOptions = useMemo(
    () => (roles.data ? grantableRoles(roles.data.roles, access.permissions) : []),
    [roles.data, access.permissions],
  );

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const result = await create.mutateAsync({
        loginId: values.loginId,
        displayName: values.displayName,
        preferredLanguage: values.preferredLanguage,
        assignment: {
          areaId: values.areaId,
          roleId: values.roleId,
          scope: values.scope,
          reason: values.reason,
        },
      });
      setCreated(result);
    } catch (error) {
      if (isApiError(error) && error.code === 'LOGIN_ID_TAKEN') {
        setError('loginId', { message: 'create.errors.loginIdTaken' });
      } else if (isApiError(error) && error.code && CREATE_ERRORS[error.code]) {
        setServerError(CREATE_ERRORS[error.code]!);
      } else if (isApiError(error) && error.status === 400) {
        setServerError('create.errors.areaInactive');
      } else {
        setServerError(errorMessageKey(error));
      }
    }
  });

  if (created) {
    return (
      <TemporaryPasswordPanel
        loginId={created.user.loginId}
        name={created.user.displayName}
        password={created.temporaryPassword}
        onDone={() => {
          const id = created.user.id;
          setCreated(null);
          void navigate(`/users/${id}`, { replace: true });
        }}
      />
    );
  }

  return (
    <section className="card form-card" aria-labelledby="create-title">
      <h1 id="create-title">{t('create.title')}</h1>
      <p className="muted">{t('create.intro')}</p>
      {serverError && <Alert tone="error">{t(serverError)}</Alert>}
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextField
          label={t('create.loginIdLabel')}
          hint={t('create.loginIdHint')}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          errorKey={errors.loginId?.message}
          {...register('loginId')}
        />
        <TextField
          label={t('create.displayNameLabel')}
          autoComplete="off"
          errorKey={errors.displayName?.message}
          {...register('displayName')}
        />
        <SelectField label={t('create.languageLabel')} {...register('preferredLanguage')}>
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} lang={option.value}>
              {option.nativeName}
            </option>
          ))}
        </SelectField>

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
          label={t('create.reasonLabel')}
          hint={t('create.reasonHint')}
          autoComplete="off"
          errorKey={errors.reason?.message}
          {...register('reason')}
        />

        <div className="button-row">
          <Button type="submit" busy={isSubmitting}>
            {isSubmitting ? t('create.submitting') : t('create.submit')}
          </Button>
          <Link to="/users">{t('create.cancel')}</Link>
        </div>
      </form>
    </section>
  );
}
