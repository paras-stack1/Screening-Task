import { Route, Routes } from 'react-router';
import { canUsePortal } from '../auth/sessionManager';
import { Alert, Button, Loading } from '../components/ui';
import { useI18n } from '../i18n';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { AddAssignmentPage } from '../features/assignments/AddAssignmentPage';
import { AssignmentsPage } from '../features/assignments/AssignmentsPage';
import { CreateUserPage } from '../features/users/CreateUserPage';
import { UserDetailPage } from '../features/users/UserDetailPage';
import { UsersPage } from '../features/users/UsersPage';
import { CenteredMessage, NotAdminPage, NotFoundPage } from '../pages/SimplePages';
import { Layout } from './Layout';
import { useServices, useSessionState } from './services';

/**
 * Decides what the person may see (decision P2). Nothing of the admin shell is rendered until
 * the session is known; the API checks every request again regardless.
 *
 *   no API address        -> configuration message
 *   initializing          -> loading
 *   restoreFailed         -> "could not reach the server" + retry
 *   unauthenticated       -> sign in (any URL; the URL is kept)
 *   must change password  -> forced password change, nothing else
 *   not an administrator  -> "this portal is for administrators" + sign out
 *   administrator         -> the portal
 */
export function App() {
  const { t } = useI18n();
  const { session, apiConfigured } = useServices();
  const state = useSessionState();

  if (!apiConfigured) {
    return (
      <CenteredMessage>
        <Alert tone="error">{t('app.notConfigured')}</Alert>
      </CenteredMessage>
    );
  }

  switch (state.status) {
    case 'initializing':
      return (
        <CenteredMessage>
          <Loading />
        </CenteredMessage>
      );
    case 'restoreFailed':
      return (
        <CenteredMessage>
          <Alert tone="error">{t('restore.failed')}</Alert>
          <Button onClick={() => void session.retryRestore()}>{t('common.retry')}</Button>
        </CenteredMessage>
      );
    case 'unauthenticated':
      return <LoginPage reason={state.reason} />;
    case 'authenticated':
      break;
  }

  if (state.user.mustChangePassword) return <ChangePasswordPage forced />;
  if (!canUsePortal(state.access)) return <NotAdminPage name={state.user.displayName} />;
  const canManageUsers = state.access.permissions.includes('user.manage');

  return (
    <Routes>
      <Route element={<Layout user={state.user} />}>
        <Route index element={<HomePage user={state.user} access={state.access} />} />
        <Route path="users" element={<UsersPage canManageUsers={canManageUsers} />} />
        <Route
          path="users/new"
          element={
            canManageUsers ? <CreateUserPage access={state.access} /> : <UsersPage canManageUsers={false} />
          }
        />
        <Route path="users/:userId" element={<UserDetailPage access={state.access} />} />
        <Route path="assignments" element={<AssignmentsPage canManageUsers={canManageUsers} />} />
        <Route path="assignments/new" element={<AddAssignmentPage access={state.access} />} />
        <Route path="account/password" element={<ChangePasswordPage forced={false} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
