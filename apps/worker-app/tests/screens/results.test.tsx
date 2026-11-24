import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
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

/** Step 7E: screening results, clinical review and notifications screens. Synthetic data only. */
const WORKER = {
  permissions: [
    'child.read',
    'child.create',
    'child.update',
    'consent.record',
    'screening.conduct',
    'referral.create',
  ],
};
const MEDICAL_OFFICER = {
  permissions: [...WORKER.permissions, 'screening.review', 'referral.update', 'referral.approve'],
};
/** Wording the app must never use for a screening result. */
const FORBIDDEN = /diagnosed|definitely has|completely healthy|is healthy|AI diagnosed|normal child/i;

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

const results = () => context.backend.results;

async function completedWithResult(
  as: { permissions: string[] },
  options: { urgent?: boolean; withReview?: boolean; result?: boolean } = {},
) {
  const { child, guardian } = context.backend.children.seedChild({ fullName: 'Synthetic Result Child' });
  context.backend.children.seedConsent(child.id, guardian.id, 'SCREENING', 'GRANTED');
  const me = await seedSavedSession(context, as);
  const session = context.backend.screening.seedSession(child.id, 'other-worker', 'Other Worker');
  context.backend.screening.finishCategory(session.id, 'DISEASES', 'Synthetic note');
  context.backend.screening.complete(session.id);
  const seeded =
    options.result === false
      ? null
      : results().seedResult({
          sessionId: session.id,
          childId: child.id,
          childName: child.fullName,
          outcomes: { DISEASES: options.urgent ? 'URGENT_EVALUATION_RECOMMENDED' : 'NOT_INTERPRETED' },
          withReview: options.withReview ? { conductedById: 'other-worker' } : undefined,
        });
  return { child, session, me, seeded };
}

describe('screening result', () => {
  it('opens from the summary and keeps observation, interpretation, review and diagnosis apart', async () => {
    const { session } = await completedWithResult(WORKER, { urgent: true, withReview: true });
    const app = await renderApp(`/screening/${session.id}/summary`);
    await fireEvent.press(await screen.findByTestId('summary-result'));
    expect(app.getPathname()).toBe(`/screening/${session.id}/result`);
    expect(await screen.findByTestId('result-not-diagnosis')).toBeOnTheScreen();
    expect(screen.getByTestId('result-unapproved')).toBeOnTheScreen();
    expect(screen.getAllByText('Urgent check recommended').length).toBeGreaterThan(0);
    expect(screen.getByText('Waiting for doctor review')).toBeOnTheScreen();
    expect(screen.getByText('This app does not record a diagnosis.')).toBeOnTheScreen();
    expect(screen.getByTestId('result-referral-DISEASES')).toHaveTextContent(/Suggested priority: Urgent/);
    expect(screen.getByTestId('result-category-DEFECTS_AT_BIRTH')).toHaveTextContent(/Not checked/);
    expect(screen.toJSON()).not.toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(FORBIDDEN);
  });

  it('explains when no result exists yet (never shows a reassuring outcome)', async () => {
    const { session } = await completedWithResult(WORKER, { result: false });
    await renderApp(`/screening/${session.id}/result`);
    expect(await screen.findByText('No result yet')).toBeOnTheScreen();
    expect(screen.queryByText(/No concern/)).toBeNull();
  });

  it('shows earlier versions after an amendment', async () => {
    const { session, child } = await completedWithResult(WORKER);
    results().seedResult({
      sessionId: session.id,
      childId: child.id,
      childName: child.fullName,
      outcomes: { DISEASES: 'INCOMPLETE' },
    });
    await renderApp(`/screening/${session.id}/result`);
    expect(await screen.findByTestId('result-history')).toHaveTextContent(/Version 2 .*current/);
    expect(screen.getByTestId('result-history')).toHaveTextContent(/Version 1/);
  });

  it('results list: real counts from the API and an outcome filter', async () => {
    await completedWithResult(WORKER, { urgent: true });
    await renderApp('/screening/results');
    expect(await screen.findByTestId('results-metric-urgent')).toHaveTextContent(/1/);
    expect(screen.getByText('Synthetic Result Child')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('results-filter-NOT_INTERPRETED'));
    await waitFor(() =>
      expect(
        context.backend.calls.some(
          (c) => c.path.includes('/screening-results?') && c.path.includes('outcome=NOT_INTERPRETED'),
        ),
      ).toBe(true),
    );
    expect(await screen.findByTestId('results-empty')).toBeOnTheScreen();
  });
});

describe('clinical review', () => {
  it('is offered to medical officers only (no button for a field worker)', async () => {
    await completedWithResult(WORKER);
    await renderApp('/screening');
    expect(await screen.findByTestId('screening-results')).toBeOnTheScreen();
    expect(screen.queryByTestId('screening-clinical-reviews')).toBeNull();
  });

  it('a field worker opening the review address directly gets "not your role"', async () => {
    await completedWithResult(WORKER);
    const app = await renderApp('/screening/reviews');
    expect(app.getPathname()).toBe('/screening/reviews');
    expect(await screen.findByText(/not part of your role/i)).toBeOnTheScreen();
  });

  it('claim, then a decision with notes; the reviewer is never sent by the app', async () => {
    const { seeded } = await completedWithResult(MEDICAL_OFFICER, { urgent: true, withReview: true });
    const app = await renderApp('/screening');
    await fireEvent.press(await screen.findByTestId('screening-clinical-reviews'));
    await fireEvent.press(await screen.findByTestId(`clinical-review-item-${seeded!.reviewId}`));
    expect(app.getPathname()).toBe(`/screening/reviews/${seeded!.reviewId}`);
    await fireEvent.press(await screen.findByTestId('clinical-review-claim'));
    expect(await screen.findByTestId('clinical-review-form')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('clinical-review-decision-REJECT_WITH_REASON'));
    await fireEvent.press(screen.getByTestId('clinical-review-save'));
    expect(await screen.findByText('Write notes for this decision.')).toBeOnTheScreen();
    await fireEvent.changeText(
      screen.getByTestId('clinical-review-notes'),
      'Synthetic: answers look inconsistent',
    );
    await fireEvent.press(screen.getByTestId('clinical-review-save'));
    await waitFor(() =>
      expect(screen.getByTestId('clinical-review-status')).toHaveTextContent(/Automatic result not accepted/),
    );
    const body = results().decisions.at(-1) as Record<string, unknown>;
    expect(body).toEqual({
      expectedVersion: 2,
      decision: 'REJECT_WITH_REASON',
      notes: 'Synthetic: answers look inconsistent',
    });
    expect(JSON.stringify(body)).not.toMatch(/reviewer|userId|decidedBy/);
  });

  it('a referral recommendation shows the emergency notice and needs area and priority', async () => {
    const { seeded } = await completedWithResult(MEDICAL_OFFICER, { urgent: true, withReview: true });
    await renderApp(`/screening/reviews/${seeded!.reviewId}`);
    await fireEvent.press(await screen.findByTestId('clinical-review-claim'));
    await fireEvent.press(await screen.findByTestId('clinical-review-decision-RECOMMEND_REFERRAL'));
    expect(screen.getByTestId('clinical-review-emergency')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('clinical-review-notes'), 'Synthetic recommendation');
    await fireEvent.press(screen.getByTestId('clinical-review-save'));
    expect(await screen.findByText('Choose the referral area and priority.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('clinical-review-category-DISEASES'));
    await fireEvent.press(screen.getByTestId('clinical-review-priority-PRIORITY'));
    await fireEvent.press(screen.getByTestId('clinical-review-save'));
    await waitFor(() => expect(results().decisions).toHaveLength(1));
    expect(results().decisions[0]).toMatchObject({
      referral: { category: 'DISEASES', priority: 'PRIORITY' },
    });
  });

  it('when another doctor took the review first, the app says so and reloads', async () => {
    const { seeded } = await completedWithResult(MEDICAL_OFFICER, { withReview: true });
    await renderApp(`/screening/reviews/${seeded!.reviewId}`);
    const claim = await screen.findByTestId('clinical-review-claim');
    results().claimAs(seeded!.reviewId!, { id: 'other-mo', name: 'Other Doctor' });
    await fireEvent.press(claim);
    expect(await screen.findByTestId('clinical-review-error')).toBeOnTheScreen();
    expect(await screen.findByText(/Other Doctor is reviewing this/)).toBeOnTheScreen();
  });
});

describe('notifications', () => {
  it('shows generic text only, counts unread, marks read and opens the review', async () => {
    const { seeded, me } = await completedWithResult(MEDICAL_OFFICER, { withReview: true });
    const n = results().seedNotification(me.user.id, {
      type: 'REVIEW_TASK_NEW',
      entityType: 'clinicalReview',
      entityId: seeded!.reviewId!,
    });
    results().seedNotification('someone-else', { type: 'SYSTEM', entityType: 'system', entityId: 'x' });
    const app = await renderApp('/notifications');
    expect(await screen.findByText('A screening result is waiting for review')).toBeOnTheScreen();
    expect(screen.getByTestId('notifications-unread')).toHaveTextContent('Unread: 1');
    expect(screen.queryByText('Synthetic Result Child')).toBeNull();
    expect(screen.queryByText('System message')).toBeNull();
    await fireEvent.press(screen.getByTestId(`notification-${n.id}`));
    await waitFor(() => expect(app.getPathname()).toBe(`/screening/reviews/${seeded!.reviewId}`));
    await waitFor(() => expect(results().notifications.find((x) => x.id === n.id)?.readAt).not.toBeNull());
  });

  it('renders the result screen in Hindi', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    const { session } = await completedWithResult(WORKER, { urgent: true });
    await renderApp(`/screening/${session.id}/result`);
    expect(await screen.findByText('यह ऐप निदान दर्ज नहीं करता।')).toBeOnTheScreen();
    expect(screen.getAllByText('तुरंत जाँच की सलाह').length).toBeGreaterThan(0);
  });
});
