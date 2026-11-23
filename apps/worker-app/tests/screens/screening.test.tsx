import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { router } from 'expo-router';
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

/** Step 6D: screening home, child choice, eligibility/consent, Four-D categories, answers, measurements. */
const WORKER = {
  permissions: ['child.read', 'child.create', 'child.update', 'consent.record', 'screening.conduct'],
};

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

const children = () => context.backend.children;
const screening = () => context.backend.screening;
const posts = (re: RegExp) => context.backend.calls.filter((c) => c.method !== 'GET' && re.test(c.path));

function seedChild(withConsent = true, fullName = 'Synthetic Screened Child') {
  const seeded = children().seedChild({ fullName });
  if (withConsent) children().seedConsent(seeded.child.id, seeded.guardian.id, 'SCREENING', 'GRANTED');
  return seeded;
}

/** A started session (owned by the signed-in worker) with D1 started, opened on its category. */
async function openCategory() {
  const { child } = seedChild();
  const me = await seedSavedSession(context, WORKER);
  const session = screening().seedSession(child.id, me.user.id);
  await renderApp(`/screening/${session.id}`);
  await fireEvent.press(await screen.findByTestId('category-action-DEFECTS_AT_BIRTH'));
  await screen.findByTestId('q-Q1');
  return { child, session };
}

async function answerYes(code: string, source = 'WORKER_OBSERVED') {
  await fireEvent.press(screen.getByTestId(`q-${code}-answer-YES`));
  await fireEvent.press(screen.getByTestId(`q-${code}-source-${source}`));
}

// ===================================================================== home

describe('screening home', () => {
  it('shows real counts and lets the worker continue an unfinished screening', async () => {
    const { child } = seedChild();
    const me = await seedSavedSession(context, WORKER);
    const session = screening().seedSession(child.id, me.user.id);
    const app = await renderApp('/screening');
    await waitFor(() =>
      expect(within(screen.getByTestId('screening-metric-drafts')).getByText('1')).toBeOnTheScreen(),
    );
    expect(within(screen.getByTestId('screening-metric-completed')).getByText('0')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByTestId(`open-session-${session.id}`));
    expect(await screen.findByTestId('screening-session')).toBeOnTheScreen();
    expect(app.getPathname()).toBe(`/screening/${session.id}`);
  });

  it('is not offered to a role without screening.conduct, and makes no screening calls', async () => {
    await seedSavedSession(context, { permissions: ['child.read'] });
    await renderApp('/screening');
    expect(await screen.findByText('Screening is not part of your role.')).toBeOnTheScreen();
    expect(context.backend.calls.filter((c) => c.path.startsWith('/screenings'))).toHaveLength(0);
  });

  it('renders in Hindi', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    await seedSavedSession(context, WORKER);
    await renderApp('/screening');
    expect(await screen.findByText('नई जाँच शुरू करें')).toBeOnTheScreen();
  });
});

// ============================================================ choose + eligibility

describe('choosing a child and the eligibility check', () => {
  it('goes from the child list to the eligibility check without creating anything', async () => {
    const { child } = seedChild();
    await seedSavedSession(context, WORKER);
    await renderApp('/screening/select-child');
    await fireEvent.press(await screen.findByTestId(`screening-child-${child.id}`));
    expect(await screen.findByTestId('screening-eligibility')).toBeOnTheScreen();
    expect(posts(/^\/screenings/)).toHaveLength(0);
  });

  it('blocks screening without consent and offers the consent screen instead (no bypass)', async () => {
    const { child } = seedChild(false);
    await seedSavedSession(context, WORKER);
    await renderApp(`/screening/start/${child.id}`);
    expect(
      await screen.findByText(/Screening can start only after a parent or guardian agrees/),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('eligibility-start')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('eligibility-start'));
    expect(posts(/^\/screenings$/)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('eligibility-record-consent'));
    expect(await screen.findByTestId('record-consent-screen')).toBeOnTheScreen();
  });

  it('starts once even on a double tap, shows the demonstration warning, and opens the session', async () => {
    const { child } = seedChild();
    await seedSavedSession(context, WORKER);
    const app = await renderApp(`/screening/start/${child.id}`);
    expect(await screen.findByTestId('screening-demo-banner')).toBeOnTheScreen();
    const gate = holdNextResponse(context.backend.fetchFn);
    await fireEvent.press(screen.getByTestId('eligibility-start'));
    await fireEvent.press(screen.getByTestId('eligibility-start'));
    gate.release();
    expect(await screen.findByTestId('screening-session')).toBeOnTheScreen();
    expect(posts(/^\/screenings$/)).toHaveLength(1);
    const body = posts(/^\/screenings$/)[0]!.body as Record<string, unknown>;
    // Only the child and a submission id: worker, age, area and consent come from the server.
    expect(Object.keys(body).sort()).toEqual(['childId', 'clientOperationId']);
    expect(app.getPathname()).toMatch(/^\/screening\/[0-9a-f-]+$/);
  });

  it('shows an approximate age for an estimated date of birth and offers to resume an open session', async () => {
    const { child } = children().seedChild({ fullName: 'Synthetic Estimated Child', dobIsEstimated: true });
    const guardian = [...children().links.values()].find((l) => l.childId === child.id)!.guardianId;
    children().seedConsent(child.id, guardian, 'SCREENING', 'GRANTED');
    const me = await seedSavedSession(context, WORKER);
    const open = screening().seedSession(child.id, me.user.id);
    await renderApp(`/screening/start/${child.id}`);
    expect(await screen.findByTestId('eligibility-estimated')).toBeOnTheScreen();
    expect(screen.getByTestId('eligibility-age')).toHaveTextContent(/About .* \(date of birth estimated\)/);
    expect(screen.queryByTestId('eligibility-start')).toBeNull();
    await fireEvent.press(screen.getByTestId('eligibility-resume'));
    expect(await screen.findByTestId('screening-session')).toBeOnTheScreen();
    expect(await screen.findByText('Synthetic Estimated Child')).toBeOnTheScreen();
    expect(open.version).toBe(1);
  });
});

// ================================================================== session hub

describe('session hub', () => {
  it('shows workflow state per category, never a health result, and "not available" honestly', async () => {
    const { child } = seedChild();
    screening().markUnavailable('DEVELOPMENTAL_DELAYS_DISABILITIES');
    const me = await seedSavedSession(context, WORKER);
    const session = screening().seedSession(child.id, me.user.id);
    await renderApp(`/screening/${session.id}`);
    const card = await screen.findByTestId('category-card-DEFECTS_AT_BIRTH');
    expect(within(card).getByText('Not started')).toBeOnTheScreen();
    await waitFor(() =>
      expect(
        within(screen.getByTestId('category-card-DEVELOPMENTAL_DELAYS_DISABILITIES')).getByText(
          'Not available',
        ),
      ).toBeOnTheScreen(),
    );
    expect(screen.queryByText(/healthy|normal|diagnos(is|ed) (as|with)/i)).toBeNull();
    expect(screen.getByTestId('screening-not-diagnosis')).toBeOnTheScreen();
  });

  it('is read-only for a worker who did not start the session', async () => {
    const { child } = seedChild();
    await seedSavedSession(context, WORKER);
    const session = screening().seedSession(child.id, 'another-worker', 'Other Worker');
    await renderApp(`/screening/${session.id}`);
    expect(await screen.findByTestId('session-read-only')).toBeOnTheScreen();
    expect(screen.queryByTestId('category-action-DEFECTS_AT_BIRTH')).toBeNull();
  });
});

// ==================================================================== answers

describe('category questions', () => {
  it('saves a section with only the answered questions, the session version and the source', async () => {
    const { session } = await openCategory();
    await answerYes('Q1');
    await fireEvent.press(screen.getByTestId('q-Q2-state-ANSWERED'));
    await fireEvent.press(screen.getByTestId('q-Q2-choice-OPT_B'));
    await fireEvent.press(screen.getByTestId('q-Q2-source-GUARDIAN_REPORTED'));
    await fireEvent.press(screen.getByTestId('category-next'));
    expect(await screen.findByTestId('q-Q3')).toBeOnTheScreen(); // section 2
    const save = posts(/\/categories\/DEFECTS_AT_BIRTH\/responses$/);
    expect(save).toHaveLength(1);
    expect(save[0]!.body).toEqual({
      expectedVersion: 2,
      responses: [
        {
          questionId: screening().question('DEFECTS_AT_BIRTH', 'Q1').id,
          status: 'ANSWERED',
          source: 'WORKER_OBSERVED',
          value: true,
        },
        {
          questionId: screening().question('DEFECTS_AT_BIRTH', 'Q2').id,
          status: 'ANSWERED',
          source: 'GUARDIAN_REPORTED',
          value: 'OPT_B',
        },
      ],
      cleared: [],
    });
    expect(session.version).toBe(3);
  });

  it('records Unknown as unknown - never as No - and keeps an untouched question unanswered', async () => {
    await openCategory();
    await fireEvent.press(screen.getByTestId('q-Q1-answer-UNKNOWN'));
    await fireEvent.press(screen.getByTestId('q-Q1-source-WORKER_OBSERVED'));
    await fireEvent.press(screen.getByTestId('category-save'));
    await screen.findByText('Answers saved.');
    const sent = posts(/\/responses$/)[0]!.body as { responses: Array<Record<string, unknown>> };
    expect(sent.responses).toEqual([
      {
        questionId: screening().question('DEFECTS_AT_BIRTH', 'Q1').id,
        status: 'UNKNOWN',
        source: 'WORKER_OBSERVED',
      },
    ]);
    expect(screen.getByTestId('category-addressed')).toHaveTextContent('1 of 3 questions have an answer');
  });

  it('asks who gave the information before saving (no request is sent)', async () => {
    await openCategory();
    await fireEvent.press(screen.getByTestId('q-Q1-answer-NO'));
    await fireEvent.press(screen.getByTestId('category-save'));
    expect(await screen.findByTestId('q-Q1-error')).toHaveTextContent('Choose who gave this information.');
    expect(posts(/\/responses$/)).toHaveLength(0);
  });

  it('will not finish while a required question has no answer state, then finishes', async () => {
    await openCategory();
    await answerYes('Q1');
    await fireEvent.press(screen.getByTestId('category-next'));
    await screen.findByTestId('q-Q3');
    await fireEvent.press(screen.getByTestId('category-finish'));
    expect(await screen.findByText(/Every required question needs an answer/)).toBeOnTheScreen();
    expect(await screen.findByTestId('q-Q2')).toBeOnTheScreen(); // jumped back to the missing one
    expect(context.backend.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('q-Q2-state-NOT_ASSESSED'));
    await fireEvent.press(screen.getByTestId('q-Q2-source-WORKER_OBSERVED'));
    await fireEvent.press(screen.getByTestId('category-next'));
    await screen.findByTestId('q-Q3');
    await fireEvent.press(screen.getByTestId('category-finish'));
    // The hub stays mounted under the category screen: wait for its card to show the new state.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('category-card-DEFECTS_AT_BIRTH')).getByText('Questions finished'),
      ).toBeOnTheScreen(),
    );
    expect(await screen.findByTestId('screening-session')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('category-card-DEFECTS_AT_BIRTH')).getByText(
        '2 of 3 questions have an answer',
      ),
    ).toBeOnTheScreen();
    expect(context.backend.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('keeps typed answers after a version conflict, reloads, and saves on the next try', async () => {
    const { session } = await openCategory();
    await answerYes('Q1');
    screening().bumpVersion(session.id); // another device saved meanwhile
    await fireEvent.press(screen.getByTestId('category-save'));
    expect(await screen.findByText(/changed on another device/)).toBeOnTheScreen();
    expect(screen.getByTestId('q-Q1-answer-YES')).toBeChecked();
    // The session is reloaded (new version); the worker saves again and it succeeds.
    const reloads = () =>
      context.backend.calls.filter((c) => c.method === 'GET' && c.path === `/screenings/${session.id}`)
        .length;
    await waitFor(() => expect(reloads()).toBeGreaterThanOrEqual(2));
    await fireEvent.press(screen.getByTestId('category-save'));
    expect(await screen.findByText('Answers saved.')).toBeOnTheScreen();
  });

  it('never reports success when the save fails on the network, and keeps the answers', async () => {
    await openCategory();
    await answerYes('Q1');
    context.backend.setOffline(true);
    await fireEvent.press(screen.getByTestId('category-save'));
    expect(await screen.findByTestId('category-message')).not.toHaveTextContent('Answers saved.');
    expect(screen.getByTestId('q-Q1-answer-YES')).toBeChecked();
    context.backend.setOffline(false);
  });

  it('warns before leaving with unsaved answers; Stay keeps them, Leave discards them', async () => {
    await openCategory();
    await answerYes('Q1');
    await act(() => router.back());
    expect(await screen.findByText('Leave without saving?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByTestId('q-Q1-answer-YES')).toBeChecked();
    await act(() => router.back());
    await fireEvent.press(await screen.findByRole('button', { name: 'Leave' }));
    expect(await screen.findByTestId('screening-session')).toBeOnTheScreen();
    expect(posts(/\/responses$/)).toHaveLength(0);
  });

  it('uses accessible radio buttons and checkboxes', async () => {
    const { child } = seedChild();
    const me = await seedSavedSession(context, WORKER);
    const session = screening().seedSession(child.id, me.user.id);
    await renderApp(`/screening/${session.id}`);
    await fireEvent.press(await screen.findByTestId('category-action-DEFICIENCIES'));
    expect(await screen.findByRole('radio', { name: 'Yes' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('q-Q2-state-ANSWERED'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});

// =============================================================== measurements

describe('measurements', () => {
  async function openMeasurements() {
    const { child } = seedChild();
    const me = await seedSavedSession(context, WORKER);
    const session = screening().seedSession(child.id, me.user.id);
    await renderApp(`/screening/${session.id}/measurements`);
    await screen.findByTestId('measurement-type');
    return session;
  }
  async function fill(value: string, unit = 'kg') {
    await fireEvent.press(screen.getByTestId('measurement-type-WEIGHT'));
    await fireEvent.press(screen.getByTestId(`measurement-unit-${unit}`));
    await fireEvent.changeText(screen.getByTestId('measurement-value'), value);
    await fireEvent.press(screen.getByTestId('measurement-source-MEASURED'));
    await fireEvent.press(screen.getByTestId('measurement-quality-RELIABLE'));
  }

  it('checks precision before sending, then saves the value exactly as typed', async () => {
    await openMeasurements();
    await fill('12.345');
    await fireEvent.press(screen.getByTestId('measurement-save'));
    expect(await screen.findByTestId('measurement-error')).toHaveTextContent(/Too many digits/);
    expect(posts(/\/measurements$/)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('measurement-value'), '3250');
    await fireEvent.press(screen.getByTestId('measurement-unit-g'));
    await fireEvent.press(screen.getByTestId('measurement-save'));
    expect(await screen.findByText('Measurement saved.')).toBeOnTheScreen();
    expect(screen.getByText('3250 g (= 3.25 kg)')).toBeOnTheScreen();
    expect((posts(/\/measurements$/)[0]!.body as { value: unknown }).value).toBe('3250');
  });

  it('asks for the date of a value copied from a card and sends the start of that day', async () => {
    await openMeasurements();
    expect(screen.queryByTestId('measurement-date')).toBeNull();
    await fireEvent.press(screen.getByTestId('measurement-type-WEIGHT'));
    await fireEvent.press(screen.getByTestId('measurement-unit-kg'));
    await fireEvent.changeText(screen.getByTestId('measurement-value'), '9.8');
    await fireEvent.press(screen.getByTestId('measurement-source-FROM_RECORD'));
    await fireEvent.press(screen.getByTestId('measurement-quality-QUESTIONABLE'));
    expect(screen.getByTestId('measurement-date')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('measurement-save'));
    expect(await screen.findByTestId('measurement-error')).toHaveTextContent(
      'Enter a real date (day, month, year).',
    );
    expect(posts(/\/measurements$/)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('measurement-date-day'), '15');
    await fireEvent.changeText(screen.getByTestId('measurement-date-month'), '10');
    await fireEvent.changeText(screen.getByTestId('measurement-date-year'), '2026');
    await fireEvent.press(screen.getByTestId('measurement-save'));
    expect(await screen.findByText('Measurement saved.')).toBeOnTheScreen();
    const body = posts(/\/measurements$/)[0]!.body as { measuredAt: string; source: string };
    expect(body).toMatchObject({ source: 'FROM_RECORD', measuredAt: '2026-10-14T18:30:00.000Z' });
  });

  it("shows the server's plausibility refusal in plain language", async () => {
    await openMeasurements();
    await fill('400');
    await fireEvent.press(screen.getByTestId('measurement-save'));
    expect(
      await screen.findByText('This value is not possible. Check the number and the unit.'),
    ).toBeOnTheScreen();
  });

  it('corrects a value: the original stays visible as "Corrected" and a reason is required', async () => {
    const session = await openMeasurements();
    await fill('12.5');
    await fireEvent.press(screen.getByTestId('measurement-save'));
    await screen.findByText('Measurement saved.');
    const original = session.measurements[0]!;
    await fireEvent.press(screen.getByTestId(`measurement-correct-${original.id}`));
    await fireEvent.changeText(screen.getByTestId('measurement-value'), '12.8');
    await fireEvent.press(screen.getByTestId('measurement-source-MEASURED'));
    await fireEvent.press(screen.getByTestId('measurement-quality-RELIABLE'));
    await fireEvent.press(screen.getByTestId('measurement-save'));
    expect(await screen.findByTestId('measurement-error')).toHaveTextContent(
      'Give a short reason for the correction.',
    );
    await fireEvent.changeText(screen.getByTestId('measurement-reason'), 'Scale not zeroed');
    await fireEvent.press(screen.getByTestId('measurement-save'));
    expect(await screen.findByText('Corrected')).toBeOnTheScreen();
    expect(screen.getByText('Correction: Scale not zeroed')).toBeOnTheScreen();
    expect(session.measurements).toHaveLength(2);
  });
});

describe('session expiry', () => {
  it('saves after the access token expired (silent refresh), without losing answers', async () => {
    await openCategory();
    await answerYes('Q1');
    context.backend.expireAccessTokens();
    await fireEvent.press(screen.getByTestId('category-save'));
    expect(await screen.findByText('Answers saved.')).toBeOnTheScreen();
    expect(context.backend.callsTo('/auth/refresh').length).toBeGreaterThan(0);
  });
});
