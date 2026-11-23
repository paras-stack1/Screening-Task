import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { createPortalServices, ServicesProvider, type PortalServices } from '../src/app/services';
import { I18nProvider, type Language } from '../src/i18n';
import { BASE_URL, standardServer, type FakeServer } from './support/fakeServer';

let server: FakeServer;

beforeEach(() => {
  server = standardServer();
});

function renderPortal(options: { path?: string; language?: Language; services?: PortalServices } = {}) {
  const services = options.services ?? createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch });
  const user = userEvent.setup();
  render(
    <ServicesProvider services={services}>
      <I18nProvider initial={options.language ?? 'en'}>
        <MemoryRouter initialEntries={[options.path ?? '/']}>
          <App />
        </MemoryRouter>
      </I18nProvider>
    </ServicesProvider>,
  );
  return { user, services };
}

async function signIn(user: ReturnType<typeof userEvent.setup>, loginId: string, password: string) {
  await user.type(await screen.findByLabelText('Login ID'), loginId);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign in', () => {
  it('shows the sign-in page when there is no session', async () => {
    renderPortal();
    expect(await screen.findByRole('heading', { name: 'Administrator sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('validates the form before calling the API', async () => {
    const { user } = renderPortal();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your login ID')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Login ID')).toHaveAttribute('aria-invalid', 'true');
    expect(server.callsTo('/auth/web/login')).toHaveLength(0);
  });

  it('wrong password: generic message, password field emptied', async () => {
    const { user } = renderPortal();
    await signIn(user, 'ADMIN-0001', 'not-the-password');
    expect(await screen.findByTestId('login-error')).toHaveTextContent(
      'Login ID or password is incorrect, or the account is not active.',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Login ID')).toHaveValue('ADMIN-0001');
  });

  it('server unreachable: a network message, not "wrong password"', async () => {
    server.failNext('/auth/web/login', 'network');
    const { user } = renderPortal();
    await signIn(user, 'ADMIN-0001', 'Synthetic-admin-2026');
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Cannot reach the server');
  });

  it('an administrator reaches the portal: name, role, area and scope; never child data', async () => {
    const { user } = renderPortal();
    await signIn(user, 'ADMIN-0001', 'Synthetic-admin-2026');
    expect(
      await screen.findByRole('heading', { name: 'Welcome, Synthetic State Admin' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('signed-in-as')).toHaveTextContent('Signed in as Synthetic State Admin');
    const access = screen.getByRole('region', { name: 'Your administrative access' });
    expect(within(access).getByText('State Administrator')).toBeInTheDocument();
    expect(within(access).getByText('Demo State (synthetic)')).toBeInTheDocument();
    expect(within(access).getByText('This area and all areas within it')).toBeInTheDocument();
    expect(
      within(access).getByText('You can create and manage user accounts in these areas.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/never shows children’s or guardians’ details/)).toBeInTheDocument();
  });

  it('keeps the requested address: signing in on /users opens the users page', async () => {
    const { user } = renderPortal({ path: '/users' });
    await signIn(user, 'ADMIN-0001', 'Synthetic-admin-2026');
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
  });
});

describe('who may use the portal (decision P2)', () => {
  it('a field worker sees "This portal is for administrators" and no admin pages', async () => {
    const { user } = renderPortal({ path: '/users' });
    await signIn(user, 'ASHA-0001', 'Synthetic-asha-2026');
    expect(
      await screen.findByRole('heading', { name: 'This portal is for administrators' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('You have signed out.')).toBeInTheDocument();
  });
});

describe('forced password change', () => {
  it('a temporary password must be replaced before anything else', async () => {
    const { user } = renderPortal();
    await signIn(user, 'ADMIN-NEW', 'TEMP-ABCD-EFGH');
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    // Client-side checks
    await user.type(screen.getByLabelText('Current password'), 'TEMP-ABCD-EFGH');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument();
    expect(server.callsTo('/auth/web/change-password')).toHaveLength(0);

    // Server policy rule shown on the right field
    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'password123');
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(
      await screen.findByText('This password is too easy to guess. Choose another one.'),
    ).toBeInTheDocument();

    // Success opens the portal
    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'A sentence I can remember 7');
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'A sentence I can remember 7');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Synthetic New Admin' })).toBeInTheDocument();
  });

  it('a wrong current password is shown on the current-password field', async () => {
    const { user } = renderPortal();
    await signIn(user, 'ADMIN-NEW', 'TEMP-ABCD-EFGH');
    await user.type(await screen.findByLabelText('Current password'), 'WRONG-TEMP-PASS');
    await user.type(screen.getByLabelText('New password'), 'A sentence I can remember 7');
    await user.type(screen.getByLabelText('Confirm new password'), 'A sentence I can remember 7');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
  });
});

describe('signed-in shell', () => {
  it('voluntary password change from the navigation', async () => {
    const { user } = renderPortal();
    await signIn(user, 'ADMIN-0001', 'Synthetic-admin-2026');
    await user.click(await screen.findByRole('link', { name: 'Change password' }));
    expect(
      screen.getByText('Changing your password signs you out on every other device and browser.'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Current password'), 'Synthetic-admin-2026');
    await user.type(screen.getByLabelText('New password'), 'Another long sentence 2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'Another long sentence 2026');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText('Your password has been changed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('sign out returns to the sign-in page with a confirmation', async () => {
    const { user } = renderPortal();
    await signIn(user, 'ADMIN-0001', 'Synthetic-admin-2026');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('You have signed out.')).toBeInTheDocument();
    expect(server.cookie).toBeNull();
  });

  it('an unknown address shows "Page not found" inside the shell', async () => {
    const { user } = renderPortal({ path: '/no-such-page' });
    await signIn(user, 'ADMIN-0001', 'Synthetic-admin-2026');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('a session ended elsewhere shows "Your session has ended" on the sign-in page', async () => {
    const { user, services } = renderPortal();
    await signIn(user, 'ADMIN-0001', 'Synthetic-admin-2026');
    await screen.findByRole('heading', { name: 'Welcome, Synthetic State Admin' });
    server.revokeAllSessions(); // e.g. another administrator reset this person's password
    await services.session.refresh().catch(() => undefined);
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeInTheDocument();
  });
});

describe('page load states and language', () => {
  it('server unreachable on page load: message and retry', async () => {
    await createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch }).session.login(
      'ADMIN-0001',
      'Synthetic-admin-2026',
    );
    server.failNext('/auth/web/refresh', 'network');
    const { user } = renderPortal();
    expect(
      await screen.findByText('Could not reach the server to continue your session.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Welcome, Synthetic State Admin' }),
    ).toBeInTheDocument();
  });

  it('no API address configured: a clear message and no request', () => {
    renderPortal({ services: createPortalServices({ apiBaseUrl: null, fetchFn: server.fetch }) });
    expect(screen.getByText(/The portal is not set up correctly/)).toBeInTheDocument();
    expect(server.calls).toHaveLength(0);
  });

  it('Hindi can be chosen on the sign-in page and is remembered in this browser', async () => {
    const { user } = renderPortal();
    await screen.findByRole('heading', { name: 'Administrator sign in' });
    await user.selectOptions(screen.getByLabelText('Language'), 'hi');
    expect(screen.getByRole('heading', { name: 'प्रशासक साइन इन' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
    expect(window.localStorage.getItem('balswasthya-admin-language')).toBe('hi');
  });
});
