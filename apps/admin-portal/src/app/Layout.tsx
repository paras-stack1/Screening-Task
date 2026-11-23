import type { AuthUser } from '@balswasthya/shared-contracts';
import { NavLink, Outlet } from 'react-router';
import { LanguageSelect } from '../components/LanguageSelect';
import { Button } from '../components/ui';
import { useI18n } from '../i18n';
import { useServices } from './services';

/** Shell for signed-in administrators: header, navigation, main content. */
export function Layout({ user }: { user: AuthUser }) {
  const { t } = useI18n();
  const { session } = useServices();
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="topbar">
        <div>
          <p className="brand">{t('app.name')}</p>
          <p className="muted small">{t('app.tagline')}</p>
        </div>
        <div className="topbar-actions">
          <span className="small" data-testid="signed-in-as">
            {t('header.signedInAs', { name: user.displayName })}
          </span>
          <LanguageSelect />
          <Button variant="secondary" onClick={() => void session.logout()}>
            {t('common.signOut')}
          </Button>
        </div>
      </header>
      <nav className="sidenav" aria-label={t('nav.label')}>
        <NavLink to="/" end>
          {t('nav.home')}
        </NavLink>
        <NavLink to="/users">{t('nav.users')}</NavLink>
        <NavLink to="/assignments">{t('nav.assignments')}</NavLink>
        <NavLink to="/account/password">{t('nav.password')}</NavLink>
      </nav>
      <main className="content" id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
