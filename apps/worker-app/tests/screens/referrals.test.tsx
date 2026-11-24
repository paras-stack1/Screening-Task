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

/** Step 7F: referral and follow-up screens. Synthetic data only. */
const WORKER = {
  permissions: [
    'child.read',
    'child.create',
    'child.update',
    'consent.record',
    'screening.conduct',
    'referral.create',
    'follow_up.update',
  ],
};
const MEDICAL_OFFICER = {
  permissions: [...WORKER.permissions, 'screening.review', 'referral.update', 'referral.approve'],
};

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

const fake = () => context.backend.referrals;
const posts = (suffix: string) => fake().requests.filter((r) => r.path.endsWith(suffix));

async function setup(as: { permissions: string[] }) {
  const { child } = context.backend.children.seedChild({ fullName: 'Synthetic Referral Child' });
  const facility = fake().seedFacility({
    name: 'Synthetic PHC',
    address: 'Synthetic road 1',
    contactPhone: '0000000000',
  });
  fake().seedFacility({
    name: 'Synthetic Unverified CHC',
    type: 'CHC',
    verificationStatus: 'UNVERIFIED',
    acceptsReferrals: false,
    selectable: false,
  });
  const me = await seedSavedSession(context, as);
  return { child, facility, me };
}

describe('dashboard and list', () => {
  it('home shows real referral and follow-up counts and opens referrals and follow-ups', async () => {
    const { child, me } = await setup(WORKER);
    fake().seedReferral({ childId: child.id, createdById: me.user.id });
    fake().seedFollowUp({
      childId: child.id,
      reasonCode: 'REFERRAL_NOT_COMPLETED',
      dueDate: '2026-12-01',
      assignee: { id: me.user.id, name: 'Sunita Devi' },
    });
    const app = await renderApp('/');
    await waitFor(() =>
      expect(within(screen.getByTestId('metric-pending-referrals')).getByText('1')).toBeOnTheScreen(),
    );
    expect(within(screen.getByTestId('metric-pending-follow-ups')).getByText('1')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Referrals' }));
    expect(app.getPathname()).toBe('/referrals');
    expect(await screen.findByText('Synthetic Referral Child')).toBeOnTheScreen();
    expect(within(screen.getByTestId('referrals-metric-total')).getByText('1')).toBeOnTheScreen();
  });

  it('a worker without follow-up rights sees the follow-up card as not available for the role', async () => {
    await setup({ permissions: ['child.read', 'referral.create'] });
    await renderApp('/');
    expect(
      await screen.findByRole('button', { name: 'Manage follow-ups. Not available for your role' }),
    ).toBeDisabled();
  });
});

describe('creating a referral', () => {
  it('from a screening result: recommended reason preselected, facility details, emergency notice; server decides the rest', async () => {
    const { child, facility } = await setup(WORKER);
    const session = context.backend.screening.seedSession(child.id, 'other-worker', 'Other Worker');
    context.backend.screening.finishCategory(session.id, 'DISEASES', 'Synthetic note');
    context.backend.screening.complete(session.id);
    context.backend.results.seedResult({
      sessionId: session.id,
      childId: child.id,
      childName: child.fullName,
      outcomes: { DISEASES: 'URGENT_EVALUATION_RECOMMENDED' },
    });
    const app = await renderApp(`/screening/${session.id}/result`);
    await fireEvent.press(await screen.findByTestId('result-refer-DISEASES'));
    expect(await screen.findByTestId('referral-emergency')).toBeOnTheScreen();
    expect(screen.getByTestId('referral-new-category')).toHaveTextContent(/Diseases/);
    await fireEvent.press(screen.getByTestId('referral-new-save'));
    expect(await screen.findByText('Choose the reason and the priority.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('referral-new-priority-PRIORITY'));
    await fireEvent.press(await screen.findByTestId(`facility-choice-${facility.id}`));
    expect(screen.getByTestId('facility-details')).toHaveTextContent(/Synthetic road 1/);
    expect(screen.getByText('1 facility(ies) not verified or not accepting referrals')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('referral-new-save'));
    await waitFor(() => expect(app.getPathname()).toMatch(/^\/referrals\/[0-9a-f-]+$/));
    const body = posts('/referrals')[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      childId: child.id,
      sessionId: session.id,
      category: 'DISEASES',
      reasonCode: 'RULE_RECOMMENDATION',
      suggestedPriority: 'PRIORITY',
      facilityId: facility.id,
    });
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['status']));
    expect(JSON.stringify(body)).not.toMatch(/createdBy|approvedBy|status/);
    expect((await screen.findAllByText('Waiting for approval')).length).toBeGreaterThan(0);
  });

  it('a second active referral is refused and the existing one can be opened', async () => {
    const { child, me } = await setup(WORKER);
    const existing = fake().seedReferral({ childId: child.id, createdById: me.user.id });
    const app = await renderApp(`/referrals/new?childId=${child.id}`);
    await fireEvent.press(await screen.findByTestId('referral-new-reason-WORKER_OBSERVED_CONCERN'));
    await fireEvent.press(screen.getByTestId('referral-new-priority-ROUTINE'));
    await fireEvent.press(screen.getByTestId('referral-new-save'));
    expect(await screen.findByTestId('referral-new-error')).toHaveTextContent(/already has an open referral/);
    await fireEvent.press(screen.getByTestId('referral-new-open-existing'));
    await waitFor(() => expect(app.getPathname()).toBe(`/referrals/${existing.id}`));
  });
});

describe('approval, issue, tracking', () => {
  it('a medical officer approves; issue needs referral-sharing consent', async () => {
    const { child, facility } = await setup(MEDICAL_OFFICER);
    const r = fake().seedReferral({ childId: child.id, createdById: 'other-worker', facility });
    await renderApp(`/referrals/${r.id}`);
    await fireEvent.press(await screen.findByTestId('referral-approve-priority-URGENT'));
    await fireEvent.press(screen.getByTestId('referral-approve'));
    await waitFor(() => expect(fake().referrals.get(r.id)!.status).toBe('APPROVED'));
    await fireEvent.press(await screen.findByTestId('referral-issue'));
    expect(await screen.findByTestId('referral-error')).toHaveTextContent(/not given consent to share/);
    fake().grantSharingConsent(child.id);
    await fireEvent.press(screen.getByTestId('referral-issue'));
    await waitFor(() => expect(fake().referrals.get(r.id)!.status).toBe('ISSUED'));
    expect(fake().referrals.get(r.id)!.priority).toBe('URGENT');
  });

  it('a field worker cannot approve or record facility updates', async () => {
    const { child, me } = await setup(WORKER);
    const r = fake().seedReferral({ childId: child.id, createdById: me.user.id });
    await renderApp(`/referrals/${r.id}`);
    expect(await screen.findByTestId('referral-cancel')).toBeOnTheScreen();
    expect(screen.queryByTestId('referral-approve-form')).toBeNull();
    expect(screen.queryByTestId('referral-tracking')).toBeNull();
  });

  it('records a family report as not verified, and undoes a mistaken update with a reason', async () => {
    const { child } = await setup(MEDICAL_OFFICER);
    const r = fake().seedReferral({ childId: child.id, createdById: 'other-worker', status: 'ISSUED' });
    await renderApp(`/referrals/${r.id}`);
    await fireEvent.press(await screen.findByTestId('referral-tracking-status-VISITED'));
    await fireEvent.press(screen.getByTestId('referral-tracking-source-GUARDIAN_REPORTED'));
    await fireEvent.press(screen.getByTestId('referral-tracking-save'));
    expect(await screen.findByText('Reported by the family · not verified')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByTestId('referral-correct'));
    await fireEvent.press(screen.getByTestId('referral-correct-confirm'));
    expect(await screen.findByText('Write a short reason.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('referral-correct-reason'), 'Synthetic: wrong child');
    await fireEvent.press(screen.getByTestId('referral-correct-confirm'));
    await waitFor(() => expect(fake().referrals.get(r.id)!.status).toBe('ISSUED'));
    expect(await screen.findByText('Correction of the previous update')).toBeOnTheScreen();
  });

  it('closing is refused while a follow-up is open', async () => {
    const { child } = await setup(MEDICAL_OFFICER);
    const r = fake().seedReferral({ childId: child.id, createdById: 'other-worker', status: 'VISITED' });
    fake().seedFollowUp({
      childId: child.id,
      referralId: r.id,
      reasonCode: 'FACILITY_REQUESTED_VISIT',
      dueDate: '2026-12-01',
      assignee: null,
    });
    await renderApp(`/referrals/${r.id}`);
    await fireEvent.press(await screen.findByTestId('referral-close'));
    await fireEvent.changeText(screen.getByTestId('referral-close-reason'), 'Synthetic: care completed');
    await fireEvent.press(screen.getByTestId('referral-close-confirm'));
    expect(await screen.findByTestId('referral-error')).toBeOnTheScreen();
    expect(fake().referrals.get(r.id)!.status).toBe('VISITED');
  });
});

describe('follow-ups', () => {
  it('a worker completes their own task with an outcome; the referral is not changed', async () => {
    const { child, me } = await setup(WORKER);
    const r = fake().seedReferral({ childId: child.id, createdById: me.user.id, status: 'VISITED' });
    const f = fake().seedFollowUp({
      childId: child.id,
      referralId: r.id,
      reasonCode: 'FACILITY_REQUESTED_VISIT',
      dueDate: '2026-12-01',
      assignee: { id: me.user.id, name: 'Sunita Devi' },
    });
    const app = await renderApp('/referrals/follow-ups');
    await fireEvent.press(await screen.findByTestId(`follow-up-item-${f.id}`));
    expect(app.getPathname()).toBe(`/referrals/follow-ups/${f.id}`);
    await fireEvent.press(await screen.findByTestId('follow-up-start'));
    // Wait for the reloaded task (new version) before the next action.
    expect((await screen.findAllByText('In progress')).length).toBeGreaterThan(0);
    await fireEvent.press(await screen.findByTestId('follow-up-complete'));
    expect(screen.getByText('Completing this does not close the referral.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('follow-up-complete-confirm'));
    expect(await screen.findByText('Write what happened.')).toBeOnTheScreen();
    await fireEvent.changeText(
      screen.getByTestId('follow-up-outcome-input'),
      'Synthetic: child seen at facility',
    );
    await fireEvent.press(screen.getByTestId('follow-up-complete-confirm'));
    expect(await screen.findByTestId('follow-up-outcome')).toHaveTextContent(/child seen at facility/);
    expect(fake().referrals.get(r.id)!.status).toBe('VISITED');
    expect(screen.queryByTestId('follow-up-cancel')).toBeNull();
  });

  it('rescheduling needs a date and a reason', async () => {
    const { child, me } = await setup(WORKER);
    const f = fake().seedFollowUp({
      childId: child.id,
      reasonCode: 'ADDITIONAL_SCREENING',
      dueDate: '2026-12-01',
      assignee: { id: me.user.id, name: 'Sunita Devi' },
    });
    await renderApp(`/referrals/follow-ups/${f.id}`);
    await fireEvent.press(await screen.findByTestId('follow-up-reschedule'));
    await fireEvent.changeText(screen.getByTestId('follow-up-reschedule-date'), '2026-12-10');
    await fireEvent.press(screen.getByTestId('follow-up-reschedule-confirm'));
    expect(await screen.findByText('Enter the new date (YYYY-MM-DD) and a reason.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('follow-up-reschedule-reason'), 'Synthetic: family away');
    await fireEvent.press(screen.getByTestId('follow-up-reschedule-confirm'));
    await waitFor(() => expect(fake().followUps.get(f.id)!.dueDate).toBe('2026-12-10'));
  });
});

describe('notifications and language', () => {
  it('a referral notification opens the referral', async () => {
    const { child, me } = await setup(WORKER);
    const r = fake().seedReferral({ childId: child.id, createdById: me.user.id });
    const n = context.backend.results.seedNotification(me.user.id, {
      type: 'REFERRAL_APPROVED',
      entityType: 'referral',
      entityId: r.id,
    });
    const app = await renderApp('/notifications');
    await fireEvent.press(await screen.findByTestId(`notification-${n.id}`));
    await waitFor(() => expect(app.getPathname()).toBe(`/referrals/${r.id}`));
  });

  it('renders a referral in Hindi', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    const { child, me } = await setup(WORKER);
    const r = fake().seedReferral({ childId: child.id, createdById: me.user.id });
    await renderApp(`/referrals/${r.id}`);
    expect((await screen.findAllByText('स्वीकृति की प्रतीक्षा')).length).toBeGreaterThan(0);
    expect(screen.getByText('रेफ़रल रद्द करें')).toBeOnTheScreen();
  });
});
