import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { router } from 'expo-router';
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

/** Step 6G-2: amending completed screenings, amendment history, medical officer review. */
const WORKER = {
  permissions: ['child.read', 'child.create', 'child.update', 'consent.record', 'screening.conduct'],
};
const MEDICAL_OFFICER = {
  permissions: [...WORKER.permissions, 'screening.review', 'referral.update'],
};
const FORBIDDEN = /diagnosed|definitely has|completely healthy|is healthy|AI diagnosed|normal child/i;
const WEEK = 7 * 24 * 60 * 60 * 1000;

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

const screening = () => context.backend.screening;
const amendCalls = () =>
  context.backend.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/amendments'));

/** A completed screening (Defects at birth finished, one weight) by "me" or another worker. */
async function completedSession(options: { owner?: 'me' | 'other'; as?: { permissions: string[] } } = {}) {
  const { child, guardian } = context.backend.children.seedChild({ fullName: 'Synthetic Amend Child' });
  context.backend.children.seedConsent(child.id, guardian.id, 'SCREENING', 'GRANTED');
  const me = await seedSavedSession(context, options.as ?? WORKER);
  const session =
    options.owner === 'other'
      ? screening().seedSession(child.id, 'other-worker', 'Other Worker')
      : screening().seedSession(child.id, me.user.id, 'Sunita Devi');
  screening().finishCategory(session.id, 'DEFECTS_AT_BIRTH', 'Synthetic first note');
  const weight = screening().seedMeasurement(session.id, 'WEIGHT', '12.5', 'kg');
  screening().complete(session.id);
  return { child, session, weight };
}

async function saveWithReason(reason: string) {
  await fireEvent.changeText(screen.getByTestId('amend-reason'), reason);
  await fireEvent.press(screen.getByTestId('amend-save'));
  await fireEvent.press(await screen.findByTestId('confirm-dialog-confirm'));
}

describe('who may amend (shown on the summary; the API decides)', () => {
  it('the worker who did the screening sees until when they may correct it', async () => {
    const { session } = await completedSession();
    await renderApp(`/screening/${session.id}/summary`);
    expect(await screen.findByTestId('summary-amend-window')).toHaveTextContent(
      /You did this screening: you can correct it until \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/,
    );
    expect(screen.getByTestId('summary-amend-open')).toBeOnTheScreen();
    expect(screen.queryByTestId('amendment-history')).toBeNull();
  });

  it('after 7 days the worker is told to ask a medical officer, and no amend button is shown', async () => {
    const { session } = await completedSession();
    screening().completedAgo(session.id, WEEK + 1000);
    await renderApp(`/screening/${session.id}/summary`);
    expect(await screen.findByTestId('summary-amend-closed')).toHaveTextContent(/Ask a medical officer/);
    expect(screen.queryByTestId('summary-amend-open')).toBeNull();
  });

  it("another worker's screening offers nothing to amend", async () => {
    const { session } = await completedSession({ owner: 'other' });
    await renderApp(`/screening/${session.id}/summary`);
    await screen.findByTestId('session-summary');
    expect(screen.queryByTestId('summary-amend')).toBeNull();
    expect(screen.queryByTestId('summary-amend-closed')).toBeNull();
  });

  it('a medical officer may amend any screening in their area at any time', async () => {
    const { session } = await completedSession({ owner: 'other', as: MEDICAL_OFFICER });
    screening().completedAgo(session.id, 30 * 24 * 60 * 60 * 1000);
    await renderApp(`/screening/${session.id}/summary`);
    expect(await screen.findByTestId('summary-amend-window')).toHaveTextContent(
      /As a medical officer you can correct this screening at any time\./,
    );
  });

  it('opening the amend screen when not allowed shows a message instead of a form', async () => {
    const { session } = await completedSession({ owner: 'other' });
    await renderApp(`/screening/${session.id}/amend`);
    expect(await screen.findByTestId('amend-not-allowed')).toBeOnTheScreen();
    expect(screen.queryByTestId('amend-save')).toBeNull();
  });
});

describe('amending: change, reason, confirm, new version', () => {
  it('changes an answer: exact request, new version, Amended badge, old -> new in the history', async () => {
    const { session } = await completedSession();
    const app = await renderApp(`/screening/${session.id}/summary`);
    await fireEvent.press(await screen.findByTestId('summary-amend-open'));
    expect(await screen.findByTestId('screening-amend')).toBeOnTheScreen();
    expect(screen.getByText(/The original record is never changed/)).toBeOnTheScreen();

    const question = screen.getByTestId('amend-question-DEFECTS_AT_BIRTH-Q1');
    expect(within(question).getByText('Yes')).toBeOnTheScreen();
    await fireEvent.press(within(question).getByTestId('amend-change-DEFECTS_AT_BIRTH-Q1'));
    await fireEvent.press(within(question).getByTestId('q-Q1-answer-NO'));
    expect(screen.getByTestId('amend-pending-count')).toHaveTextContent('Changes ready to save: 1');

    await saveWithReason('Ticked Yes by mistake');
    expect(await screen.findByTestId('summary-amendment-saved')).toHaveTextContent(
      /The amendment has been saved as version 2\./,
    );
    expect(app.getPathname()).toBe(`/screening/${session.id}/summary`);

    const q1 = screening().question('DEFECTS_AT_BIRTH', 'Q1');
    expect(amendCalls()).toHaveLength(1);
    expect(amendCalls()[0]!.body).toEqual({
      clientOperationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expectedSequence: 0,
      reason: 'Ticked Yes by mistake',
      changes: [
        {
          kind: 'RESPONSE',
          category: 'DEFECTS_AT_BIRTH',
          questionId: q1.id,
          status: 'ANSWERED',
          source: 'WORKER_OBSERVED',
          value: false,
        },
      ],
    });

    expect(screen.getByTestId('summary-amended-DEFECTS_AT_BIRTH-Q1')).toBeOnTheScreen();
    expect(screen.getByTestId('amendment-current-version')).toHaveTextContent(
      'Current version: 2 (the original and 1 amendment(s))',
    );
    const history = screen.getByTestId('amendment-1');
    expect(within(history).getByText('Reason: Ticked Yes by mistake')).toBeOnTheScreen();
    expect(within(history).getByTestId('amendment-1-change-0')).toHaveTextContent(
      'Demo question 1.1: Yes → No',
    );
    expect(within(history).getByText('By the worker who did the screening')).toBeOnTheScreen();
    expect(within(history).getByTestId('amendment-1-review')).toHaveTextContent(
      /Waiting for medical officer review/,
    );
    // A worker cannot review.
    expect(screen.queryByTestId('amendment-1-mark-reviewed')).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(FORBIDDEN);
  });

  it('answers a question that was left unanswered (old value shown as "not answered")', async () => {
    const { session } = await completedSession();
    await renderApp(`/screening/${session.id}/amend`);
    const question = await screen.findByTestId('amend-question-DEFECTS_AT_BIRTH-Q3');
    expect(within(question).getByText('Not answered')).toBeOnTheScreen();
    await fireEvent.press(within(question).getByTestId('amend-change-DEFECTS_AT_BIRTH-Q3'));
    await fireEvent.press(within(question).getByTestId('q-Q3-state-UNKNOWN'));
    await fireEvent.press(within(question).getByTestId('q-Q3-source-GUARDIAN_REPORTED'));
    await saveWithReason('Guardian answered later the same day');
    expect(await screen.findByTestId('amendment-1-change-0')).toHaveTextContent(
      'Demo question 1.3: not answered → Unknown',
    );
  });

  it('observations only: no medical review needed', async () => {
    const { session } = await completedSession();
    await renderApp(`/screening/${session.id}/amend`);
    await fireEvent.press(await screen.findByTestId('amend-notes-change-DEFECTS_AT_BIRTH'));
    await fireEvent.changeText(
      screen.getByTestId('amend-notes-input-DEFECTS_AT_BIRTH'),
      'Corrected synthetic note',
    );
    await saveWithReason('Typing mistake in the note');
    expect(await screen.findByTestId('amendment-1-change-0')).toHaveTextContent(
      'Observations (Defects at birth): Synthetic first note → Corrected synthetic note',
    );
    expect(screen.getByTestId('amendment-1-review')).toHaveTextContent(
      /No medical review needed \(observations only\)/,
    );
    expect(screen.getByTestId('summary-notes-amended-DEFECTS_AT_BIRTH')).toBeOnTheScreen();
  });

  it('changes a measurement value; the history shows the old and new value', async () => {
    const { session, weight } = await completedSession();
    await renderApp(`/screening/${session.id}/amend`);
    await fireEvent.press(await screen.findByTestId(`amend-measurement-change-${weight.id}`));
    await fireEvent.changeText(screen.getByTestId(`amend-measurement-value-${weight.id}`), '12.8');
    await saveWithReason('Scale read wrongly');
    const line = await screen.findByTestId('amendment-1-change-0');
    expect(line).toHaveTextContent(/^Weight: 12\.5 kg .* → 12\.8 kg /);
    expect(screen.getByTestId(`summary-measurement-amended-${weight.id}`)).toBeOnTheScreen();
    expect(amendCalls()[0]!.body).toMatchObject({
      changes: [
        {
          kind: 'MEASUREMENT',
          measurementId: weight.id,
          value: '12.8',
          unit: 'kg',
          source: 'MEASURED',
          quality: 'RELIABLE',
          measuredAt: weight.measuredAt,
        },
      ],
    });
  });

  it('a measurement moved to "from a card" needs the card date', async () => {
    const { session, weight } = await completedSession();
    await renderApp(`/screening/${session.id}/amend`);
    await fireEvent.press(await screen.findByTestId(`amend-measurement-change-${weight.id}`));
    await fireEvent.press(screen.getByTestId(`amend-measurement-source-${weight.id}-FROM_RECORD`));
    await fireEvent.changeText(screen.getByTestId('amend-reason'), 'Value was copied from the card');
    await fireEvent.press(screen.getByTestId('amend-save'));
    expect(await screen.findByTestId(`amend-measurement-error-${weight.id}`)).toBeOnTheScreen();
    expect(screen.getByTestId('amend-message')).toHaveTextContent(/Some changes are not complete/);
    expect(amendCalls()).toHaveLength(0);
  });

  it('nothing changed, or no reason: refused before any request', async () => {
    const { session } = await completedSession();
    await renderApp(`/screening/${session.id}/amend`);
    await fireEvent.press(await screen.findByTestId('amend-save'));
    expect(screen.getByTestId('amend-message')).toHaveTextContent(/Make at least one change first\./);

    const question = screen.getByTestId('amend-question-DEFECTS_AT_BIRTH-Q1');
    await fireEvent.press(within(question).getByTestId('amend-change-DEFECTS_AT_BIRTH-Q1'));
    await fireEvent.press(within(question).getByTestId('q-Q1-answer-NO'));
    await fireEvent.press(screen.getByTestId('amend-save'));
    expect(screen.getByText('Enter a reason of at least 3 characters')).toBeOnTheScreen();
    expect(screen.queryByTestId('confirm-dialog-confirm')).toBeNull();

    // Undo brings the count back to zero.
    await fireEvent.press(within(question).getByTestId('amend-undo-DEFECTS_AT_BIRTH-Q1'));
    expect(screen.getByTestId('amend-pending-count')).toHaveTextContent('Changes ready to save: 0');
    expect(amendCalls()).toHaveLength(0);
  });

  it('someone else amended meanwhile: explained, reloaded, edits kept, then saved as the next version', async () => {
    const { session } = await completedSession();
    await renderApp(`/screening/${session.id}/amend`);
    const question = await screen.findByTestId('amend-question-DEFECTS_AT_BIRTH-Q1');
    await fireEvent.press(within(question).getByTestId('amend-change-DEFECTS_AT_BIRTH-Q1'));
    await fireEvent.press(within(question).getByTestId('q-Q1-answer-NO'));
    screening().amendedElsewhere(session.id);
    await saveWithReason('Ticked Yes by mistake');
    expect(await screen.findByTestId('amend-message')).toHaveTextContent(
      /Someone else amended this screening/,
    );
    expect(screen.getByTestId('amend-pending-count')).toHaveTextContent('Changes ready to save: 1');

    await waitFor(() =>
      expect(
        context.backend.calls.filter((c) => c.method === 'GET' && c.path === `/screenings/${session.id}`)
          .length,
      ).toBeGreaterThan(1),
    );
    await fireEvent.press(screen.getByTestId('amend-save'));
    await fireEvent.press(await screen.findByTestId('confirm-dialog-confirm'));
    expect(await screen.findByTestId('summary-amendment-saved')).toHaveTextContent(/version 3/);
    expect(amendCalls().at(-1)!.body).toMatchObject({ expectedSequence: 1 });
    // The retried request is new content, so it carries a new operation id.
    expect((amendCalls()[0]!.body as { clientOperationId: string }).clientOperationId).not.toBe(
      (amendCalls()[1]!.body as { clientOperationId: string }).clientOperationId,
    );
  });

  it('leaving with unsaved corrections asks first', async () => {
    const { session } = await completedSession();
    await renderApp(`/screening/${session.id}/summary`);
    await fireEvent.press(await screen.findByTestId('summary-amend-open'));
    const question = await screen.findByTestId('amend-question-DEFECTS_AT_BIRTH-Q1');
    await fireEvent.press(within(question).getByTestId('amend-change-DEFECTS_AT_BIRTH-Q1'));
    await fireEvent.press(within(question).getByTestId('q-Q1-answer-NO'));
    await act(() => router.back());
    expect(await screen.findByText('Leave without saving?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('confirm-dialog-cancel'));
    expect(screen.getByTestId('screening-amend')).toBeOnTheScreen();
  });
});

describe('medical officer review', () => {
  it('reviews a pending amendment from the queue: optional notes, then "Reviewed by ..."', async () => {
    const { session } = await completedSession({ owner: 'other', as: MEDICAL_OFFICER });
    // A significant amendment made by the conducting worker (synthetic, through the API).
    const q1 = screening().question('DEFECTS_AT_BIRTH', 'Q1');
    const result = screening().route(
      'POST',
      `/screenings/${session.id}/amendments`,
      {
        clientOperationId: '11111111-1111-4111-8111-111111111111',
        expectedSequence: 0,
        reason: 'Ticked Yes by mistake',
        changes: [
          {
            kind: 'RESPONSE',
            category: 'DEFECTS_AT_BIRTH',
            questionId: q1.id,
            status: 'ANSWERED',
            source: 'WORKER_OBSERVED',
            value: false,
          },
        ],
      },
      { id: 'other-worker', name: 'Other Worker', permissions: WORKER.permissions },
    );
    expect(result?.status).toBe(201);

    const app = await renderApp('/screening');
    await fireEvent.press(await screen.findByTestId('screening-review-queue'));
    const item = await screen.findByText('Synthetic Amend Child');
    expect(screen.getByText(/Version 2 · 1 change\(s\)/)).toBeOnTheScreen();
    await fireEvent.press(item);
    expect(app.getPathname()).toBe(`/screening/${session.id}/summary`);

    await fireEvent.press(await screen.findByTestId('amendment-1-mark-reviewed'));
    await fireEvent.changeText(screen.getByTestId('amendment-1-review-notes'), 'Checked with the worker');
    await fireEvent.press(screen.getByTestId('amendment-1-review-confirm'));
    const review = await screen.findByTestId('amendment-1-review');
    await waitFor(() => expect(review).toHaveTextContent(/Reviewed by .* on \d{2}\/\d{2}\/\d{4}/));
    expect(screen.getByText('Review notes: Checked with the worker')).toBeOnTheScreen();
    expect(screen.queryByTestId('amendment-1-mark-reviewed')).toBeNull();
  });

  it('a worker does not see the review queue', async () => {
    await seedSavedSession(context, WORKER);
    await renderApp('/screening');
    await screen.findByTestId('screening-start');
    expect(screen.queryByTestId('screening-review-queue')).toBeNull();
  });

  it('an empty queue says so', async () => {
    await seedSavedSession(context, MEDICAL_OFFICER);
    await renderApp('/screening/review-queue');
    expect(await screen.findByTestId('review-queue-empty')).toHaveTextContent(
      /Nothing is waiting for review\./,
    );
  });
});
