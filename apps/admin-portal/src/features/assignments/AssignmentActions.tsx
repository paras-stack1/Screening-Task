import type { AssignmentView } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, TextField } from '../../components/ui';
import { useI18n, type TranslationKey } from '../../i18n';
import { reasonField } from '../users/validation';
import { useAssignmentAction, type AssignmentAction } from './api';
import { effectiveToFor, isCurrent, todayInIndia } from './dates';
import { assignmentErrorKey } from './errors';

/** Which actions make sense for an assignment in its current state. */
export function actionsFor(
  assignment: Pick<AssignmentView, 'status' | 'effectiveTo'>,
  now = new Date(),
): AssignmentAction[] {
  if (!isCurrent(assignment, now)) return [];
  return assignment.status === 'SUSPENDED' ? ['reactivate', 'end', 'revoke'] : ['suspend', 'end', 'revoke'];
}

/**
 * Buttons for one assignment; choosing one opens an inline form with a required reason (and, for
 * "end", an optional last day) and an explicit Confirm.
 */
export function AssignmentActions({
  assignment,
  label,
  onDone,
}: {
  assignment: AssignmentView;
  /** Accessible name of the group, e.g. "Actions for ASHA in Demo Village One". */
  label: string;
  onDone: (message: TranslationKey) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<AssignmentAction | null>(null);
  const actions = actionsFor(assignment);
  if (actions.length === 0) return null;

  if (open) {
    return (
      <ActionForm
        assignmentId={assignment.id}
        action={open}
        onCancel={() => setOpen(null)}
        onDone={() => {
          setOpen(null);
          onDone(`assignment.done.${open}`);
        }}
      />
    );
  }
  return (
    <div className="button-row" role="group" aria-label={label}>
      {actions.map((action) => (
        <Button key={action} variant="secondary" onClick={() => setOpen(action)}>
          {t(`assignment.action.${action}`)}
        </Button>
      ))}
    </div>
  );
}

function ActionForm({
  assignmentId,
  action,
  onCancel,
  onDone,
}: {
  assignmentId: string;
  action: AssignmentAction;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const mutation = useAssignmentAction(assignmentId);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const today = todayInIndia();
  const schema = z.object({
    reason: reasonField('action.errors.reasonRequired', 'action.errors.reasonTooLong'),
    lastDay: z
      .string()
      .refine((value) => value === '' || value >= today, 'assignment.errors.past')
      .optional(),
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '', lastDay: '' },
  });

  const onSubmit = handleSubmit(async ({ reason, lastDay }) => {
    setServerError(null);
    try {
      await mutation.mutateAsync({ action, reason, effectiveTo: effectiveToFor(lastDay || undefined) });
      onDone();
    } catch (error) {
      setServerError(assignmentErrorKey(error));
    }
  });

  return (
    <form
      className={`action-form${action === 'revoke' ? ' danger' : ''}`}
      aria-label={t(`assignment.action.${action}`)}
      onSubmit={(event) => void onSubmit(event)}
      noValidate
    >
      <strong>{t(`assignment.action.${action}`)}</strong>
      <p className={action === 'revoke' ? 'warning-text' : 'muted small'}>
        {t(`assignment.action.${action}.help`)}
      </p>
      {serverError && <Alert tone="error">{t(serverError)}</Alert>}
      {action === 'end' && (
        <TextField
          label={t('assignment.endLastDayLabel')}
          type="date"
          min={today}
          errorKey={errors.lastDay?.message}
          {...register('lastDay')}
        />
      )}
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
