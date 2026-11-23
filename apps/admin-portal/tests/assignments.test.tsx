import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { createPortalServices, ServicesProvider } from '../src/app/services';
import { actionsFor } from '../src/features/assignments/AssignmentActions';
import {
  addDays,
  effectiveFromFor,
  effectiveToFor,
  isCurrent,
  todayInIndia,
} from '../src/features/assignments/dates';
import { I18nProvider } from '../src/i18n';
import { FakeAdmin } from './support/fakeAdmin';
import { ADMIN_ACCESS, BASE_URL, standardServer, type FakeServer } from './support/fakeServer';

let server: FakeServer;
let admin: FakeAdmin;
const today = todayInIndia();

beforeEach(() => {
  server = standardServer();
  admin = new FakeAdmin(server);
  server.addUser({
    loginId: 'SUP-0001',
    password: 'Synthetic-sup-2026',
    displayName: 'Synthetic Supervisor',
    mustChangePassword: false,
    access: {
      ...ADMIN_ACCESS,
      permissions: ['assignment.manage', 'child.read', 'referral.update', 'report.aggregate'],
    },
  });
});

async function openAs(path: string, loginId = 'ADMIN-0001', password = 'Synthetic-admin-2026') {
  const services = createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch });
  await services.session.login(loginId, password);
  const user = userEvent.setup();
  render(
    <ServicesProvider services={services}>
      <I18nProvider initial="en">
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </I18nProvider>
    </ServicesProvider>,
  );
  return { user };
}
const asSupervisor = (path: string) => openAs(path, 'SUP-0001', 'Synthetic-sup-2026');
const lastCall = (path: string) => server.callsTo(path).at(-1)!;

describe('assignment dates are India calendar days', () => {
  it('"today" follows India time, not the computer clock', () => {
    // 20:00 UTC on 30 Nov is already 1 Dec in India (UTC+5:30).
    expect(todayInIndia(new Date('2026-11-30T20:00:00Z'))).toBe('2026-12-01');
    expect(todayInIndia(new Date('2026-11-30T18:00:00Z'))).toBe('2026-11-30');
  });

  it('a last day ends at midnight India time after that day; months and years roll over', () => {
    expect(effectiveToFor('2026-11-30')).toBe('2026-12-01T00:00:00.000+05:30');
    expect(effectiveToFor('2026-12-31')).toBe('2027-01-01T00:00:00.000+05:30');
    expect(effectiveToFor(undefined)).toBeUndefined();
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('a first day of today (or none) means "now"; a future day starts at midnight India time', () => {
    expect(effectiveFromFor(undefined, '2026-11-23')).toBeUndefined();
    expect(effectiveFromFor('2026-11-23', '2026-11-23')).toBeUndefined();
    expect(effectiveFromFor('2026-12-01', '2026-11-23')).toBe('2026-12-01T00:00:00.000+05:30');
  });

  it('only current assignments offer actions, and only the ones that fit their status', () => {
    const now = new Date('2026-11-23T06:00:00Z');
    const future = '2027-01-01T00:00:00.000Z';
    const past = '2026-11-01T00:00:00.000Z';
    expect(actionsFor({ status: 'ACTIVE', effectiveTo: null }, now)).toEqual(['suspend', 'end', 'revoke']);
    expect(actionsFor({ status: 'SUSPENDED', effectiveTo: future }, now)).toEqual([
      'reactivate',
      'end',
      'revoke',
    ]);
    expect(actionsFor({ status: 'REVOKED', effectiveTo: null }, now)).toEqual([]);
    expect(actionsFor({ status: 'ACTIVE', effectiveTo: past }, now)).toEqual([]);
    expect(isCurrent({ status: 'ACTIVE', effectiveTo: past }, now)).toBe(false);
  });
});

describe('assignments page (supervisors and administrators)', () => {
  it('a supervisor sees the assignments in their areas, without links to account pages', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await asSupervisor('/');
    await user.click(await screen.findByRole('link', { name: 'Assignments' }));
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('Synthetic Asha Devi')).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: 'Synthetic Asha Devi' })).not.toBeInTheDocument();
    expect(within(row).getByText('ASHA-0101')).toBeInTheDocument();
    expect(within(row).getByText('Demo Village One')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(lastCall('/assignments').search).toContain('include=current');
  });

  it('suspend with a reason; the row then shows Suspended and offers Reactivate', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await asSupervisor('/assignments');
    const group = await screen.findByRole('group', { name: 'Actions for ASHA in Demo Village One' });
    await user.click(within(group).getByRole('button', { name: 'Suspend' }));
    const form = screen.getByRole('form', { name: 'Suspend' });
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(within(form).getByText('Enter a reason of at least 3 characters')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('Reason'), 'Maternity leave');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('The assignment is suspended.')).toBeInTheDocument();
    expect(lastCall('/assignments/asg-1/suspend').body).toEqual({ reason: 'Maternity leave' });
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('end with a last day sends the end of that day in India time; without one, ends now', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    admin.addManaged('ASHA-0102', 'Synthetic Sunita');
    const { user } = await asSupervisor('/assignments');
    const groups = await screen.findAllByRole('group', { name: 'Actions for ASHA in Demo Village One' });

    await user.click(within(groups[0]!).getByRole('button', { name: 'End assignment' }));
    let form = screen.getByRole('form', { name: 'End assignment' });
    const lastDay = addDays(today, 7);
    await user.type(within(form).getByLabelText('Last day (optional)'), lastDay);
    await user.type(within(form).getByLabelText('Reason'), 'Transfer order 7/2026');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    await screen.findByText('The assignment has been ended.');
    expect(lastCall('/assignments/asg-1/end').body).toEqual({
      reason: 'Transfer order 7/2026',
      effectiveTo: `${addDays(lastDay, 1)}T00:00:00.000+05:30`,
    });

    // The first assignment ends next week, so it is still current: both rows keep their actions.
    const rows = await screen.findAllByRole('group', { name: 'Actions for ASHA in Demo Village One' });
    expect(rows).toHaveLength(2);
    await user.click(within(rows[1]!).getByRole('button', { name: 'End assignment' }));
    form = screen.getByRole('form', { name: 'End assignment' });
    await user.type(within(form).getByLabelText('Reason'), 'Left the village');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(lastCall('/assignments/asg-2/end').body).toEqual({ reason: 'Left the village' }),
    );
  });

  it('a past last day is refused before calling the API', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await asSupervisor('/assignments');
    const group = await screen.findByRole('group', { name: 'Actions for ASHA in Demo Village One' });
    await user.click(within(group).getByRole('button', { name: 'End assignment' }));
    const form = screen.getByRole('form', { name: 'End assignment' });
    await user.type(within(form).getByLabelText('Last day (optional)'), addDays(today, -2));
    await user.type(within(form).getByLabelText('Reason'), 'Transfer');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(within(form).getByText('The date cannot be in the past')).toBeInTheDocument();
    expect(server.callsTo('/assignments/asg-1/end')).toHaveLength(0);
  });

  it('revoke warns that it is permanent; the revoked assignment leaves the current list', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await asSupervisor('/assignments');
    const group = await screen.findByRole('group', { name: 'Actions for ASHA in Demo Village One' });
    await user.click(within(group).getByRole('button', { name: 'Revoke' }));
    const form = screen.getByRole('form', { name: 'Revoke' });
    expect(
      within(form).getByText(/Permanent: use only for an assignment given by mistake/),
    ).toBeInTheDocument();
    await user.type(within(form).getByLabelText('Reason'), 'Given to the wrong person');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('No assignments match.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Show'), 'all');
    await waitFor(() => expect(lastCall('/assignments').search).toContain('include=all'));
    expect(await within(await screen.findByRole('table')).findByText('Revoked')).toBeInTheDocument();
  });

  it('a supervisor adds an area for someone from the list (future first day, last day)', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await asSupervisor('/assignments');
    await user.click(await screen.findByRole('link', { name: 'Add an area for Synthetic Asha Devi' }));
    expect(
      await screen.findByRole('heading', { name: 'Add an area assignment for Synthetic Asha Devi' }),
    ).toBeInTheDocument();

    const roleSelect = await screen.findByLabelText('Role');
    expect(
      within(roleSelect)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['—', 'ASHA', 'Supervisor']);
    await user.selectOptions(roleSelect, 'role-asha');
    await user.type(screen.getByLabelText('Search areas'), 'Two');
    await user.click(await screen.findByRole('button', { name: 'Select: Demo Village Two' }));
    const first = addDays(today, 3);
    const last = addDays(today, 30);
    await user.type(screen.getByLabelText('First day (optional)'), first);
    await user.type(screen.getByLabelText('Last day (optional)'), last);
    await user.type(screen.getByLabelText('Reason or order number'), 'Covering Village Two');
    await user.click(screen.getByRole('button', { name: 'Add assignment' }));

    expect(await screen.findByText('The assignment has been added.')).toBeInTheDocument();
    expect(lastCall('/assignments').method).toBe('GET');
    const post = server.callsTo('/assignments').find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({
      userId: 'managed-1',
      roleId: 'role-asha',
      areaId: 'area-v2',
      scope: 'AREA_ONLY',
      effectiveFrom: `${first}T00:00:00.000+05:30`,
      effectiveTo: `${addDays(last, 1)}T00:00:00.000+05:30`,
      reason: 'Covering Village Two',
    });
    expect(await screen.findByText('Demo Village Two')).toBeInTheDocument();
    expect(screen.getByText(/^Starts /)).toBeInTheDocument();
  });

  it('last day before first day, and an overlapping assignment, are explained', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await asSupervisor('/assignments/new?userId=managed-1&name=Synthetic%20Asha%20Devi');
    await user.selectOptions(await screen.findByLabelText('Role'), 'role-asha');
    await user.type(screen.getByLabelText('Search areas'), 'One');
    await user.click(await screen.findByRole('button', { name: 'Select: Demo Village One' }));
    await user.type(screen.getByLabelText('First day (optional)'), addDays(today, 10));
    await user.type(screen.getByLabelText('Last day (optional)'), addDays(today, 5));
    await user.type(screen.getByLabelText('Reason or order number'), 'Second posting');
    await user.click(screen.getByRole('button', { name: 'Add assignment' }));
    expect(screen.getByText('The last day cannot be before the first day')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('First day (optional)'));
    await user.clear(screen.getByLabelText('Last day (optional)'));
    await user.click(screen.getByRole('button', { name: 'Add assignment' }));
    expect(
      await screen.findByText('This person already has this role in this area for an overlapping period.'),
    ).toBeInTheDocument();
  });

  it('/assignments/new without a person explains what to do', async () => {
    await asSupervisor('/assignments/new');
    expect(await screen.findByText('Choose a person from the assignments list first.')).toBeInTheDocument();
  });
});

describe('assignments on the account page (administrators)', () => {
  it('adds an assignment inline and offers actions only for current assignments', async () => {
    const managed = admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    managed.assignments.push({
      ...managed.assignments[0]!,
      id: 'asg-old',
      areaId: 'area-v2',
      areaName: 'Demo Village Two',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-06-01T00:00:00.000Z',
    });
    const { user } = await openAs(`/users/${managed.user.id}`);
    const section = await screen.findByRole('region', { name: 'Area assignments' });
    expect(within(section).getByText('Ended')).toBeInTheDocument();
    expect(within(section).getAllByRole('group')).toHaveLength(1); // only the current one

    await user.click(within(section).getByRole('button', { name: 'Add assignment' }));
    await user.selectOptions(await within(section).findByLabelText('Role'), 'role-sup');
    await user.type(within(section).getByLabelText('Search areas'), 'District');
    await user.click(await within(section).findByRole('button', { name: 'Select: Demo District' }));
    await user.click(within(section).getByLabelText('This area and all areas within it'));
    await user.type(within(section).getByLabelText('Reason or order number'), 'Promoted to supervisor');
    await user.click(within(section).getByRole('button', { name: 'Add assignment' }));

    expect(await within(section).findByText('The assignment has been added.')).toBeInTheDocument();
    expect(await within(section).findByText('Demo District')).toBeInTheDocument();
    const post = server.callsTo('/assignments').find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ roleId: 'role-sup', areaId: 'area-d1', scope: 'AREA_AND_DESCENDANTS' });
    expect(post.body).not.toHaveProperty('effectiveFrom');
  });
});
