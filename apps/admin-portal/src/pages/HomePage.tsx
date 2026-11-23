import type { AuthUser } from '@balswasthya/shared-contracts';
import type { EffectiveAccess } from '../auth/sessionManager';
import { Alert } from '../components/ui';
import { isTranslationKey, useI18n } from '../i18n';

/** Signed-in landing page: who you are and which areas you administer. No child data. */
export function HomePage({ user, access }: { user: AuthUser; access: EffectiveAccess }) {
  const { t, language } = useI18n();
  const roleLabel = (code: string) => {
    const key = `role.${code}`;
    return isTranslationKey(key) ? t(key) : code;
  };

  return (
    <>
      <h1>{t('home.title', { name: user.displayName })}</h1>
      <p className="muted">{t('home.intro')}</p>

      <section className="card" aria-labelledby="access-heading">
        <h2 id="access-heading">{t('home.yourAccess')}</h2>
        {access.permissions.includes('user.manage') && <p>{t('home.canManageUsers')}</p>}
        {access.permissions.includes('assignment.manage') && <p>{t('home.canManageAssignments')}</p>}
        {access.assignments.length === 0 ? (
          <p className="muted">{t('home.noAssignments')}</p>
        ) : (
          <ul className="assignment-list">
            {access.assignments.map((a) => (
              <li key={a.assignmentId}>
                <strong>{roleLabel(a.roleCode)}</strong>
                <span>{language === 'hi' && a.areaNameHi ? a.areaNameHi : a.areaName}</span>
                <span className="muted small">{t(`scope.${a.scope}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Alert tone="info">{t('home.privacy')}</Alert>
    </>
  );
}
