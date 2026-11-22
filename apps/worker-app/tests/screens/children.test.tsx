import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import type { AppServices } from '../../src/services/appServices';
import { network } from '../support/mockNetwork';
import { FAKE_AREA } from '../support/fakeChildren';
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

/** Step 5D: children list, registration, profile, edits and guardians against the fake API. */
const FIELD_WORKER = { permissions: ['child.read', 'child.create', 'child.update', 'consent.record'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let context: TestContext;
beforeEach(() => {
  mockDeviceStore.clear();
  mockDeviceStore.set('bs.language', 'en');
  network.reset();
  context = createTestContext();
  mockServices = context.services;
});

const posts = (path: string) =>
  context.backend.calls
    .filter((c) => c.method === 'POST' && c.path === path)
    .map((c) => c.body as Record<string, unknown>);

async function openRegister() {
  await renderApp('/children/register');
  await screen.findByTestId('register-form');
}

/** Fills a valid registration (exact date, new guardian). */
async function fillValid({ name = 'Synthetic Asha Kumari', phone = '98765 43210' } = {}) {
  await fireEvent.changeText(screen.getByTestId('child-name'), name);
  await fireEvent.press(screen.getByTestId('dob-mode-exact'));
  await fireEvent.changeText(screen.getByTestId('dob-day'), '17');
  await fireEvent.changeText(screen.getByTestId('dob-month'), '5');
  await fireEvent.changeText(screen.getByTestId('dob-year'), '2022');
  await fireEvent.changeText(screen.getByTestId('guardian-name'), 'Synthetic Mother');
  if (phone) await fireEvent.changeText(screen.getByTestId('guardian-phone'), phone);
  await fireEvent.press(screen.getByTestId('relationship-MOTHER'));
  await fireEvent.press(screen.getByTestId('consent-authority-yes'));
}

async function review() {
  await fireEvent.press(screen.getByTestId('register-review-button'));
  await screen.findByTestId('register-review');
}

// ======================================================================= list

describe('children list', () => {
  it('lists children in the worker areas; an estimated date is shown as an approximate age only', async () => {
    context.backend.children.seedChild({ fullName: 'Synthetic Asha' });
    context.backend.children.seedChild({
      fullName: 'Synthetic Basil',
      dateOfBirth: '2023-01-15',
      dobIsEstimated: true,
    });
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp('/children');
    expect(await screen.findByText('Synthetic Asha')).toBeOnTheScreen();
    expect(screen.getByText('Born 17/05/2022 (4 years 6 months)', { exact: false })).toBeOnTheScreen();
    const basil = screen.getByText('Synthetic Basil');
    expect(basil).toBeOnTheScreen();
    expect(screen.getByText(/^About .* old \(date of birth not known\)$/)).toBeOnTheScreen();
    expect(screen.queryByText(/15\/01\/2023/)).toBeNull();
    expect(screen.getByText('Showing 2 of 2')).toBeOnTheScreen();
  });

  it('searches by name (2+ letters) through the API', async () => {
    context.backend.children.seedChild({ fullName: 'Synthetic Asha' });
    context.backend.children.seedChild({ fullName: 'Synthetic Basil' });
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp('/children');
    await screen.findByText('Synthetic Basil');
    await fireEvent.changeText(screen.getByTestId('children-search'), 'asha');
    expect(await screen.findByText('Showing 1 of 1', {}, { timeout: 3000 })).toBeOnTheScreen();
    expect(screen.getByText('Synthetic Asha')).toBeOnTheScreen();
    expect(screen.queryByText('Synthetic Basil')).toBeNull();
    expect(context.backend.calls.some((c) => c.path.includes('search=asha'))).toBe(true);
  });

  it('a role without child.read sees "not available" and requests no child records', async () => {
    await seedSavedSession(context, { permissions: ['report.aggregate', 'user.manage'] });
    await renderApp('/children');
    expect(await screen.findByTestId('children-not-for-role')).toBeOnTheScreen();
    expect(screen.queryByTestId('children-register')).toBeNull();
    expect(context.backend.calls.filter((c) => c.path.startsWith('/children'))).toHaveLength(0);
  });
});

// ======================================================================= registration

describe('child registration', () => {
  it('shows every missing required answer and sends nothing', async () => {
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fireEvent.press(screen.getByTestId('register-review-button'));
    for (const message of [
      'Enter the full name',
      'Choose whether the date of birth is known',
      "Enter the guardian's full name",
      'Choose the relationship',
      'Answer yes or no',
    ]) {
      expect(await screen.findByText(message)).toBeOnTheScreen();
    }
    expect(posts('/children')).toHaveLength(0);
  });

  it('consent authority is never preselected', async () => {
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    for (const value of ['yes', 'no']) {
      expect(screen.getByTestId(`consent-authority-${value}`)).toHaveProp('accessibilityState', {
        checked: false,
        disabled: false,
      });
    }
  });

  it.each([
    ['a future date', ['1', '1', '2099'], 'The date of birth cannot be in the future'],
    ['an impossible date', ['31', '2', '2022'], 'This date does not exist. Check day, month and year.'],
    ['a child over 18', ['1', '1', '2000'], 'Only children up to 18 years can be registered'],
  ])('rejects %s without sending', async (_name, [day, month, year], message) => {
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fillValid();
    await fireEvent.changeText(screen.getByTestId('dob-day'), day!);
    await fireEvent.changeText(screen.getByTestId('dob-month'), month!);
    await fireEvent.changeText(screen.getByTestId('dob-year'), year!);
    await fireEvent.press(screen.getByTestId('register-review-button'));
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(posts('/children')).toHaveLength(0);
  });

  it('rejects an invalid phone number', async () => {
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fillValid({ phone: '12345' });
    await fireEvent.press(screen.getByTestId('register-review-button'));
    expect(await screen.findByText('Enter a valid 10-digit mobile number')).toBeOnTheScreen();
  });

  it('review -> confirm registers once and shows success only after the API confirmed', async () => {
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fillValid();
    await review();
    expect(screen.getByLabelText('Mobile number: +919876543210')).toBeOnTheScreen();
    expect(screen.getByLabelText(`Area: ${FAKE_AREA.nameEn}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('register-confirm'));
    expect(await screen.findByText('The child has been registered.')).toBeOnTheScreen();

    const [body] = posts('/children');
    expect(body).toMatchObject({
      fullName: 'Synthetic Asha Kumari',
      dateOfBirth: '2022-05-17',
      areaId: FAKE_AREA.id,
      confirmNotDuplicate: false,
      guardians: [
        {
          newGuardian: { fullName: 'Synthetic Mother', phone: '98765 43210', preferredLanguage: 'hi' },
          relationship: 'MOTHER',
          isPrimaryContact: true,
          canGiveConsent: true,
          confirmNewGuardian: false,
        },
      ],
    });
    expect(body!.clientOperationId).toMatch(UUID);
    // Never sent by the app: creator, timestamps, status, unknown sex.
    for (const field of ['createdById', 'createdAt', 'status', 'sexAtBirth', 'ageEstimate']) {
      expect(body).not.toHaveProperty(field);
    }

    await fireEvent.press(screen.getByTestId('register-open-profile'));
    expect(await screen.findByTestId('child-profile')).toBeOnTheScreen();
    expect(screen.getByText('+91 ••••••3210')).toBeOnTheScreen();
    expect(screen.queryByText(/9876543210/)).toBeNull();
  });

  it('an unknown date of birth is sent as an approximate age, not invented as a date', async () => {
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fillValid();
    await fireEvent.press(screen.getByTestId('dob-mode-estimate'));
    await fireEvent.changeText(screen.getByTestId('age-years'), '3');
    await fireEvent.changeText(screen.getByTestId('age-months'), '2');
    await review();
    expect(screen.getByText('About 3 years 2 months (estimated)')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('register-confirm'));
    await screen.findByTestId('register-success');
    const [body] = posts('/children');
    expect(body!.ageEstimate).toEqual({ years: 3, months: 2 });
    expect(body).not.toHaveProperty('dateOfBirth');
  });

  it('after a network failure the form is kept and a retry reuses the same submission id', async () => {
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fillValid();
    await review();
    context.backend.override('/children', 'network');
    await fireEvent.press(screen.getByTestId('register-confirm'));
    expect(await screen.findByText(/Cannot reach the server/)).toBeOnTheScreen();
    expect(screen.getByTestId('register-review')).toBeOnTheScreen(); // nothing lost, no false success
    await fireEvent.press(screen.getByTestId('register-confirm'));
    await screen.findByTestId('register-success');
    const bodies = posts('/children');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.clientOperationId).toBe(bodies[0]!.clientOperationId);
    expect(context.backend.children.children.size).toBe(1);
  });

  it('a double tap on confirm sends one request', async () => {
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fillValid();
    await review();
    const held = holdNextResponse(context.backend.fetchFn);
    await fireEvent.press(screen.getByTestId('register-confirm'));
    await fireEvent.press(screen.getByTestId('register-confirm'));
    await act(async () => held.release());
    await screen.findByTestId('register-success');
    expect(posts('/children')).toHaveLength(1);
  });

  it('duplicate warning: shows the in-scope match and registers only after explicit confirmation', async () => {
    const { child } = context.backend.children.seedChild({ fullName: 'Synthetic Asha Kumari' });
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fillValid();
    await review();
    await fireEvent.press(screen.getByTestId('register-confirm'));
    const card = await screen.findByTestId('duplicate-children');
    expect(within(card).getByText('Synthetic Asha Kumari')).toBeOnTheScreen();
    expect(screen.getByTestId(`open-duplicate-${child.id}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('register-confirm')).toBeNull(); // no silent second submit

    await fireEvent.press(screen.getByTestId('register-anyway'));
    await fireEvent.press(await screen.findByTestId('confirm-dialog-confirm'));
    await screen.findByTestId('register-success');
    const bodies = posts('/children');
    expect(bodies.map((b) => b.confirmNotDuplicate)).toEqual([false, true]);
    expect(bodies[1]!.clientOperationId).not.toBe(bodies[0]!.clientOperationId);
    expect(context.backend.children.children.size).toBe(2); // never merged
  });

  it('a guardian phone match lets the worker reuse the existing guardian (masked number only)', async () => {
    const { guardian } = context.backend.children.seedChild(
      { fullName: 'Synthetic Elder Sibling' },
      { fullName: 'Synthetic Shared Mother', phone: '+919876543210' },
    );
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    await fillValid({ name: 'Synthetic Younger Sibling' });
    await review();
    await fireEvent.press(screen.getByTestId('register-confirm'));
    const card = await screen.findByTestId('guardian-duplicates');
    expect(within(card).getByText('+91 ••••••3210')).toBeOnTheScreen();
    expect(within(card).queryByText(/9876543210/)).toBeNull();
    await fireEvent.press(screen.getByTestId(`use-guardian-${guardian.id}`));
    expect(await screen.findByText('Already registered guardian')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('register-confirm'));
    await screen.findByTestId('register-success');
    const last = posts('/children').at(-1)!;
    expect((last.guardians as Array<Record<string, unknown>>)[0]).toMatchObject({
      existingGuardianId: guardian.id,
    });
    expect(context.backend.children.guardians.size).toBe(1); // shared, not duplicated
  });

  it('a worker without a registration area is told so', async () => {
    context.backend.children.setAreas([]);
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp('/children/register');
    expect(await screen.findByTestId('register-no-areas')).toBeOnTheScreen();
  });

  it('is Hindi-first when Hindi is chosen', async () => {
    mockDeviceStore.set('bs.language', 'hi');
    await seedSavedSession(context, FIELD_WORKER);
    await openRegister();
    expect(screen.getByLabelText('बच्चे का पूरा नाम *')).toBeOnTheScreen();
    expect(screen.getByText('क्या यह व्यक्ति बच्चे के लिए सहमति दे सकता है? *')).toBeOnTheScreen();
  });
});

// ======================================================================= profile, edits, links

describe('child profile and changes', () => {
  it('profile shows masked phone, approximate-age badge and no fake screening data', async () => {
    const { child } = context.backend.children.seedChild(
      { fullName: 'Synthetic Profile Child', dobIsEstimated: true },
      { fullName: 'Synthetic Mother', phone: '+919811112222' },
    );
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}`);
    expect(await screen.findByText('Synthetic Profile Child')).toBeOnTheScreen();
    expect(screen.getByText('Approximate age')).toBeOnTheScreen();
    expect(screen.getByText('+91 ••••••2222')).toBeOnTheScreen();
    expect(screen.queryByText(/9811112222/)).toBeNull();
    expect(screen.getByText('Can give consent (worker statement)')).toBeOnTheScreen();
    // Step 6: an entry point to screening, never a result.
    expect(screen.getByText('Health screening for this child. No diagnosis is made.')).toBeOnTheScreen();
  });

  it.each([
    ['edit', 'child-edit', 'edit-save'],
    ['guardian link', 'change-link', 'link-save'],
    ['guardian details', 'Guardian details', 'guardian-phone-value'],
  ])('profile button opens the %s screen (regression: route links)', async (_name, target, expected) => {
    const { child, link } = context.backend.children.seedChild({ fullName: 'Synthetic Navigator' });
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}`);
    const button =
      target === 'Guardian details'
        ? await screen.findByText(target)
        : await screen.findByTestId(target === 'change-link' ? `change-link-${link.id}` : target);
    await fireEvent.press(button);
    expect(await screen.findByTestId(expected)).toBeOnTheScreen();
  });

  it('an unknown or out-of-area child shows "not found"', async () => {
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp('/children/00000000-0000-4000-8000-999999999999');
    expect(await screen.findByTestId('child-not-found')).toBeOnTheScreen();
  });

  it('a read-only role sees no edit, add or register buttons', async () => {
    const { child } = context.backend.children.seedChild({ fullName: 'Synthetic Read Only' });
    await seedSavedSession(context, { permissions: ['child.read'] });
    await renderApp(`/children/${child.id}`);
    await screen.findByText('Synthetic Read Only');
    for (const id of ['child-edit', 'child-add-guardian', 'child-register-sibling']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('edit: a change saved by someone else meanwhile is refused, nothing is overwritten', async () => {
    const { child } = context.backend.children.seedChild({ fullName: 'Synthetic Original' });
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}/edit`);
    const versionSeen = child.updatedAt; // the version the edit screen loaded
    await fireEvent.changeText(await screen.findByTestId('child-name'), 'Synthetic Renamed');
    context.backend.children.touchChild(child.id);
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-stale')).toBeOnTheScreen();
    expect(context.backend.children.children.get(child.id)!.fullName).toBe('Synthetic Original');
    const patch = context.backend.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ expectedUpdatedAt: versionSeen, fullName: 'Synthetic Renamed' });
    expect(patch?.body).not.toHaveProperty('areaId');
  });

  it('removing the last guardian asks for a reason and confirmation, then explains the refusal', async () => {
    const { child, link } = context.backend.children.seedChild({ fullName: 'Synthetic Only Guardian' });
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}/link/${link.id}`);
    await fireEvent.press(await screen.findByTestId('link-remove'));
    expect(await screen.findByText('Enter a short reason')).toBeOnTheScreen();
    expect(context.backend.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('link-remove-reason'), 'Recorded by mistake');
    await fireEvent.press(screen.getByTestId('link-remove'));
    await fireEvent.press(await screen.findByTestId('confirm-dialog-confirm'));
    expect(
      await screen.findByText('A child must keep at least one guardian. Add the correct guardian first.'),
    ).toBeOnTheScreen();
    expect(context.backend.children.links.get(link.id)!.endedAt).toBeNull();
  });

  it('changing consent authority requires confirmation', async () => {
    const { child, link } = context.backend.children.seedChild({ fullName: 'Synthetic Authority' });
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/${child.id}/link/${link.id}`);
    await fireEvent.press(await screen.findByTestId('consent-authority-no'));
    await fireEvent.press(screen.getByTestId('link-save'));
    expect(await screen.findByText('Change who can give consent?')).toBeOnTheScreen();
    expect(context.backend.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(context.backend.children.links.get(link.id)!.canGiveConsent).toBe(false));
  });

  it('guardian page shows the full number only there and lists only accessible children', async () => {
    const { child, guardian } = context.backend.children.seedChild(
      { fullName: 'Synthetic Guardian Child' },
      { fullName: 'Synthetic Phone Mother', phone: '+919822223333' },
    );
    await seedSavedSession(context, FIELD_WORKER);
    await renderApp(`/children/guardian/${guardian.id}`);
    expect(await screen.findByTestId('guardian-phone-value')).toHaveTextContent('+919822223333');
    expect(screen.getByText('Synthetic Guardian Child')).toBeOnTheScreen();
    void child;
  });
});
