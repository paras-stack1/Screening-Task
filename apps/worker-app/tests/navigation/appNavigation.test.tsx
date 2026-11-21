import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { z } from 'zod';
import type { AppServices } from '../../src/services/appServices';
import { renderApp } from '../support/renderApp';
import { createTestContext, seedSavedSession, WORKER, type TestContext } from '../support/testServices';

// The app's services are replaced with real implementations wired to the fake backend.
let mockServices: AppServices;
jest.mock('../../src/services/appServices', () => {
  const actual = jest.requireActual('../../src/services/appServices');
  return { ...actual, getAppServices: () => mockServices };
});

jest.mock('expo-network', () => require('../support/mockNetwork').expoNetworkMock);

// Device storage used by the language provider (in-memory).
const mockDeviceStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(async (key: string) => mockDeviceStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockDeviceStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockDeviceStore.delete(key)),
}));

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  context = createTestContext();
  mockServices = context.services;
});

describe('start-up and route protection', () => {
  it('without a session shows the login screen', async () => {
    const app = await renderApp('/');
    expect(screen.getByTestId('login-screen')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/login');
  });

  it('with a saved session opens the dashboard for that worker', async () => {
    await seedSavedSession(context);
    const app = await renderApp('/');
    expect(await screen.findByText(`Namaste, ${WORKER.displayName}`)).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
  });

  it('never renders protected screens while the session is being restored', async () => {
    await seedSavedSession(context);
    context.backend.setOffline(true);
    await renderApp('/settings');
    expect(screen.queryByTestId('dashboard-screen')).toBeNull();
    expect(screen.queryByTestId('settings-screen')).toBeNull();
  });

  it.each(['/settings', '/profile', '/notifications', '/change-password'])(
    'a deep link to %s without a session lands on login',
    async (url) => {
      const app = await renderApp(url);
      expect(screen.getByTestId('login-screen')).toBeOnTheScreen();
      expect(app.getPathname()).toBe('/login');
    },
  );

  it('a signed-in user cannot open the login screen', async () => {
    await seedSavedSession(context);
    const app = await renderApp('/login');
    expect(await screen.findByTestId('dashboard-screen')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
  });

  it('an account that must change its password is held on the change-password screen', async () => {
    await seedSavedSession(context, { mustChangePassword: true });
    const app = await renderApp('/settings');
    expect(await screen.findByTestId('change-password-screen')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/change-password');
    expect(screen.queryByTestId('settings-screen')).toBeNull();
  });

  it('shows the not-found screen for unknown routes', async () => {
    await seedSavedSession(context);
    await renderApp('/does-not-exist');
    expect(await screen.findByTestId('not-found')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Go to home' }));
    expect(await screen.findByTestId('dashboard-screen')).toBeOnTheScreen();
  });

  it('offline at start-up shows a retry screen and keeps the session (decision M)', async () => {
    await seedSavedSession(context);
    context.backend.setOffline(true);
    await renderApp('/');
    expect(screen.getByTestId('restore-failed')).toBeOnTheScreen();
    expect(screen.getByText('Cannot connect to the server')).toBeOnTheScreen();

    context.backend.setOffline(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('dashboard-screen')).toBeOnTheScreen();
  });
});

describe('login screen', () => {
  const fillAndSubmit = async (loginId: string, password: string) => {
    await fireEvent.changeText(screen.getByLabelText('Employee ID'), loginId);
    await fireEvent.changeText(screen.getByLabelText('Password'), password);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  };

  it('has labelled fields, a password toggle and the language selector', async () => {
    await renderApp('/');
    expect(screen.getByRole('header', { name: 'Welcome back' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Employee ID')).toBeOnTheScreen();
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
    expect(screen.getByRole('button', { name: 'Show password' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'हिंदी' })).toBeOnTheScreen();
  });

  it('validates required fields without calling the server', async () => {
    await renderApp('/');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your employee ID')).toBeOnTheScreen();
    expect(screen.getByText('Enter your password')).toBeOnTheScreen();
    expect(context.backend.callsTo('/auth/login')).toHaveLength(0);
  });

  it('signs in with valid credentials and opens the dashboard', async () => {
    context.backend.user(WORKER);
    await renderApp('/');
    await fillAndSubmit(`  ${WORKER.loginId} `, WORKER.password);
    expect(await screen.findByText(`Namaste, ${WORKER.displayName}`)).toBeOnTheScreen();
    expect(context.backend.callsTo('/auth/login')[0]!.body).toMatchObject({ loginId: WORKER.loginId });
  });

  it('shows one generic message for wrong credentials and clears the password', async () => {
    context.backend.user(WORKER);
    await renderApp('/');
    await fillAndSubmit(WORKER.loginId, 'wrong password');
    expect(await screen.findByText(/Employee ID or password is incorrect/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Password').props.value).toBe('');
    expect(screen.getByLabelText('Employee ID').props.value).toBe(WORKER.loginId);
    expect(screen.getByTestId('login-screen')).toBeOnTheScreen();
  });

  it.each([
    ['network', 'network' as const, /Cannot reach the server/],
    ['rate limit', { status: 429 }, /Too many attempts/],
    ['server error', { status: 500 }, /The server had a problem/],
  ])('shows a clear message on %s', async (_name, failure, message) => {
    context.backend.user(WORKER);
    context.backend.override('/auth/login', failure);
    await renderApp('/');
    await fillAndSubmit(WORKER.loginId, WORKER.password);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByTestId('login-screen')).toBeOnTheScreen();
  });

  it('sends only one login request when submitted twice quickly', async () => {
    context.backend.user(WORKER);
    await renderApp('/');
    await fireEvent.changeText(screen.getByLabelText('Employee ID'), WORKER.loginId);
    await fireEvent.changeText(screen.getByLabelText('Password'), WORKER.password);
    const submitFromKeyboard = screen.getByLabelText('Password').props.onSubmitEditing as () => void;
    await act(async () => {
      submitFromKeyboard();
      submitFromKeyboard();
      submitFromKeyboard();
    });
    expect(await screen.findByTestId('dashboard-screen')).toBeOnTheScreen();
    expect(context.backend.callsTo('/auth/login')).toHaveLength(1);
  });

  it('renders in Hindi when Hindi is chosen', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    await renderApp('/');
    expect(await screen.findByRole('header', { name: 'वापसी पर स्वागत है' })).toBeOnTheScreen();
    expect(screen.getByLabelText('कर्मचारी आईडी')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'साइन इन करें' }));
    expect(await screen.findByText('अपनी कर्मचारी आईडी दर्ज करें')).toBeOnTheScreen();
  });
});

describe('signing out and session expiry', () => {
  it('signs out from settings after confirmation (decision P)', async () => {
    await seedSavedSession(context);
    await renderApp('/settings');
    await fireEvent.press(await screen.findByTestId('settings-sign-out'));
    expect(screen.getByText('Sign out?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('confirm-dialog-confirm'));

    expect(await screen.findByTestId('login-screen')).toBeOnTheScreen();
    expect(screen.getByText('You have signed out.')).toBeOnTheScreen();
    expect(await context.store.getItem('bs.auth.refreshToken')).toBeNull();
  });

  it('cancelling the confirmation keeps the user signed in', async () => {
    await seedSavedSession(context);
    await renderApp('/settings');
    await fireEvent.press(await screen.findByTestId('settings-sign-out'));
    await fireEvent.press(screen.getByTestId('confirm-dialog-cancel'));
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    expect(context.services.session.getState().status).toBe('authenticated');
  });

  it('returns to login with an explanation when the session ends during use', async () => {
    await seedSavedSession(context);
    await renderApp('/');
    await screen.findByTestId('dashboard-screen');

    context.backend.deactivate(WORKER.loginId);
    await act(async () => {
      await context.services.api.get('/probe', z.object({ ok: z.boolean() })).catch(() => undefined);
    });

    expect(await screen.findByTestId('session-ended-notice')).toBeOnTheScreen();
    expect(screen.getByText('Your session has ended. Please sign in again.')).toBeOnTheScreen();
    expect(screen.queryByTestId('dashboard-screen')).toBeNull();
  });

  it('switching accounts does not show the previous worker', async () => {
    await seedSavedSession(context);
    context.backend.user({ loginId: 'EMP-0099', password: 'doosra vakya 2026', displayName: 'Rekha Kumari' });
    await renderApp('/settings');
    await fireEvent.press(await screen.findByTestId('settings-sign-out'));
    await fireEvent.press(screen.getByTestId('confirm-dialog-confirm'));
    await screen.findByTestId('login-screen');

    await fireEvent.changeText(screen.getByLabelText('Employee ID'), 'EMP-0099');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'doosra vakya 2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Namaste, Rekha Kumari')).toBeOnTheScreen();
    expect(screen.queryByText(new RegExp(WORKER.displayName))).toBeNull();
  });
});

describe('forced password change (decision O)', () => {
  const fill = async (current: string, next: string, confirm: string) => {
    await fireEvent.changeText(screen.getByLabelText('Current (temporary) password'), current);
    await fireEvent.changeText(screen.getByLabelText('New password'), next);
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), confirm);
    await fireEvent.press(screen.getByRole('button', { name: 'Save new password' }));
  };

  beforeEach(async () => {
    await seedSavedSession(context, { mustChangePassword: true });
  });

  it('checks length and confirmation before calling the server', async () => {
    await renderApp('/');
    await screen.findByTestId('change-password-screen');
    await fill(WORKER.password, 'short', 'different');
    expect(await screen.findByText('Use at least 8 characters')).toBeOnTheScreen();
    expect(screen.getByText('The passwords do not match')).toBeOnTheScreen();
    expect(context.backend.callsTo('/auth/change-password')).toHaveLength(0);
  });

  it('shows the server policy rule next to the new password', async () => {
    await renderApp('/');
    await screen.findByTestId('change-password-screen');
    await fill(WORKER.password, 'emp-0042 surakshit', 'emp-0042 surakshit');
    expect(await screen.findByText('The password must not contain your employee ID')).toBeOnTheScreen();
  });

  it('flags an incorrect current password on that field', async () => {
    await renderApp('/');
    await screen.findByTestId('change-password-screen');
    await fill('not the password', 'naya surakshit vakya', 'naya surakshit vakya');
    expect(await screen.findByText('Current password is incorrect')).toBeOnTheScreen();
  });

  it('continues to the dashboard after a successful change', async () => {
    await renderApp('/');
    await screen.findByTestId('change-password-screen');
    await fill(WORKER.password, 'naya surakshit vakya', 'naya surakshit vakya');
    expect(await screen.findByTestId('dashboard-screen')).toBeOnTheScreen();
  });

  it('allows signing out instead', async () => {
    await renderApp('/');
    await screen.findByTestId('change-password-screen');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByTestId('login-screen')).toBeOnTheScreen();
  });
});
