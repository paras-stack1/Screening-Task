import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import type { AppServices } from '../../src/services/appServices';
import { network } from '../support/mockNetwork';
import { holdNextResponse, renderApp } from '../support/renderApp';
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

/** Step 6E: review and complete, summary / details, cancellation, history. */
const WORKER = {
  permissions: ['child.read', 'child.create', 'child.update', 'consent.record', 'screening.conduct'],
};
/** Wording that must never appear: screening support, not diagnosis (brief section 16). */
const FORBIDDEN = /diagnosed|definitely has|completely healthy|is healthy|AI diagnosed|normal child/i;

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

const screening = () => context.backend.screening;
const calls = (suffix: string) =>
  context.backend.calls.filter((c) => c.method === 'POST' && c.path.endsWith(suffix));

async function seededSession(owner: 'me' | 'other' = 'me') {
  const { child, guardian } = context.backend.children.seedChild({ fullName: 'Synthetic Summary Child' });
  context.backend.children.seedConsent(child.id, guardian.id, 'SCREENING', 'GRANTED');
  const me = await seedSavedSession(context, WORKER);
  const session =
    owner === 'me'
      ? screening().seedSession(child.id, me.user.id, 'Sunita Devi')
      : screening().seedSession(child.id, 'other-worker', 'Other Worker');
  return { child, session };
}

describe('review and complete', () => {
  it('cannot complete until one area is finished (no request is sent)', async () => {
    const { session } = await seededSession();
    screening().startCategory(session.id, 'DISEASES');
    await renderApp(`/screening/${session.id}/review`);
    expect(await screen.findByTestId('review-none-finished')).toBeOnTheScreen();
    expect(screen.getByTestId('review-complete')).toBeDisabled();
    expect(calls('/complete')).toHaveLength(0);
  });

  it('completes once after confirmation and shows an observations-only summary', async () => {
    const { session } = await seededSession();
    screening().finishCategory(session.id, 'DEFECTS_AT_BIRTH', 'Synthetic worker note');
    screening().startCategory(session.id, 'DISEASES');
    const app = await renderApp(`/screening/${session.id}`);
    await fireEvent.press(await screen.findByTestId('session-review'));
    expect(await screen.findByTestId('review-incomplete')).toHaveTextContent(/Diseases/);

    await fireEvent.press(screen.getByTestId('review-complete'));
    expect(await screen.findByText('Complete this screening?')).toBeOnTheScreen();
    const gate = holdNextResponse(context.backend.fetchFn);
    const confirm = screen.getAllByRole('button', { name: 'Complete screening' }).at(-1)!;
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    gate.release();

    expect(await screen.findByTestId('screening-summary')).toBeOnTheScreen();
    expect(app.getPathname()).toBe(`/screening/${session.id}/summary`);
    expect(calls('/complete')).toHaveLength(1);
    expect(calls('/complete')[0]!.body).toEqual({ expectedVersion: 3 });

    expect(await screen.findByTestId('summary-completed-on')).toBeOnTheScreen();
    expect(screen.getByText('Screening observations recorded')).toBeOnTheScreen();
    expect(screen.getByText(/No approved screening rules are set up/)).toBeOnTheScreen();
    const d1 = screen.getByTestId('summary-category-DEFECTS_AT_BIRTH');
    expect(within(d1).getByText('Questions finished')).toBeOnTheScreen();
    expect(await within(d1).findByText('Yes')).toBeOnTheScreen();
    expect(within(d1).getByText('Not assessed – Child asleep')).toBeOnTheScreen();
    expect(within(d1).getByText('Worker observations: Synthetic worker note')).toBeOnTheScreen();
    expect(within(screen.getByTestId('summary-category-DISEASES')).getByText('Incomplete')).toBeOnTheScreen();
    const notAssessed = screen.getByTestId('summary-not-assessed');
    expect(within(notAssessed).getByText('Deficiencies')).toBeOnTheScreen();
    expect(within(notAssessed).getByText('Developmental delays and disabilities')).toBeOnTheScreen();
    expect(screen.queryByText(FORBIDDEN)).toBeNull();
  });

  it('a completed screening is read-only and opens its summary', async () => {
    const { session } = await seededSession();
    screening().finishCategory(session.id, 'DEFICIENCIES');
    const s = screening().sessions.get(session.id)!;
    s.status = 'COMPLETED';
    s.completedAt = '2026-11-21T10:00:00.000Z';
    await renderApp(`/screening/${session.id}`);
    expect(await screen.findByText('This screening is closed and cannot be changed.')).toBeOnTheScreen();
    expect(screen.queryByTestId('session-review')).toBeNull();
    expect(screen.queryByTestId('session-cancel-open')).toBeNull();
    await fireEvent.press(screen.getByTestId('session-view-summary'));
    expect(await screen.findByTestId('screening-summary')).toBeOnTheScreen();
  });

  it("shows another worker's open screening read-only, without complete or cancel", async () => {
    const { session } = await seededSession('other');
    await renderApp(`/screening/${session.id}/summary`);
    expect(await screen.findByTestId('session-summary')).toBeOnTheScreen();
    expect(screen.queryByTestId('summary-continue')).toBeNull();
  });
});

describe('cancellation', () => {
  it('needs a reason and a confirmation, then shows the cancelled summary', async () => {
    const { session } = await seededSession();
    await renderApp(`/screening/${session.id}`);
    await fireEvent.press(await screen.findByTestId('session-cancel-open'));
    await fireEvent.press(screen.getByTestId('session-cancel-confirm'));
    expect(await screen.findByText('Write a short reason (at least 3 characters).')).toBeOnTheScreen();
    expect(calls('/cancel')).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('session-cancel-reason'), 'Child not available');
    await fireEvent.press(screen.getByTestId('session-cancel-confirm'));
    expect(await screen.findByText('Cancel this screening?')).toBeOnTheScreen();
    // The dialog's button (the card behind it has the same label).
    await fireEvent.press(screen.getAllByRole('button', { name: 'Cancel screening' }).at(-1)!);
    expect(await screen.findByTestId('summary-cancel-reason')).toHaveTextContent(
      'Cancelled by Sunita Devi: Child not available',
    );
    expect(calls('/cancel')[0]!.body).toEqual({ expectedVersion: 1, reason: 'Child not available' });
    expect(screening().sessions.get(session.id)!.status).toBe('CANCELLED');
  });
});

describe('screening history', () => {
  it('lists screenings newest first and opens the right screen for each', async () => {
    const { child, session: older } = await seededSession();
    screening().finishCategory(older.id, 'DISEASES');
    const o = screening().sessions.get(older.id)!;
    o.status = 'COMPLETED';
    o.completedAt = '2026-11-21T10:00:00.000Z';
    const me = [...screening().sessions.values()][0]!.ownerId;
    const newer = screening().seedSession(child.id, me);

    await renderApp(`/children/${child.id}`);
    await fireEvent.press(await screen.findByTestId('profile-screening-history'));
    expect(await screen.findByTestId('screening-history')).toBeOnTheScreen();
    const rows = await screen.findAllByTestId(/^history-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual([`history-row-${newer.id}`, `history-row-${older.id}`]);
    expect(within(rows[1]!).getByText('Areas finished: Diseases')).toBeOnTheScreen();

    await fireEvent.press(rows[1]!);
    expect(await screen.findByTestId('screening-summary')).toBeOnTheScreen();
  });

  it('shows an empty state for a child never screened', async () => {
    const { child } = context.backend.children.seedChild({ fullName: 'Synthetic Unscreened Child' });
    await seedSavedSession(context, WORKER);
    await renderApp(`/screening/history/${child.id}`);
    expect(await screen.findByTestId('history-empty')).toBeOnTheScreen();
  });
});

describe('summary in Hindi', () => {
  it('shows the observations-only wording in Hindi', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    const { session } = await seededSession();
    screening().finishCategory(session.id, 'DEFECTS_AT_BIRTH');
    await renderApp(`/screening/${session.id}/summary`);
    await waitFor(() => expect(screen.getByText('जाँच के अवलोकन दर्ज हुए')).toBeOnTheScreen());
  });
});
