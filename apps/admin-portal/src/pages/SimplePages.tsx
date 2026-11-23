import { Link } from 'react-router';
import { useServices } from '../app/services';
import { LanguageSelect } from '../components/LanguageSelect';
import { Button } from '../components/ui';
import { useI18n } from '../i18n';

/** Signed in, but the account has neither user.manage nor assignment.manage (decision P2). */
export function NotAdminPage({ name }: { name: string }) {
  const { t } = useI18n();
  const { session } = useServices();
  return (
    <div className="auth-page">
      <main className="auth-card" id="main">
        <div className="auth-top">
          <p className="brand">{t('app.name')}</p>
          <LanguageSelect />
        </div>
        <h1>{t('notAdmin.title')}</h1>
        <p className="muted">{t('header.signedInAs', { name })}</p>
        <p>{t('notAdmin.body')}</p>
        <Button onClick={() => void session.logout()}>{t('common.signOut')}</Button>
      </main>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <>
      <h1>{t('notFound.title')}</h1>
      <Link to="/">{t('notFound.back')}</Link>
    </>
  );
}

/** Full-page states before the app shell exists (loading, unreachable server, bad config). */
export function CenteredMessage({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="auth-page">
      <main className="auth-card" id="main">
        <p className="brand">{t('app.name')}</p>
        {children}
      </main>
    </div>
  );
}
