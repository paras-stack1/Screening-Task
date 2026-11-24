import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { createPortalServices, ServicesProvider } from '../src/app/services';
import { I18nProvider } from '../src/i18n';
import { FakeAdmin } from './support/fakeAdmin';
import { ADMIN_ACCESS, BASE_URL, error, json, standardServer, type FakeServer } from './support/fakeServer';

/** Step 7G: facility directory administration and aggregate reports. Synthetic data only. */
let server: FakeServer;
interface Facility {
  id: string;
  name: string;
  type: string;
  version: number;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED';
  acceptsReferrals: boolean;
  isActive: boolean;
  services: string[];
  history: Array<{
    action: string;
    changes: object;
    reason: string | null;
    actorName: string;
    occurredAt: string;
  }>;
}
let facilities: Facility[];
let reportCalls: string[];

const detail = (f: Facility) => ({
  facility: {
    id: f.id,
    name: f.name,
    nameHi: null,
    officialCode: null,
    type: f.type,
    areaId: 'area-d1',
    areaPath: ['Demo State', 'Demo District'],
    address: null,
    contactPhone: null,
    services: f.services,
    acceptsReferrals: f.acceptsReferrals,
    verificationStatus: f.verificationStatus,
    isActive: f.isActive,
    version: f.version,
    verifiedByName: f.verificationStatus === 'VERIFIED' ? 'Synthetic State Admin' : null,
    verifiedAt: null,
    verificationReference: f.verificationStatus === 'VERIFIED' ? 'SYN-1' : null,
    deactivatedAt: null,
    deactivationReason: null,
    history: f.history,
    canManage: true,
  },
});
const summary = (f: Facility) => {
  const {
    version: _v,
    history: _h,
    verifiedByName: _b,
    verifiedAt: _a,
    verificationReference: _r,
    deactivatedAt: _d,
    deactivationReason: _dr,
    canManage: _c,
    ...s
  } = detail(f).facility;
  return {
    ...s,
    placement: 'IN_DISTRICT',
    selectable: f.verificationStatus === 'VERIFIED' && f.acceptsReferrals && f.isActive,
  };
};
const count = (value: number) =>
  value > 0 && value < 5 ? { value: null, suppressed: true } : { value, suppressed: false };

beforeEach(() => {
  server = standardServer();
  new FakeAdmin(server);
  const areas = server.extraRoutes!;
  facilities = [];
  reportCalls = [];
  server.extraRoutes = (request) => {
    const { method, path, url, body } = request;
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/facilities' && method === 'GET') return json(200, { items: facilities.map(summary) });
    if (path === '/facilities' && method === 'POST') {
      if ('verificationStatus' in b) return json(400, error('VALIDATION_FAILED'));
      const f: Facility = {
        id: `fac-${facilities.length + 1}`,
        name: String(b.name),
        type: String(b.type),
        version: 1,
        verificationStatus: 'UNVERIFIED',
        acceptsReferrals: false,
        isActive: true,
        services: [],
        history: [
          {
            action: 'CREATED',
            changes: {},
            reason: null,
            actorName: 'Synthetic State Admin',
            occurredAt: '2026-11-24T05:00:00.000Z',
          },
        ],
      };
      facilities.push(f);
      return json(201, detail(f));
    }
    const m = /^\/facilities\/([^/]+)(?:\/(verify|unverify|deactivate|reactivate))?$/.exec(path);
    if (m) {
      const f = facilities.find((x) => x.id === m[1]);
      if (!f) return json(404, error('NOT_FOUND'));
      if (method === 'GET') return json(200, detail(f));
      if (b.expectedVersion !== f.version) return json(409, error('VERSION_CONFLICT'));
      f.version += 1;
      if (m[2] === 'verify') {
        f.verificationStatus = 'VERIFIED';
        f.services = b.services as string[];
        f.acceptsReferrals = Boolean(b.acceptsReferrals);
      }
      if (m[2] === 'deactivate') {
        f.isActive = false;
        f.acceptsReferrals = false;
      }
      f.history.push({
        action: (m[2] ?? 'update').toUpperCase() + 'D',
        changes: b,
        reason: (b.reason as string) ?? null,
        actorName: 'Synthetic State Admin',
        occurredAt: '2026-11-24T06:00:00.000Z',
      });
      return json(200, detail(f));
    }
    if (path === '/reports/aggregate') {
      reportCalls.push(url.search);
      return json(200, {
        report: {
          areaId: 'area-d1',
          areaName: 'Demo District',
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          suppressionThreshold: 5,
          screeningsCompleted: count(42),
          referralsCreated: count(3),
          referralsIssued: count(0),
          referralsAcknowledged: count(0),
          visitsRecorded: count(0),
          referralsClosed: count(0),
          followUpsOverdue: count(7),
          byCategory: [
            { category: 'DEFECTS_AT_BIRTH', referralsCreated: count(0) },
            { category: 'DEFICIENCIES', referralsCreated: count(3) },
            { category: 'DISEASES', referralsCreated: count(0) },
            { category: 'DEVELOPMENTAL_DELAYS_DISABILITIES', referralsCreated: count(0) },
          ],
          bySubArea: [],
        },
      });
    }
    return areas(request);
  };
});

async function openAs(path: string, access = ADMIN_ACCESS) {
  server.addUser({
    loginId: 'FAC-ADMIN',
    password: 'Synthetic-admin-2026',
    displayName: 'Synthetic State Admin',
    mustChangePassword: false,
    access,
  });
  const services = createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch });
  await services.session.login('FAC-ADMIN', 'Synthetic-admin-2026');
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

describe('facilities', () => {
  it('only facility and report holders see the new menu entries', async () => {
    await openAs('/', { ...ADMIN_ACCESS, permissions: ['assignment.manage'] });
    expect(await screen.findByRole('link', { name: 'Assignments' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Facilities' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Reports' })).toBeNull();
  });

  it('creates an unverified facility, then records a verification', async () => {
    const { user } = await openAs('/facilities/new');
    expect(await screen.findByText(/does not receive referrals until it is verified/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create facility' }));
    expect(await screen.findByText('Enter the name, type and area.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Synthetic Block PHC');
    await user.selectOptions(screen.getByLabelText('Type'), 'PHC');
    await user.click(await screen.findByRole('button', { name: 'Open Demo State' }));
    await user.click(await screen.findByRole('button', { name: 'Select: Demo District' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));
    expect(await screen.findByRole('heading', { name: 'Synthetic Block PHC' })).toBeInTheDocument();
    expect(screen.getByTestId('facility-status')).toHaveTextContent(
      'Active · Not verified · Not accepting referrals',
    );
    const created = server.callsTo('/facilities').find((c) => c.method === 'POST')!.body as Record<
      string,
      unknown
    >;
    expect(created).toMatchObject({ name: 'Synthetic Block PHC', type: 'PHC', areaId: 'area-d1' });
    expect(Object.keys(created)).not.toContain('verificationStatus');

    const verifyForm = screen.getByRole('form', { name: 'Record verification' });
    await user.type(within(verifyForm).getByLabelText(/Verification reference/), 'SYN-LETTER-7');
    await user.type(within(verifyForm).getByLabelText(/Verified service codes/), 'paediatrics, eye_care');
    await user.click(within(verifyForm).getByLabelText(/accepts referrals/));
    await user.click(within(verifyForm).getByRole('button', { name: 'Record verification' }));
    await waitFor(() =>
      expect(screen.getByTestId('facility-status')).toHaveTextContent(
        'Active · Verified · Accepts referrals',
      ),
    );
    expect(server.callsTo('/facilities/fac-1/verify').at(-1)!.body).toEqual({
      expectedVersion: 1,
      verificationReference: 'SYN-LETTER-7',
      services: ['PAEDIATRICS', 'EYE_CARE'],
      acceptsReferrals: true,
    });
  });

  it('a stale version shows an error; the page reloads the newer facility', async () => {
    facilities.push({
      id: 'fac-9',
      name: 'Synthetic CHC',
      type: 'CHC',
      version: 1,
      verificationStatus: 'UNVERIFIED',
      acceptsReferrals: false,
      isActive: true,
      services: [],
      history: [],
    });
    const { user } = await openAs('/facilities/fac-9');
    await screen.findByRole('heading', { name: 'Synthetic CHC' });
    facilities[0]!.version = 2; // changed elsewhere
    const form = screen.getByRole('form', { name: 'Deactivate facility' });
    await user.type(within(form).getByLabelText('Reason'), 'Synthetic closure');
    await user.click(within(form).getByRole('button', { name: 'Deactivate facility' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(facilities[0]!.isActive).toBe(true);
  });
});

describe('reports', () => {
  it('shows aggregate counts for a chosen area and hides small counts', async () => {
    const { user } = await openAs('/reports');
    await user.click(await screen.findByRole('button', { name: 'Open Demo State' }));
    await user.click(await screen.findByRole('button', { name: 'Select: Demo District' }));
    await user.click(screen.getByRole('button', { name: 'Show report' }));
    const table = await screen.findByRole('table', { name: 'Reports' });
    expect(within(table).getByRole('row', { name: /Screenings completed 42/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Referrals created fewer than 5/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Follow-ups overdue \(now\) 7/ })).toBeInTheDocument();
    expect(reportCalls[0]).toMatch(/areaId=area-d1&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    expect(document.body.textContent).not.toMatch(/Synthetic (Child|Mother|Father)/);
  });
});
