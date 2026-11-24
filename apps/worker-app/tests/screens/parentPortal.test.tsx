import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import type { AppServices } from '../../src/services/appServices';
import { network } from '../support/mockNetwork';
import { renderApp } from '../support/renderApp';
import { createTestContext, seedSavedSession, type TestContext } from '../support/testServices';

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

/** Step 8 Parent Portal, stage 3: the worker-side invitation card on the guardian page. */
const INVITER = { permissions: ['child.read', 'child.update', 'guardian.invite'] };
const READER = { permissions: ['child.read'] };

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

function seed(phone: string | null = '+919822223333') {
  return context.backend.children.seedChild(
    { fullName: 'Synthetic Portal Child' },
    { fullName: 'Synthetic Portal Mother', ...(phone && { phone }) },
  );
}

const invitationPosts = () =>
  context.backend.calls.filter((c) => c.method === 'POST' && c.path.includes('/invitations'));

describe('Parent Portal invitation card', () => {
  it('requires a chosen child and the guardian agreement, then sends and shows the masked number', async () => {
    const { child, guardian } = seed();
    await seedSavedSession(context, INVITER);
    await renderApp(`/children/guardian/${guardian.id}`);
    expect(await screen.findByText('Not invited')).toBeOnTheScreen();
    expect(screen.getByTestId('parent-portal-phone')).toHaveTextContent(/3333$/);
    // Masked inside the card (the full number is only in the guardian details above it).
    expect(within(screen.getByTestId('parent-portal-card')).queryByText(/9822223333/)).toBeNull();

    await fireEvent.press(screen.getByTestId('parent-portal-invite'));
    await fireEvent.press(screen.getByTestId('parent-portal-send'));
    expect(await screen.findByText('Choose at least one child.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`parent-portal-child-${child.id}`));
    await fireEvent.press(screen.getByTestId('parent-portal-send'));
    expect(
      await screen.findByText('Confirm that the guardian agreed to receive the invitation.'),
    ).toBeOnTheScreen();
    expect(invitationPosts()).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('parent-portal-agreed'));
    await fireEvent.press(screen.getByTestId('parent-portal-send'));
    expect(await screen.findByText('Invitation sent')).toBeOnTheScreen();
    expect(invitationPosts()).toHaveLength(1);
    expect(invitationPosts()[0]!.body).toEqual({ guardianAgreed: true, childIds: [child.id] });
    expect(screen.getByText(/shared after activation/)).toBeOnTheScreen();
    expect(screen.getByTestId('parent-portal-latest')).toHaveTextContent(/Valid until/);
  });

  it('says plainly when no SMS provider is set up (never "sent")', async () => {
    const { child, guardian } = seed();
    context.backend.children.portal.smsConfigured = false;
    await seedSavedSession(context, INVITER);
    await renderApp(`/children/guardian/${guardian.id}`);
    await fireEvent.press(await screen.findByTestId('parent-portal-invite'));
    await fireEvent.press(screen.getByTestId(`parent-portal-child-${child.id}`));
    await fireEvent.press(screen.getByTestId('parent-portal-agreed'));
    await fireEvent.press(screen.getByTestId('parent-portal-send'));
    expect(await screen.findByText('Invitation created, SMS not sent')).toBeOnTheScreen();
    expect(screen.getByTestId('parent-portal-sms-off')).toBeOnTheScreen();
    expect(screen.queryByText('Invitation sent')).toBeNull();
  });

  it('cancels an open invitation with a reason', async () => {
    const { child, guardian } = seed();
    await seedSavedSession(context, INVITER);
    await renderApp(`/children/guardian/${guardian.id}`);
    await fireEvent.press(await screen.findByTestId('parent-portal-invite'));
    await fireEvent.press(screen.getByTestId(`parent-portal-child-${child.id}`));
    await fireEvent.press(screen.getByTestId('parent-portal-agreed'));
    await fireEvent.press(screen.getByTestId('parent-portal-send'));
    await fireEvent.press(await screen.findByTestId('parent-portal-revoke'));
    await fireEvent.press(screen.getByTestId('parent-portal-revoke-confirm'));
    expect(await screen.findByText('Enter a reason (at least 3 characters).')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('parent-portal-revoke-reason'), 'Wrong number');
    await fireEvent.press(screen.getByTestId('parent-portal-revoke-confirm'));
    expect(await screen.findByText('Invitation cancelled')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByTestId('parent-portal-revoke')).toBeNull());
  });

  it('shows the status but no invite action without guardian.invite', async () => {
    const { guardian } = seed();
    await seedSavedSession(context, READER);
    await renderApp(`/children/guardian/${guardian.id}`);
    expect(await screen.findByText('Not invited')).toBeOnTheScreen();
    expect(screen.queryByTestId('parent-portal-invite')).toBeNull();
  });

  it('asks for a mobile number first when none is recorded', async () => {
    const { guardian } = seed(null);
    await seedSavedSession(context, INVITER);
    await renderApp(`/children/guardian/${guardian.id}`);
    expect(await screen.findByText('Record the guardian mobile number before inviting.')).toBeOnTheScreen();
    expect(screen.queryByTestId('parent-portal-invite')).toBeNull();
  });

  it('after activation: stops sharing a child with a reason, then shares it again', async () => {
    const { child, guardian } = seed();
    context.backend.children.portal.activated.add(guardian.id);
    context.backend.children.portalAccess.set(guardian.id, new Map([[child.id, 'ACTIVE' as const]]));
    await seedSavedSession(context, INVITER);
    await renderApp(`/children/guardian/${guardian.id}`);
    expect(await screen.findByText('Account activated')).toBeOnTheScreen();
    expect(screen.queryByTestId('parent-portal-invite')).toBeNull();

    await fireEvent.press(screen.getByTestId(`parent-portal-stop-${child.id}`));
    await fireEvent.press(screen.getByTestId('parent-portal-stop-confirm'));
    expect(await screen.findByText('Enter a reason (at least 3 characters).')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('parent-portal-stop-reason'), 'Guardian asked to stop');
    await fireEvent.press(screen.getByTestId('parent-portal-stop-confirm'));
    expect(await screen.findByText(/not shared \(cancelled\)/)).toBeOnTheScreen();
    expect(context.backend.children.portalAccess.get(guardian.id)!.get(child.id)).toBe('REVOKED');

    await fireEvent.press(screen.getByTestId(`parent-portal-share-${child.id}`));
    await waitFor(() =>
      expect(context.backend.children.portalAccess.get(guardian.id)!.get(child.id)).toBe('ACTIVE'),
    );
    expect(await screen.findByTestId(`parent-portal-stop-${child.id}`)).toBeOnTheScreen();
  });
});
