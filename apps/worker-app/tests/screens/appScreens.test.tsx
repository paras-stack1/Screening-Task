import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import type { AppServices } from '../../src/services/appServices';
import { network, OFFLINE, ONLINE } from '../support/mockNetwork';
import { ASHA_ASSIGNMENT } from '../support/fakeBackend';
import { renderApp } from '../support/renderApp';
import { createTestContext, seedSavedSession, WORKER, type TestContext } from '../support/testServices';

let mockServices: AppServices;
jest.mock('../../src/services/appServices', () => {
  const actual = jest.requireActual('../../src/services/appServices');
  return { ...actual, getAppServices: () => mockServices };
});
jest.mock('expo-network', () => require('../support/mockNetwork').expoNetworkMock);
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0' } } }));
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
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

const ADMIN = {
  permissions: ['report.aggregate', 'user.manage'],
  assignments: [
    {
      ...ASHA_ASSIGNMENT,
      assignmentId: 'assignment-admin',
      roleCode: 'STATE_ADMIN',
      scope: 'AREA_AND_DESCENDANTS' as const,
      areaName: 'Uttar Pradesh (synthetic)',
      areaNameHi: 'उत्तर प्रदेश (कृत्रिम)',
      areaLevel: 'STATE',
    },
  ],
};

const metric = () => screen.getByTestId('metric-registered-children');

describe('dashboard', () => {
  it('shows the real registered-children total from the API', async () => {
    context.backend.setChildrenTotal(27);
    await seedSavedSession(context);
    await renderApp('/');
    await waitFor(() => expect(within(metric()).getByText('27')).toBeOnTheScreen());
    expect(screen.getByLabelText('Registered children: 27')).toBeOnTheScreen();
    expect(context.backend.callsTo('/children?pageSize=1')).toHaveLength(1);
  });

  it('shows a real zero as 0', async () => {
    await seedSavedSession(context);
    await renderApp('/');
    await waitFor(() => expect(within(metric()).getByText('0')).toBeOnTheScreen());
  });

  it('never invents the three metrics the API cannot provide (decision C)', async () => {
    context.backend.setChildrenTotal(5);
    await seedSavedSession(context);
    await renderApp('/');
    await waitFor(() => expect(within(metric()).getByText('5')).toBeOnTheScreen());
    for (const label of ['Screened today', 'Pending follow-ups', 'Pending referrals']) {
      expect(screen.getByLabelText(`${label}: not available yet`)).toBeOnTheScreen();
    }
    expect(screen.queryByText('0')).toBeNull();
  });

  it('does not request children for a role without child.read (decision Q)', async () => {
    await seedSavedSession(context, ADMIN);
    await renderApp('/');
    expect(
      await screen.findByLabelText('Registered children: Not available for your role'),
    ).toBeOnTheScreen();
    // Register is shown as unavailable for this role, never as an active button.
    expect(
      screen.getByRole('button', { name: 'Register a child. Not available for your role' }),
    ).toBeDisabled();
    expect(context.backend.calls.filter((call) => call.path.startsWith('/children'))).toHaveLength(0);
  });

  it('shows "could not load" with a retry, then recovers', async () => {
    context.backend.setChildrenTotal(12);
    context.backend.override('/children?pageSize=1', { status: 400 });
    await seedSavedSession(context);
    await renderApp('/');
    expect(await within(metric()).findByText('Could not load')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(metric()).getByText('12')).toBeOnTheScreen());
  });

  it('Register is available to a worker with child.create; screening and follow-ups are not yet', async () => {
    await seedSavedSession(context);
    await renderApp('/');
    expect(await screen.findByRole('button', { name: 'Register a child' })).toBeEnabled();
    for (const title of ['Start screening', 'Manage follow-ups']) {
      expect(await screen.findByRole('button', { name: `${title}. Coming soon` })).toBeDisabled();
    }
  });

  it('shows the four RBSK categories without results', async () => {
    await seedSavedSession(context);
    await renderApp('/');
    for (const title of [
      'Defects at birth',
      'Deficiencies',
      'Diseases',
      'Developmental delays and disabilities',
    ]) {
      expect(await screen.findByText(title)).toBeOnTheScreen();
    }
    expect(screen.getByText('Information only. No screening results are shown here.')).toBeOnTheScreen();
  });

  it('header shortcuts open notifications and profile', async () => {
    await seedSavedSession(context);
    const app = await renderApp('/');
    await fireEvent.press(await screen.findByRole('button', { name: 'Open notifications' }));
    expect(app.getPathname()).toBe('/notifications');
    expect(await screen.findByText('Notifications are not available yet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Home' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Open profile' }));
    expect(app.getPathname()).toBe('/profile');
  });

  it('renders in Hindi', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    await seedSavedSession(context);
    await renderApp('/');
    expect(await screen.findByText(`नमस्ते, ${WORKER.displayName}`)).toBeOnTheScreen();
    expect(screen.getByText('पंजीकृत बच्चे')).toBeOnTheScreen();
    expect(screen.getByText('जन्म के समय दोष')).toBeOnTheScreen();
  });
});

describe('profile', () => {
  it('shows name, status, role and area from /auth/me', async () => {
    await seedSavedSession(context);
    await renderApp('/profile');
    expect(await screen.findByText('Rampur (synthetic) (Village)')).toBeOnTheScreen();
    expect(screen.getByText(WORKER.displayName)).toBeOnTheScreen();
    expect(screen.getByText('Active')).toBeOnTheScreen();
    expect(screen.getByText('ASHA')).toBeOnTheScreen();
    expect(screen.getByText('This area only')).toBeOnTheScreen();
    expect(screen.getByText('Your role and areas are managed by your administrator.')).toBeOnTheScreen();
  });

  it('uses Hindi area and role names in Hindi', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    await seedSavedSession(context, ADMIN);
    await renderApp('/profile');
    expect(await screen.findByText('उत्तर प्रदेश (कृत्रिम) (राज्य)')).toBeOnTheScreen();
    expect(screen.getByText('राज्य प्रशासक')).toBeOnTheScreen();
    expect(screen.getByText('यह क्षेत्र और इसके अंतर्गत सभी क्षेत्र')).toBeOnTheScreen();
  });

  it('shows an unknown role code as-is instead of hiding it', async () => {
    await seedSavedSession(context, { assignments: [{ ...ASHA_ASSIGNMENT, roleCode: 'NEW_ROLE_X' }] });
    await renderApp('/profile');
    expect(await screen.findByText('NEW_ROLE_X')).toBeOnTheScreen();
  });

  it('explains when there is no active assignment', async () => {
    await seedSavedSession(context, { assignments: [] });
    await renderApp('/profile');
    expect(
      await screen.findByText('No active assignment. Please contact your supervisor.'),
    ).toBeOnTheScreen();
  });

  it('shows an error with retry when the profile cannot load', async () => {
    await seedSavedSession(context);
    context.backend.override('/auth/me', { status: 400 });
    await renderApp('/profile');
    expect(await screen.findByRole('header', { name: 'Something went wrong' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('ASHA')).toBeOnTheScreen();
  });

  it('has no controls to edit role or area', async () => {
    await seedSavedSession(context);
    await renderApp('/profile');
    await screen.findByText('ASHA');
    expect(within(screen.getByTestId('profile-screen')).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('settings', () => {
  it('shows language, privacy, version and sign out', async () => {
    await seedSavedSession(context);
    await renderApp('/settings');
    expect(await screen.findByRole('radio', { name: 'English' })).toBeChecked();
    expect(screen.getByText(/Children's records are not stored on this phone/)).toBeOnTheScreen();
    expect(screen.getByTestId('app-version')).toHaveTextContent(/^Version \d+\.\d+\.\d+$/);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });

  it('changing the language updates the whole app and is saved', async () => {
    await seedSavedSession(context);
    await renderApp('/settings');
    await fireEvent.press(await screen.findByRole('radio', { name: 'हिंदी' }));
    expect(await screen.findByRole('button', { name: 'सेटिंग्स' })).toBeOnTheScreen();
    expect(mockDeviceStore.get('bs.language')).toBe('hi');
  });
});

describe('offline foundation', () => {
  it('shows the offline banner and status, and hides them when back online', async () => {
    await seedSavedSession(context);
    await renderApp('/');
    expect(await screen.findByText('Online')).toBeOnTheScreen();
    expect(screen.queryByTestId('offline-banner')).toBeNull();

    await act(async () => network.set(OFFLINE));
    expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();
    expect(screen.getByText('Offline')).toBeOnTheScreen();

    await act(async () => network.set(ONLINE));
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('shows the banner on the login screen too', async () => {
    network.set(OFFLINE);
    await renderApp('/');
    expect(screen.getByTestId('login-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();
  });

  it('pauses data loading offline (no endless spinner) and loads when back online', async () => {
    context.backend.setChildrenTotal(9);
    await seedSavedSession(context);
    const first = await renderApp('/');
    await waitFor(() => expect(within(metric()).getByText('9')).toBeOnTheScreen());
    await first.unmount();

    // App restarted (new services and cache) while offline: nothing can load.
    context = createTestContext({ backend: context.backend, store: context.store });
    mockServices = context.services;
    network.set(OFFLINE);
    await renderApp('/');
    expect(await within(metric()).findByText('Could not load')).toBeOnTheScreen();

    await act(async () => network.set(ONLINE));
    await waitFor(() => expect(within(metric()).getByText('9')).toBeOnTheScreen());
  });
});

describe('performance: no unnecessary network calls', () => {
  it('start-up with a saved session makes one refresh, then only the dashboard data calls', async () => {
    await seedSavedSession(context);
    await renderApp('/');
    await waitFor(() => expect(within(metric()).getByText('0')).toBeOnTheScreen());
    expect(context.backend.calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual([
      'GET /auth/me',
      'GET /children?pageSize=1',
      'POST /auth/refresh',
    ]);
  });

  it('moving between tabs reuses cached data instead of refetching', async () => {
    await seedSavedSession(context);
    await renderApp('/');
    await waitFor(() => expect(within(metric()).getByText('0')).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: 'Profile' }));
    expect(await screen.findByText('ASHA')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Home' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Profile' }));
    expect(context.backend.callsTo('/auth/me')).toHaveLength(1);
    expect(context.backend.callsTo('/children?pageSize=1')).toHaveLength(1);
  });

  it('changing the language makes no network calls', async () => {
    await seedSavedSession(context);
    await renderApp('/settings');
    await screen.findByRole('radio', { name: 'English' });
    const before = context.backend.calls.length;
    await fireEvent.press(screen.getByRole('radio', { name: 'हिंदी' }));
    await screen.findByRole('radio', { name: 'हिंदी' });
    expect(context.backend.calls.length).toBe(before);
  });
});
