import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { createPortalServices, ServicesProvider } from '../src/app/services';
import { grantableRoles } from '../src/features/users/api';
import { I18nProvider } from '../src/i18n';
import { FakeAdmin, ROLES } from './support/fakeAdmin';
import { ADMIN_ACCESS, BASE_URL, standardServer, type FakeServer } from './support/fakeServer';

let server: FakeServer;
let admin: FakeAdmin;

beforeEach(() => {
  server = standardServer();
  admin = new FakeAdmin(server);
  server.addUser({
    loginId: 'DADMIN-0001',
    password: 'Synthetic-dadmin-2026',
    displayName: 'Synthetic District Admin',
    mustChangePassword: false,
    access: {
      ...ADMIN_ACCESS,
      permissions: ['assignment.manage', 'facility.manage', 'report.aggregate', 'user.manage'],
    },
  });
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
  return { user, services };
}

const lastCall = (path: string) => server.callsTo(path).at(-1)!;

describe('user list', () => {
  it('shows each account with role, area, status and "must change password"', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    admin.addManaged('ASHA-0102', 'Synthetic Sunita', 'SUSPENDED').user.mustChangePassword = true;
    await openAs('/users');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByRole('link', { name: 'Synthetic Asha Devi' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/users\/managed-/),
    );
    expect(within(rows[1]!).getByText('ASHA · Demo Village One')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Active')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Suspended')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Must change password')).toBeInTheDocument();
  });

  it('search and status filter go to the API and into the address', async () => {
    admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    admin.addManaged('ASHA-0102', 'Synthetic Sunita', 'SUSPENDED');
    const { user } = await openAs('/users');
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search by name or login ID'), 'sunita');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(lastCall('/users').search).toContain('search=sunita'));
    expect(await screen.findByRole('link', { name: 'Synthetic Sunita' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Synthetic Asha Devi' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Account status'), 'ACTIVE');
    await waitFor(() => expect(lastCall('/users').search).toContain('status=ACTIVE'));
    expect(await screen.findByText('No accounts match.')).toBeInTheDocument();
  });

  it('pages through more than 20 accounts', async () => {
    for (let i = 1; i <= 25; i += 1)
      admin.addManaged(`ASHA-${1000 + i}`, `Synthetic Worker ${String(i).padStart(2, '0')}`);
    const { user } = await openAs('/users');
    expect(await screen.findByText('Page 1 of 2 (25 accounts)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 2 (25 accounts)')).toBeInTheDocument();
    expect(lastCall('/users').search).toContain('page=2');
  });

  it('a supervisor (assignments only) is told accounts are not theirs - and no request is made', async () => {
    await openAs('/users', 'SUP-0001', 'Synthetic-sup-2026');
    expect(await screen.findByText(/manages area assignments but not user accounts/)).toBeInTheDocument();
    expect(server.callsTo('/users')).toHaveLength(0);
  });
});

describe('create worker account', () => {
  it('validates every field before calling the API', async () => {
    const { user } = await openAs('/users/new');
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Enter a login ID of at least 3 characters')).toBeInTheDocument();
    expect(screen.getByText('Enter the person’s name (at least 2 characters)')).toBeInTheDocument();
    expect(screen.getByText('Choose a role')).toBeInTheDocument();
    expect(screen.getByText('Choose an area')).toBeInTheDocument();
    expect(screen.getByText('Enter a reason of at least 3 characters')).toBeInTheDocument();
    expect(server.callsTo('/users').filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.type(screen.getByLabelText('Login ID'), 'bad id!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      screen.getByText('Use only letters, digits, ".", "_" or "-" (start with a letter or digit)'),
    ).toBeInTheDocument();
  });

  it('full flow: browse to a village, create, one-time password shown once, then the account page', async () => {
    const { user, services } = await openAs('/users/new');
    await user.type(await screen.findByLabelText('Login ID'), ' asha-0042 ');
    await user.type(screen.getByLabelText('Full name'), '  Synthetic Meena  ');
    await user.selectOptions(await screen.findByLabelText('Role'), 'role-asha');

    // Area picker: state -> district -> village
    await user.click(await screen.findByRole('button', { name: 'Open Demo State' }));
    await user.click(await screen.findByRole('button', { name: 'Open Demo District' }));
    await user.click(await screen.findByRole('button', { name: 'Select: Demo Village One' }));
    expect(screen.getByTestId('selected-area')).toHaveTextContent(
      'Selected: Demo State › Demo District › Demo Village One',
    );
    expect(screen.getByLabelText('This area only')).toBeChecked();
    await user.type(screen.getByLabelText('Reason or order number'), 'Order 12/2026');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // One-time password
    const panel = await screen.findByRole('region', { name: 'One-time password for ASHA-0042' });
    expect(within(panel).getByTestId('temporary-password')).toHaveTextContent('TEMP-WXYZ-2345');
    expect(lastCall('/users').body).toEqual({
      loginId: 'ASHA-0042',
      displayName: 'Synthetic Meena',
      preferredLanguage: 'hi',
      assignment: { areaId: 'area-v1', roleId: 'role-asha', scope: 'AREA_ONLY', reason: 'Order 12/2026' },
    });
    // Never cached: not in the query cache, and gone once the admin continues.
    expect(
      JSON.stringify(
        services.queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain('TEMP-WXYZ-2345');

    await user.click(within(panel).getByRole('button', { name: 'I have noted it - continue' }));
    expect(await screen.findByRole('heading', { name: 'Synthetic Meena' })).toBeInTheDocument();
    expect(screen.queryByText('TEMP-WXYZ-2345')).not.toBeInTheDocument();
    expect(screen.getByText('Has not yet replaced the temporary password')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        JSON.stringify(
          services.queryClient
            .getMutationCache()
            .getAll()
            .map((m) => m.state.data),
        ),
      ).not.toContain('TEMP-WXYZ-2345'),
    );
  });

  it('area search finds a village directly', async () => {
    const { user } = await openAs('/users/new');
    await user.type(await screen.findByLabelText('Search areas'), 'Two');
    await user.click(await screen.findByRole('button', { name: 'Select: Demo Village Two' }));
    expect(screen.getByTestId('selected-area')).toHaveTextContent('Demo Village Two');
    await user.click(screen.getByRole('button', { name: 'Change area' }));
    expect(screen.getByLabelText('Search areas')).toBeInTheDocument();
  });

  it('a taken login ID is shown on the field; an out-of-scope refusal as a message', async () => {
    admin.addManaged('ASHA-0042', 'Existing Synthetic');
    const { user } = await openAs('/users/new');
    await user.type(await screen.findByLabelText('Login ID'), 'ASHA-0042');
    await user.type(screen.getByLabelText('Full name'), 'Synthetic Meena');
    await user.selectOptions(await screen.findByLabelText('Role'), 'role-asha');
    await user.type(screen.getByLabelText('Search areas'), 'One');
    await user.click(await screen.findByRole('button', { name: 'Select: Demo Village One' }));
    await user.type(screen.getByLabelText('Reason or order number'), 'Order 12/2026');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This login ID is already in use')).toBeInTheDocument();

    admin.refuseNextCreate = { status: 403, code: 'OUT_OF_SCOPE' };
    await user.clear(screen.getByLabelText('Login ID'));
    await user.type(screen.getByLabelText('Login ID'), 'ASHA-0043');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This area is outside your administrative areas.')).toBeInTheDocument();
  });

  it('a district administrator is not offered roles above their own', async () => {
    await openAs('/users/new', 'DADMIN-0001', 'Synthetic-dadmin-2026');
    const select = await screen.findByLabelText('Role');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['—', 'ASHA', 'Supervisor']);
  });

  it('grantableRoles: management permissions must all be held; fieldwork never matters', () => {
    expect(grantableRoles(ROLES, ['user.manage', 'assignment.manage']).map((r) => r.code)).toEqual(['ASHA']);
    expect(grantableRoles(ROLES, ADMIN_ACCESS.permissions).map((r) => r.code)).toEqual([
      'ASHA',
      'SUPERVISOR',
      'STATE_ADMIN',
    ]);
  });
});

describe('account page and actions', () => {
  it('shows the account and its assignments; unknown or out-of-scope ids look the same', async () => {
    const managed = admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    await openAs(`/users/${managed.user.id}`);
    expect(await screen.findByRole('heading', { name: 'Synthetic Asha Devi' })).toBeInTheDocument();
    const assignments = screen.getByRole('region', { name: 'Area assignments' });
    expect(within(assignments).getByText('Demo Village One')).toBeInTheDocument();
    expect(within(assignments).getByText('This area only')).toBeInTheDocument();
    expect(within(assignments).getByText(/no end date/)).toBeInTheDocument();
  });

  it('an unknown id shows "not found or outside your areas"', async () => {
    await openAs('/users/does-not-exist');
    expect(
      await screen.findByText('This account was not found, or it is outside your administrative areas.'),
    ).toBeInTheDocument();
  });

  it('suspend needs a reason, then shows the new status; reactivate becomes available', async () => {
    const managed = admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await openAs(`/users/${managed.user.id}`);
    await screen.findByRole('heading', { name: 'Synthetic Asha Devi' });
    await user.click(screen.getByRole('button', { name: 'Suspend account' }));
    const form = screen.getByRole('form', { name: 'Suspend account' });
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(within(form).getByText('Enter a reason of at least 3 characters')).toBeInTheDocument();

    await user.type(within(form).getByLabelText('Reason'), 'On leave until January');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('The account is suspended.')).toBeInTheDocument();
    expect(lastCall(`/users/${managed.user.id}/status`).body).toEqual({
      status: 'SUSPENDED',
      reason: 'On leave until January',
    });
    expect(await screen.findByRole('button', { name: 'Reactivate account' })).toBeInTheDocument();
  });

  it('deactivation is permanent: afterwards no actions are offered', async () => {
    const managed = admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await openAs(`/users/${managed.user.id}`);
    await user.click(await screen.findByRole('button', { name: 'Deactivate permanently' }));
    const form = screen.getByRole('form', { name: 'Deactivate permanently' });
    expect(within(form).getByText(/Permanent: the account can never be used again/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText('Reason'), 'Left the programme');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByText('This account is deactivated permanently and cannot be changed.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  });

  it('reset password shows the new one-time password once', async () => {
    const managed = admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await openAs(`/users/${managed.user.id}`);
    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    const form = screen.getByRole('form', { name: 'Reset password' });
    await user.type(within(form).getByLabelText('Reason'), 'Forgot password, verified in person');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    const panel = await screen.findByRole('region', { name: 'One-time password for ASHA-0101' });
    expect(within(panel).getByTestId('temporary-password')).toHaveTextContent('RESET-ABCD-6789');
    await user.click(within(panel).getByRole('button', { name: 'I have noted it - continue' }));
    expect(await screen.findByRole('heading', { name: 'Synthetic Asha Devi' })).toBeInTheDocument();
    expect(screen.queryByText('RESET-ABCD-6789')).not.toBeInTheDocument();
  });

  it('sign out everywhere confirms success', async () => {
    const managed = admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    const { user } = await openAs(`/users/${managed.user.id}`);
    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    const form = screen.getByRole('form', { name: 'Sign out everywhere' });
    await user.type(within(form).getByLabelText('Reason'), 'Phone reported lost');
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('The person has been signed out everywhere.')).toBeInTheDocument();
    expect(lastCall(`/users/${managed.user.id}/revoke-sessions`).body).toEqual({
      reason: 'Phone reported lost',
    });
  });

  it('a concurrent change is reported and the page reloads the account', async () => {
    const managed = admin.addManaged('ASHA-0101', 'Synthetic Asha Devi');
    admin.conflictNextStatus = true;
    const { user } = await openAs(`/users/${managed.user.id}`);
    await user.click(await screen.findByRole('button', { name: 'Suspend account' }));
    const form = screen.getByRole('form', { name: 'Suspend account' });
    await user.type(within(form).getByLabelText('Reason'), 'On leave');
    const before = server.callsTo(`/users/${managed.user.id}`).length;
    await user.click(within(form).getByRole('button', { name: 'Confirm' }));
    expect(await within(form).findByText(/changed meanwhile/)).toBeInTheDocument();
    await waitFor(() => expect(server.callsTo(`/users/${managed.user.id}`).length).toBeGreaterThan(before));
  });
});
