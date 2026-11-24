import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';
import type { AppServices } from '../../src/services';
import { REFRESH_TOKEN_KEY } from '../../src/storage';
import { child, CODE, createTestServices, PASSWORD, PHONE, VALID_TOKEN } from '../support/fakeParentApi';

let mockServices: AppServices;
jest.mock('../../src/services', () => {
  const actual = jest.requireActual('../../src/services');
  return { ...actual, getAppServices: () => mockServices };
});
const mockReadInviteToken = jest.fn<Promise<string | null>, []>();
jest.mock('../../src/inviteToken', () => ({ readInviteToken: () => mockReadInviteToken() }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const APP_DIR = path.resolve(__dirname, '../../app');
let ctx: ReturnType<typeof createTestServices>;

beforeEach(() => {
  ctx = createTestServices();
  mockServices = ctx.services;
  mockReadInviteToken.mockResolvedValue(null);
  // English for readable assertions; Hindi is the default (checked separately).
  void ctx.store.set('bs.parent.language', 'en');
});

async function open(url: string) {
  await renderRouter(APP_DIR, { initialUrl: url });
  await waitFor(() => expect(screen.queryByTestId('session-restoring')).toBeNull());
}

async function signIn() {
  await open('/login');
  await fireEvent.changeText(await screen.findByTestId('login-phone'), '98111 22233');
  await fireEvent.changeText(screen.getByTestId('login-password'), PASSWORD);
  await fireEvent.press(screen.getByTestId('login-submit'));
  await screen.findByTestId('home-screen');
}

describe('invitation, code and activation', () => {
  it('walks from the SMS link to an activated account - no child details before sign-in', async () => {
    mockReadInviteToken.mockResolvedValue(VALID_TOKEN);
    await open('/invite');
    expect(await screen.findByTestId('invite-phone')).toHaveTextContent('********2233');
    expect(screen.queryByText(/Aarav/)).toBeNull();

    await fireEvent.press(screen.getByTestId('invite-send-code'));
    await screen.findByTestId('verify-screen');
    await fireEvent.changeText(screen.getByTestId('otp-code'), '000000');
    await fireEvent.press(screen.getByTestId('otp-verify'));
    expect(await screen.findByText('The code is not correct. 4 tries left.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('otp-code'), CODE);
    await fireEvent.press(screen.getByTestId('otp-verify'));

    await screen.findByTestId('create-password-screen');
    await screen.findByTestId('legal-PRIVACY_NOTICE');
    expect(
      screen.getByText('Creating an account does not give consent for any use of health information.'),
    ).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('password-new'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('password-confirm'), PASSWORD);
    await fireEvent.press(screen.getByTestId('create-account'));
    expect(await screen.findByText('Please read and accept both to continue.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('password-new'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('password-confirm'), PASSWORD);
    await fireEvent.press(screen.getByTestId('accept-privacy'));
    await fireEvent.press(screen.getByTestId('accept-terms'));
    await fireEvent.press(screen.getByTestId('create-account'));
    await screen.findByTestId('activated-screen');
    const activation = ctx.backend.state.calls.find((c) => c.path === '/parent/activate')!;
    expect(activation.body).toMatchObject({
      token: VALID_TOKEN,
      activationTicket: 'ticket-1',
      acceptPrivacyNotice: true,
      acceptTerms: true,
    });
    // The token and code never went into storage.
    expect([...ctx.store.data.values()].join(' ')).not.toContain(VALID_TOKEN);

    await fireEvent.press(screen.getByTestId('activated-sign-in'));
    await screen.findByTestId('login-screen');
  });

  it('shows a clear message for an unusable link', async () => {
    mockReadInviteToken.mockResolvedValue(VALID_TOKEN);
    ctx.backend.state.invitationValid = false;
    await open('/invite');
    expect(await screen.findByTestId('invite-invalid')).toBeOnTheScreen();
    expect(screen.queryByTestId('invite-send-code')).toBeNull();
  });

  it('asks to reopen the SMS link when there is no token', async () => {
    await open('/invite');
    expect(await screen.findByTestId('invite-no-token')).toBeOnTheScreen();
  });
});

describe('sign-in and dashboard', () => {
  it('rejects a wrong password with the generic message and validates the number', async () => {
    await open('/login');
    await fireEvent.changeText(await screen.findByTestId('login-phone'), '12345');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Enter a valid 10-digit mobile number.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('login-phone'), '9811122233');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'wrong-password-1');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent(/not correct/);
  });

  it('shows the dashboard from the mock-up: greeting, child card, four tiles, next check-up', async () => {
    await signIn();
    expect(screen.getByText('Namaste!')).toBeOnTheScreen();
    expect(await screen.findByTestId('child-name')).toHaveTextContent('Aarav Kumar');
    expect(screen.getByText('Age 4 years 2 months')).toBeOnTheScreen();
    for (const id of ['tile-care-plan', 'tile-videos', 'tile-follow-ups', 'tile-assistance']) {
      expect(screen.getByTestId(id)).toBeOnTheScreen();
    }
    expect(screen.getByTestId('next-check-up')).toHaveTextContent(/15 December 2026/);
    // Refresh token kept in device storage; the access token is not.
    expect(ctx.store.data.get(REFRESH_TOKEN_KEY)).toBe(ctx.backend.state.refreshToken);
    expect([...ctx.store.data.values()]).not.toContain(ctx.backend.state.accessToken);
  });

  it('lets a parent with several children choose one', async () => {
    ctx.backend.state.children = [
      child(),
      child({
        childId: '00000000-0000-4000-8000-0000000000c2',
        fullName: 'Anaya Kumari',
        ageYears: 2,
        ageMonths: 5,
        nextCheckUp: null,
      }),
    ];
    await signIn();
    await screen.findByTestId('child-name');
    await fireEvent.press(screen.getByTestId('home-change-child'));
    await fireEvent.press(await screen.findByTestId('select-child-00000000-0000-4000-8000-0000000000c2'));
    await waitFor(() => expect(screen.getByTestId('child-name')).toHaveTextContent('Anaya Kumari'));
    expect(screen.getByTestId('next-check-up')).toHaveTextContent(/No check-up is scheduled/);
  });

  it('assistance shows the worker name and centre - never a phone number', async () => {
    await signIn();
    await fireEvent.press(await screen.findByTestId('tile-assistance'));
    expect(await screen.findByTestId('assist-worker')).toHaveTextContent('Synthetic ASHA Sunita');
    expect(screen.queryByText(/\d{10}/)).toBeNull();
  });

  it('follow-up dates list the selected child’s upcoming check-ups', async () => {
    await signIn();
    await fireEvent.press(await screen.findByTestId('tile-follow-ups'));
    expect(await screen.findByTestId('check-ups')).toHaveTextContent(/15 December 2026/);
  });

  it('a parent without shared children sees a helpful message', async () => {
    ctx.backend.state.children = [];
    await signIn();
    expect(await screen.findByTestId('home-no-children')).toBeOnTheScreen();
  });
});

describe('sessions', () => {
  it('restores a saved session without asking for the password', async () => {
    await ctx.store.set(REFRESH_TOKEN_KEY, ctx.backend.state.refreshToken);
    await open('/');
    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
  });

  it('refreshes once and retries when the access token has expired', async () => {
    await signIn();
    await screen.findByTestId('child-name');
    ctx.backend.state.expireAccessOnce = true;
    await act(async () => {
      await mockServices.queryClient.invalidateQueries();
    });
    await waitFor(() =>
      expect(ctx.backend.state.calls.filter((c) => c.path === '/parent/auth/refresh')).toHaveLength(1),
    );
    expect(screen.getByTestId('child-name')).toHaveTextContent('Aarav Kumar');
  });

  it('sign out ends the server session and forgets the device token', async () => {
    await signIn();
    await fireEvent.press(screen.getByTestId('home-settings'));
    await fireEvent.press(await screen.findByTestId('settings-sign-out'));
    await screen.findByTestId('login-screen');
    expect(ctx.backend.state.calls.some((c) => c.path === '/parent/auth/logout')).toBe(true);
    expect(ctx.store.data.has(REFRESH_TOKEN_KEY)).toBe(false);
  });

  it('portal screens are not reachable without a session', async () => {
    await open('/home');
    expect(screen.queryByTestId('home-screen')).toBeNull();
    expect(screen.queryByText('Aarav Kumar')).toBeNull();
  });

  it('forgot password shows the same message whatever the number', async () => {
    await open('/forgot-password');
    await fireEvent.changeText(await screen.findByTestId('forgot-phone'), '9876543210');
    await fireEvent.press(screen.getByTestId('forgot-send'));
    expect(await screen.findByTestId('forgot-sent')).toHaveTextContent(
      /If an account exists for this number/,
    );
  });
});

describe('language', () => {
  it('starts in Hindi and switches to English', async () => {
    ctx.store.data.delete('bs.parent.language');
    await open('/login');
    expect(await screen.findByText('साइन इन')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('language-toggle'));
    expect((await screen.findAllByText('Sign in')).length).toBeGreaterThan(0);
    void PHONE;
  });
});
