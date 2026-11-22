import { fireEvent, screen, within } from 'expo-router/testing-library';
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

/** Step 5E: consent overview, capture, history and withdrawal screens; dashboard recent list. */
const FIELD_WORKER = { permissions: ['child.read', 'child.create', 'child.update', 'consent.record'] };

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

const store = () => context.backend.children;
const consentPosts = () =>
  context.backend.calls.filter((c) => c.method === 'POST' && /\/consents$/.test(c.path));

function seedFamily(fullName = 'Synthetic Consent Child') {
  const seeded = store().seedChild({ fullName });
  // A second guardian WITHOUT consent authority.
  const grandparent = { id: '' };
  return { ...seeded, grandparent };
}

async function openCapture(childId: string) {
  await renderApp(`/children/${childId}/consent/record`);
  await screen.findByTestId('consent-form');
}

async function fillDecision(guardianId: string, purpose = 'PHOTO_CAPTURE') {
  await fireEvent.press(screen.getByTestId(`consent-guardian-${guardianId}`));
  await fireEvent.press(screen.getByTestId(`consent-purpose-${purpose}`));
  await screen.findByTestId('consent-notice');
  await fireEvent.press(screen.getByTestId('consent-explained'));
  await fireEvent.press(screen.getByTestId('consent-decision-GRANTED'));
  await fireEvent.press(screen.getByTestId('consent-method-SIGNATURE'));
}

// ======================================================================= overview

describe('consent overview on the child profile', () => {
  it("shows the API's status per purpose; missing consent is never shown as agreed", async () => {
    const { child, guardian } = seedFamily();
    store().seedConsent(child.id, guardian.id, 'SCREENING', 'GRANTED');
    store().seedConsent(child.id, guardian.id, 'PHOTO_CAPTURE', 'REFUSED');
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}`);
    const screening = await screen.findByTestId('consent-status-SCREENING');
    expect(within(screening).getByText('Agreed')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('consent-status-PHOTO_CAPTURE')).getByText('Did not agree'),
    ).toBeOnTheScreen();
    for (const purpose of [
      'VIDEO_CAPTURE',
      'AUDIO_CAPTURE',
      'AI_PROCESSING',
      'REFERRAL_DATA_SHARING',
      'SMS_REMINDERS',
    ]) {
      expect(
        within(screen.getByTestId(`consent-status-${purpose}`)).getByText('Not recorded'),
      ).toBeOnTheScreen();
    }
    expect(within(screen.getByTestId('consent-overview')).getAllByText('Agreed')).toHaveLength(1);
  });

  it('warns when consent was withdrawn', async () => {
    const { child, guardian } = seedFamily();
    const grant = store().seedConsent(child.id, guardian.id, 'PHOTO_CAPTURE', 'GRANTED');
    grant.withdrawnAt = '2026-11-21T10:00:00.000Z';
    grant.withdrawalMethod = 'SIGNATURE';
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}`);
    expect(await screen.findByTestId('consent-attention')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('consent-status-PHOTO_CAPTURE')).getByText('Withdrawn'),
    ).toBeOnTheScreen();
  });

  it('a role without consent.record can view but not record', async () => {
    const { child } = seedFamily();
    await seedSavedSession(context, { permissions: ['child.read'] });
    await renderApp(`/children/${child.id}`);
    await screen.findByTestId('consent-overview');
    expect(screen.queryByTestId('consent-record')).toBeNull();
    expect(screen.getByTestId('consent-history')).toBeOnTheScreen();
  });
});

// ======================================================================= capture

describe('consent capture', () => {
  it('nothing is preselected and every answer is required', async () => {
    const { child, guardian } = seedFamily();
    await seedSavedSession(context, FIELD_WORKER);
    await openCapture(child.id);
    expect(screen.getByTestId(`consent-guardian-${guardian.id}`)).toHaveProp('accessibilityState', {
      checked: false,
      disabled: false,
    });
    expect(screen.getByTestId('consent-explained')).toHaveProp('accessibilityState', { checked: false });
    for (const value of ['GRANTED', 'REFUSED']) {
      expect(screen.getByTestId(`consent-decision-${value}`)).toHaveProp('accessibilityState', {
        checked: false,
        disabled: false,
      });
    }
    await fireEvent.press(screen.getByTestId('consent-save'));
    for (const message of [
      'Choose the guardian',
      'Choose the purpose',
      'Confirm that you explained the notice',
    ]) {
      expect(await screen.findByText(message)).toBeOnTheScreen();
    }
    expect(consentPosts()).toHaveLength(0);
  });

  it('records one decision for one purpose, bound to the notice shown, after confirmation', async () => {
    const { child, guardian } = seedFamily();
    await seedSavedSession(context, FIELD_WORKER);
    await openCapture(child.id);
    await fillDecision(guardian.id);
    expect(screen.getByTestId('consent-placeholder')).toBeOnTheScreen();
    expect(screen.getByText('Optional: saying no does not affect other services.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('consent-save'));
    expect(await screen.findByText('Synthetic Mother - Photographs: Agreed')).toBeOnTheScreen();
    expect(consentPosts()).toHaveLength(0); // nothing sent before confirmation
    await fireEvent.press(screen.getByTestId('confirm-dialog-confirm'));
    const recorded = await screen.findByTestId('consent-recorded');
    expect(within(recorded).getAllByText('Agreed').length).toBeGreaterThan(0);

    const [call] = consentPosts();
    const noticeCalls = context.backend.calls.filter((c) => c.path.startsWith('/consent-notices'));
    expect(noticeCalls.map((c) => c.path)).toEqual(['/consent-notices?language=hi']); // guardian's language
    expect(call!.body).toMatchObject({
      guardianId: guardian.id,
      purpose: 'PHOTO_CAPTURE',
      decision: 'GRANTED',
      method: 'SIGNATURE',
    });
    expect((call!.body as Record<string, unknown>).templateId).toMatch(/^00000000-0000-4000-9000-/);
    for (const field of ['recordedAt', 'recordedById', 'verified', 'status']) {
      expect(call!.body).not.toHaveProperty(field);
    }
    expect(store().consents).toHaveLength(1);
  });

  it('only guardians marked as able to give consent are offered; none -> explained, no form', async () => {
    const { child, link } = seedFamily();
    link.canGiveConsent = false;
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}/consent/record`);
    expect(await screen.findByTestId('consent-no-guardian')).toBeOnTheScreen();
    expect(screen.queryByTestId('consent-save')).toBeNull();
  });

  it('a changed notice is refused; the worker must explain the new wording again', async () => {
    const { child, guardian } = seedFamily();
    await seedSavedSession(context, FIELD_WORKER);
    await openCapture(child.id);
    await fillDecision(guardian.id);
    store().bumpNoticeVersion('PHOTO_CAPTURE');
    await fireEvent.press(screen.getByTestId('consent-save'));
    await fireEvent.press(await screen.findByTestId('confirm-dialog-confirm'));
    expect(await screen.findByText(/The notice has changed/)).toBeOnTheScreen();
    expect(screen.getByTestId('consent-explained')).toHaveProp('accessibilityState', { checked: false });
    expect(store().consents).toHaveLength(0);

    expect(await screen.findByText(/PHOTO_CAPTURE v2/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('consent-explained'));
    await fireEvent.press(screen.getByTestId('consent-save'));
    await fireEvent.press(await screen.findByTestId('confirm-dialog-confirm'));
    expect(await screen.findByTestId('consent-recorded')).toBeOnTheScreen();
    expect(store().consents[0]!.noticeVersion).toBe(2);
  });

  it('a purpose without a notice cannot be recorded', async () => {
    const { child, guardian } = seedFamily();
    store().removeNotice('SMS_REMINDERS');
    await seedSavedSession(context, FIELD_WORKER);
    await openCapture(child.id);
    await fireEvent.press(screen.getByTestId(`consent-guardian-${guardian.id}`));
    await fireEvent.press(screen.getByTestId('consent-purpose-SMS_REMINDERS'));
    expect(await screen.findByTestId('consent-notice-missing')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('consent-explained'));
    await fireEvent.press(screen.getByTestId('consent-decision-GRANTED'));
    await fireEvent.press(screen.getByTestId('consent-method-SIGNATURE'));
    await fireEvent.press(screen.getByTestId('consent-save'));
    expect(screen.queryByTestId('confirm-dialog-confirm')).toBeNull();
    expect(consentPosts()).toHaveLength(0);
  });

  it('is shown in Hindi when Hindi is chosen', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    const { child } = seedFamily();
    await seedSavedSession(context, FIELD_WORKER);
    await openCapture(child.id);
    expect(screen.getByText('मैंने यह सूचना अभिभावक को पढ़कर समझाई है')).toBeOnTheScreen();
  });
});

// ======================================================================= history + withdrawal

describe('consent history and withdrawal', () => {
  it('history keeps every decision; withdrawal is offered only on the current grant', async () => {
    const { child, guardian } = seedFamily();
    const old = store().seedConsent(child.id, guardian.id, 'VIDEO_CAPTURE', 'GRANTED');
    const current = store().seedConsent(child.id, guardian.id, 'VIDEO_CAPTURE', 'GRANTED');
    const refused = store().seedConsent(child.id, guardian.id, 'AUDIO_CAPTURE', 'REFUSED');
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}/consent`);
    expect(await screen.findByTestId(`consent-record-${old.id}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`consent-withdraw-${current.id}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`consent-withdraw-${old.id}`)).toBeNull();
    expect(screen.queryByTestId(`consent-withdraw-${refused.id}`)).toBeNull();
    expect(screen.getAllByText('Recorded with placeholder (not approved) wording.').length).toBe(3);
  });

  it('withdrawal: explicit guardian and method, confirmation, history kept, other purposes unchanged', async () => {
    const { child, guardian } = seedFamily();
    const grant = store().seedConsent(child.id, guardian.id, 'PHOTO_CAPTURE', 'GRANTED');
    store().seedConsent(child.id, guardian.id, 'SCREENING', 'GRANTED');
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}/consent/withdraw/${grant.id}`);
    await fireEvent.press(await screen.findByTestId('withdraw-save'));
    expect(await screen.findByText('Choose the guardian')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId(`withdraw-guardian-${guardian.id}`));
    await fireEvent.press(screen.getByTestId('withdraw-method-VERBAL_WITNESSED'));
    await fireEvent.press(screen.getByTestId('withdraw-save'));
    expect(await screen.findByText('Withdraw consent for Photographs?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('confirm-dialog-confirm'));

    await screen.findByTestId('withdraw-form').catch(() => undefined);
    const call = context.backend.calls.find((c) => c.path.endsWith('/withdraw'));
    expect(call?.body).toEqual({ guardianId: guardian.id, method: 'VERBAL_WITNESSED' });
    const stored = store().consents.find((c) => c.id === grant.id)!;
    expect(stored.decision).toBe('GRANTED'); // original decision preserved
    expect(stored.withdrawalMethod).toBe('VERBAL_WITNESSED');
    expect(store().consents.find((c) => c.purpose === 'SCREENING')!.withdrawnAt).toBeNull();
  });

  it('a repeated withdrawal is explained, not hidden', async () => {
    const { child, guardian } = seedFamily();
    const grant = store().seedConsent(child.id, guardian.id, 'PHOTO_CAPTURE', 'GRANTED');
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}/consent/withdraw/${grant.id}`);
    await fireEvent.press(await screen.findByTestId(`withdraw-guardian-${guardian.id}`));
    await fireEvent.press(screen.getByTestId('withdraw-method-SIGNATURE'));
    grant.withdrawnAt = '2026-11-21T11:00:00.000Z'; // someone else withdrew meanwhile
    await fireEvent.press(screen.getByTestId('withdraw-save'));
    await fireEvent.press(await screen.findByTestId('confirm-dialog-confirm'));
    expect(await screen.findByText('This consent has already been withdrawn.')).toBeOnTheScreen();
  });
});

// ======================================================================= dashboard

describe('dashboard recently registered', () => {
  it('lists real recent children for roles with child.read', async () => {
    store().seedChild({ fullName: 'Synthetic Recent One' });
    store().seedChild({ fullName: 'Synthetic Recent Two' });
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp('/');
    const section = await screen.findByTestId('recent-children');
    expect(await within(section).findByText('Synthetic Recent One')).toBeOnTheScreen();
    expect(within(section).getByText('Synthetic Recent Two')).toBeOnTheScreen();
    expect(
      context.backend.calls.some((c) => c.path.includes('sort=-createdAt') && c.path.includes('pageSize=5')),
    ).toBe(true);
  });

  it('is absent for roles without child.read', async () => {
    await seedSavedSession(context, { permissions: ['report.aggregate'] });
    await renderApp('/');
    await screen.findByTestId('dashboard-screen');
    expect(screen.queryByTestId('recent-children')).toBeNull();
  });
});
