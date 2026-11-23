import type { TemporaryPasswordResponse, UserView } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { hasStatus, isApiError } from '../../api/errors';
import { Alert, Button, Loading, StatusBadge, TextField } from '../../components/ui';
import { errorMessageKey, useI18n, type TranslationKey } from '../../i18n';
import { useChangeUserStatus, useResetPassword, useRevokeSessions, useUserDetail } from './api';
import { formatDate, formatDateTime, roleLabel } from './format';
import { TemporaryPasswordPanel } from './TemporaryPasswordPanel';
import { reasonFormSchema, type ReasonFormValues } from './validation';

type Action = 'suspend' | 'reactivate' | 'deactivate' | 'resetPassword' | 'revokeSessions';

function actionsFor(status: UserView['status']): Action[] {
  if (status === 'DEACTIVATED') return [];
  return [status === 'ACTIVE' ? 'suspend' : 'reactivate', 'resetPassword', 'revokeSessions', 'deactivate'];
}

export function UserDetailPage() {
  const { userId = '' } = useParams();
  const { t, language } = useI18n();
  const detail = useUserDetail(userId);
  const [open, setOpen] = useState<Action | null>(null);
  const [done, setDone] = useState<TranslationKey | null>(null);
  const [tempPassword, setTempPassword] = useState<TemporaryPasswordResponse | null>(null);

  if (detail.isPending) return <Loading />;
  if (detail.isError) {
    return (
      <>
        <Link to="/users">{t('detail.back')}</Link>
        <Alert tone="error">
          {hasStatus(detail.error, 404) ? t('detail.notFound') : t(errorMessageKey(detail.error))}
        </Alert>
      </>
    );
  }

  const { user, assignments } = detail.data;

  if (tempPassword) {
    return (
      <TemporaryPasswordPanel
        loginId={tempPassword.user.loginId}
        name={tempPassword.user.displayName}
        password={tempPassword.temporaryPassword}
        onDone={() => setTempPassword(null)}
      />
    );
  }

  return (
    <>
      <Link to="/users">{t('detail.back')}</Link>
      <section className="card" aria-labelledby="user-title">
        <h1 id="user-title">{user.displayName}</h1>
        <dl className="facts">
          <div>
            <dt>{t('detail.loginId')}</dt>
            <dd>
              <code>{user.loginId}</code>
            </dd>
          </div>
          <div>
            <dt>{t('detail.status')}</dt>
            <dd>
              <StatusBadge status={user.status} />
              {user.mustChangePassword && <span className="muted small"> {t('detail.mustChange')}</span>}
            </dd>
          </div>
          <div>
            <dt>{t('detail.lastLogin')}</dt>
            <dd>{user.lastLoginAt ? formatDateTime(user.lastLoginAt, language) : t('users.never')}</dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-labelledby="assignments-title">
        <h2 id="assignments-title">{t('detail.assignments')}</h2>
        {assignments.length === 0 ? (
          <p className="muted">{t('detail.noAssignments')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('detail.col.role')}</th>
                  <th scope="col">{t('detail.col.area')}</th>
                  <th scope="col">{t('detail.col.scope')}</th>
                  <th scope="col">{t('detail.col.status')}</th>
                  <th scope="col">{t('detail.col.period')}</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{roleLabel(t, a.roleCode)}</td>
                    <td>{a.areaName}</td>
                    <td>{t(`scope.${a.scope}`)}</td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td>
                      {t('detail.period', {
                        from: formatDate(a.effectiveFrom, language),
                        to: a.effectiveTo ? formatDate(a.effectiveTo, language) : t('detail.openEnded'),
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">{t('detail.assignmentsNext')}</p>
      </section>

      <section className="card" aria-labelledby="actions-title">
        <h2 id="actions-title">{t('detail.actions')}</h2>
        {done && <Alert tone="success">{t(done)}</Alert>}
        {user.status === 'DEACTIVATED' ? (
          <p className="muted">{t('detail.deactivatedNote')}</p>
        ) : (
          <ul className="action-list">
            {actionsFor(user.status).map((action) => (
              <li key={action}>
                {open === action ? (
                  <ActionForm
                    action={action}
                    userId={user.id}
                    onCancel={() => setOpen(null)}
                    onDone={(message, password) => {
                      setOpen(null);
                      setDone(message);
                      if (password) setTempPassword(password);
                    }}
                  />
                ) : (
                  <div className="action-row">
                    <div>
                      <strong>{t(`action.${action}`)}</strong>
                      <p className="muted small">{t(`action.${action}.help`)}</p>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDone(null);
                        setOpen(action);
                      }}
                    >
                      {t(`action.${action}`)}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Every account action needs a reason (audited) and an explicit confirmation. */
function ActionForm({
  action,
  userId,
  onCancel,
  onDone,
}: {
  action: Action;
  userId: string;
  onCancel: () => void;
  onDone: (message: TranslationKey | null, password?: TemporaryPasswordResponse) => void;
}) {
  const { t } = useI18n();
  const changeStatus = useChangeUserStatus(userId);
  const resetPassword = useResetPassword(userId);
  const revokeSessions = useRevokeSessions(userId);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReasonFormValues>({ resolver: zodResolver(reasonFormSchema), defaultValues: { reason: '' } });

  const onSubmit = handleSubmit(async ({ reason }) => {
    setServerError(null);
    try {
      switch (action) {
        case 'suspend':
        case 'reactivate':
        case 'deactivate':
          await changeStatus.mutateAsync({
            status: action === 'suspend' ? 'SUSPENDED' : action === 'reactivate' ? 'ACTIVE' : 'DEACTIVATED',
            reason,
          });
          onDone(`action.done.${action}`);
          return;
        case 'resetPassword':
          onDone(null, await resetPassword.mutateAsync(reason));
          return;
        case 'revokeSessions':
          await revokeSessions.mutateAsync(reason);
          onDone('action.done.revokeSessions');
          return;
      }
    } catch (error) {
      setServerError(
        isApiError(error) && error.status === 409 ? 'action.errors.conflict' : errorMessageKey(error),
      );
    }
  });

  return (
    <form
      className={`action-form${action === 'deactivate' ? ' danger' : ''}`}
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label={t(`action.${action}`)}
    >
      <strong>{t(`action.${action}`)}</strong>
      <p className={action === 'deactivate' ? 'warning-text' : 'muted small'}>{t(`action.${action}.help`)}</p>
      {serverError && <Alert tone="error">{t(serverError)}</Alert>}
      <TextField
        label={t('action.reasonLabel')}
        hint={t('action.reasonHint')}
        autoComplete="off"
        autoFocus
        errorKey={errors.reason?.message}
        {...register('reason')}
      />
      <div className="button-row">
        <Button type="submit" busy={isSubmitting}>
          {t('action.confirm')}
        </Button>
        <Button variant="link" onClick={onCancel}>
          {t('action.cancel')}
        </Button>
      </div>
    </form>
  );
}
