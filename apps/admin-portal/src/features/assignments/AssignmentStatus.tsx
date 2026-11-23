import type { AssignmentView } from '@balswasthya/shared-contracts';
import { StatusBadge } from '../../components/ui';
import { useI18n } from '../../i18n';
import { formatDate } from '../users/format';
import { isCurrent } from './dates';

/** Status of an assignment as a person understands it: active, suspended, ended, revoked, starts later. */
export function AssignmentStatus({
  assignment,
}: {
  assignment: Pick<AssignmentView, 'status' | 'effectiveFrom' | 'effectiveTo'>;
}) {
  const { t, language } = useI18n();
  const now = new Date();
  if (assignment.status !== 'REVOKED' && !isCurrent(assignment, now)) {
    return <span className="badge badge-ended">{t('assignment.ended')}</span>;
  }
  return (
    <>
      <StatusBadge status={assignment.status} />
      {new Date(assignment.effectiveFrom) > now && (
        <div className="muted small">
          {t('assignment.startsOn', { date: formatDate(assignment.effectiveFrom, language) })}
        </div>
      )}
    </>
  );
}

export function AssignmentPeriod({
  assignment,
}: {
  assignment: Pick<AssignmentView, 'effectiveFrom' | 'effectiveTo'>;
}) {
  const { t, language } = useI18n();
  return (
    <>
      {t('detail.period', {
        from: formatDate(assignment.effectiveFrom, language),
        to: assignment.effectiveTo ? formatDate(assignment.effectiveTo, language) : t('detail.openEnded'),
      })}
    </>
  );
}
