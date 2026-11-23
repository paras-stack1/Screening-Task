import { Link, useNavigate, useSearchParams } from 'react-router';
import type { EffectiveAccess } from '../../auth/sessionManager';
import { Alert } from '../../components/ui';
import { useI18n } from '../../i18n';
import { AddAssignmentForm } from './AddAssignmentForm';

/**
 * /assignments/new?userId=…&name=… - opened from the assignments list (the way supervisors add
 * an area for someone). The name is only for display; the API identifies the person by id and
 * checks everything again.
 */
export function AddAssignmentPage({ access }: { access: EffectiveAccess }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const userId = params.get('userId');
  const name = params.get('name') ?? '';

  if (!userId) {
    return (
      <>
        <Alert tone="info">{t('assignment.missingPerson')}</Alert>
        <Link to="/assignments">{t('nav.assignments')}</Link>
      </>
    );
  }
  return (
    <AddAssignmentForm
      userId={userId}
      userName={name}
      access={access}
      onDone={() => void navigate('/assignments', { state: { added: true } })}
      onCancel={() => void navigate(-1)}
    />
  );
}
