import type { AreaNode, AssignmentView, RoleView, UserView } from '@balswasthya/shared-contracts';
import { error, json, type FakeServer, type FakeUser } from './fakeServer';

/**
 * Fake user-administration endpoints (/users, /roles, /areas) for the portal's stage PC tests.
 * Synthetic data. Permission checks are reduced to "the caller holds user.manage /
 * assignment.manage"; the real scope rules are tested against the real API (services/api tests).
 */
export const ROLES: RoleView[] = [
  {
    id: 'role-asha',
    code: 'ASHA',
    nameEn: 'ASHA',
    nameHi: 'आशा',
    permissions: ['child.create', 'child.read', 'screening.conduct'],
  },
  {
    id: 'role-sup',
    code: 'SUPERVISOR',
    nameEn: 'Supervisor',
    nameHi: 'पर्यवेक्षक',
    permissions: ['assignment.manage', 'child.read', 'referral.update', 'report.aggregate'],
  },
  {
    id: 'role-state',
    code: 'STATE_ADMIN',
    nameEn: 'State Administrator',
    nameHi: 'राज्य प्रशासक',
    permissions: [
      'area.manage',
      'assignment.manage',
      'audit.read',
      'facility.manage',
      'report.aggregate',
      'user.manage',
    ],
  },
];

const level = {
  STATE: { levelCode: 'STATE', levelNameEn: 'State', levelNameHi: 'राज्य', allowsChildRegistration: false },
  DISTRICT: {
    levelCode: 'DISTRICT',
    levelNameEn: 'District',
    levelNameHi: 'ज़िला',
    allowsChildRegistration: false,
  },
  VILLAGE: {
    levelCode: 'VILLAGE',
    levelNameEn: 'Village',
    levelNameHi: 'गाँव',
    allowsChildRegistration: true,
  },
};
const statePath = { id: 'area-state', nameEn: 'Demo State', nameHi: null, levelCode: 'STATE' };
const districtPath = { id: 'area-d1', nameEn: 'Demo District', nameHi: null, levelCode: 'DISTRICT' };

export const AREAS: AreaNode[] = [
  {
    id: 'area-state',
    code: 'ST',
    nameEn: 'Demo State',
    nameHi: null,
    ...level.STATE,
    childCount: 1,
    path: [],
  },
  {
    id: 'area-d1',
    code: 'D1',
    nameEn: 'Demo District',
    nameHi: null,
    ...level.DISTRICT,
    childCount: 2,
    path: [statePath],
  },
  {
    id: 'area-v1',
    code: 'V1',
    nameEn: 'Demo Village One',
    nameHi: 'डेमो गाँव एक',
    ...level.VILLAGE,
    childCount: 0,
    path: [statePath, districtPath],
  },
  {
    id: 'area-v2',
    code: 'V2',
    nameEn: 'Demo Village Two',
    nameHi: null,
    ...level.VILLAGE,
    childCount: 0,
    path: [statePath, districtPath],
  },
];
const PARENT: Record<string, string | null> = {
  'area-state': null,
  'area-d1': 'area-state',
  'area-v1': 'area-d1',
  'area-v2': 'area-d1',
};

export interface ManagedUser {
  user: UserView;
  assignments: AssignmentView[];
}

export class FakeAdmin {
  readonly managed: ManagedUser[] = [];
  /** Makes the next POST /users fail with this error code (e.g. OUT_OF_SCOPE). */
  refuseNextCreate: { status: number; code: string } | null = null;
  /** Makes the next status change answer 409 CONCURRENT_CHANGE. */
  conflictNextStatus = false;
  /** Makes the next POST /assignments fail with this error. */
  refuseNextAssignment: { status: number; code: string } | null = null;
  private seq = 0;

  private assignmentRoute(method: string, path: string, url: URL, body: unknown): Response | null {
    const now = new Date();
    const isCurrent = (a: AssignmentView) =>
      a.status !== 'REVOKED' && (a.effectiveTo === null || new Date(a.effectiveTo) > now);

    if (method === 'GET' && path === '/assignments') {
      const include = url.searchParams.get('include') ?? 'current';
      const status = url.searchParams.get('status');
      const search = url.searchParams.get('search')?.toLowerCase();
      const all = this.managed.flatMap((m) =>
        m.assignments
          .filter((a) => include === 'all' || isCurrent(a))
          .filter((a) => !status || a.status === status)
          .filter(
            () =>
              !search ||
              m.user.displayName.toLowerCase().includes(search) ||
              m.user.loginId.toLowerCase().includes(search),
          )
          .map((a) => ({
            ...a,
            areaNameHi: null,
            user: {
              id: m.user.id,
              loginId: m.user.loginId,
              displayName: m.user.displayName,
              status: m.user.status,
            },
          })),
      );
      return json(200, { items: all, page: 1, pageSize: 20, total: all.length });
    }

    if (method === 'POST' && path === '/assignments') {
      if (this.refuseNextAssignment) {
        const refusal = this.refuseNextAssignment;
        this.refuseNextAssignment = null;
        return json(refusal.status, error(refusal.code));
      }
      const input = body as {
        userId: string;
        areaId: string;
        roleId: string;
        scope: 'AREA_ONLY' | 'AREA_AND_DESCENDANTS';
        effectiveFrom?: string;
        effectiveTo?: string;
      };
      const owner = this.managed.find((m) => m.user.id === input.userId);
      if (!owner) return json(404, error('NOT_FOUND'));
      if (
        owner.assignments.some((a) => isCurrent(a) && a.areaId === input.areaId && a.roleId === input.roleId)
      ) {
        return json(409, error('ASSIGNMENT_OVERLAP'));
      }
      const area = AREAS.find((a) => a.id === input.areaId)!;
      const role = ROLES.find((r) => r.id === input.roleId)!;
      this.seq += 1;
      const assignment: AssignmentView = {
        id: `asg-new-${this.seq}`,
        userId: owner.user.id,
        areaId: area.id,
        areaName: area.nameEn,
        roleId: role.id,
        roleCode: role.code,
        scope: input.scope,
        status: 'ACTIVE',
        effectiveFrom: input.effectiveFrom ?? now.toISOString(),
        effectiveTo: input.effectiveTo ?? null,
      };
      owner.assignments.push(assignment);
      return json(201, { assignment });
    }

    const match = /^\/assignments\/([^/]+)\/(end|suspend|reactivate|revoke)$/.exec(path);
    if (!match || method !== 'POST') return null;
    const owner = this.managed.find((m) => m.assignments.some((a) => a.id === match[1]));
    const index = owner?.assignments.findIndex((a) => a.id === match[1]) ?? -1;
    if (!owner || index < 0) return json(404, error('NOT_FOUND'));
    const current = owner.assignments[index]!;
    const input = body as { effectiveTo?: string };
    const transitions: Record<string, [string[], AssignmentView['status']]> = {
      suspend: [['ACTIVE'], 'SUSPENDED'],
      reactivate: [['SUSPENDED'], 'ACTIVE'],
      revoke: [['ACTIVE', 'SUSPENDED'], 'REVOKED'],
      end: [['ACTIVE', 'SUSPENDED'], current.status],
    };
    const [from, to] = transitions[match[2]!]!;
    if (!from.includes(current.status)) return json(409, error('INVALID_TRANSITION'));
    const updated: AssignmentView = {
      ...current,
      status: to,
      effectiveTo: match[2] === 'end' ? (input.effectiveTo ?? now.toISOString()) : current.effectiveTo,
    };
    owner.assignments[index] = updated;
    return json(200, { assignment: updated });
  }

  constructor(private readonly server: FakeServer) {
    server.extraRoutes = (request) => this.route(request);
  }

  addManaged(loginId: string, displayName: string, status: UserView['status'] = 'ACTIVE'): ManagedUser {
    this.seq += 1;
    const id = `managed-${this.seq}`;
    const entry: ManagedUser = {
      user: {
        id,
        loginId,
        displayName,
        status,
        mustChangePassword: false,
        lastLoginAt: '2026-11-20T04:30:00.000Z',
      },
      assignments: [
        {
          id: `asg-${this.seq}`,
          userId: id,
          areaId: 'area-v1',
          areaName: 'Demo Village One',
          roleId: 'role-asha',
          roleCode: 'ASHA',
          scope: 'AREA_ONLY',
          status: 'ACTIVE',
          effectiveFrom: '2026-11-01T00:00:00.000Z',
          effectiveTo: null,
        },
      ],
    };
    this.managed.push(entry);
    return entry;
  }

  private route({
    method,
    path,
    url,
    body,
    caller,
  }: {
    method: string;
    path: string;
    url: URL;
    body: unknown;
    caller: FakeUser | undefined;
  }): Response | null {
    const isAdminPath =
      path === '/roles' ||
      path === '/areas' ||
      path === '/users' ||
      path.startsWith('/users/') ||
      path === '/assignments' ||
      path.startsWith('/assignments/');
    if (!isAdminPath) return null;
    if (!caller) return json(401, error('UNAUTHENTICATED'));
    const perms = caller.access.permissions;
    const hasUserManage = perms.includes('user.manage');
    const hasAssignmentManage = perms.includes('assignment.manage');

    if (method === 'GET' && path === '/roles') {
      return hasAssignmentManage ? json(200, { roles: ROLES }) : json(403, error('FORBIDDEN'));
    }

    if (method === 'GET' && path === '/areas') {
      if (!hasUserManage && !hasAssignmentManage) return json(403, error('FORBIDDEN'));
      const parentId = url.searchParams.get('parentId');
      const search = url.searchParams.get('search');
      let items: AreaNode[];
      if (search) items = AREAS.filter((a) => a.nameEn.toLowerCase().includes(search.toLowerCase()));
      else if (parentId) {
        if (!(parentId in PARENT)) return json(404, error('NOT_FOUND'));
        items = AREAS.filter((a) => PARENT[a.id] === parentId);
      } else items = AREAS.filter((a) => PARENT[a.id] === null);
      return json(200, { items, truncated: false });
    }

    if (path === '/assignments' || path.startsWith('/assignments/')) {
      if (!hasAssignmentManage) return json(403, error('FORBIDDEN'));
      return this.assignmentRoute(method, path, url, body);
    }

    if (!hasUserManage) return json(403, error('FORBIDDEN'));

    if (method === 'GET' && path === '/users') {
      const search = url.searchParams.get('search')?.toLowerCase();
      const status = url.searchParams.get('status');
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
      const all = this.managed
        .filter(
          (m) =>
            !search ||
            m.user.displayName.toLowerCase().includes(search) ||
            m.user.loginId.toLowerCase().includes(search),
        )
        .filter((m) => !status || m.user.status === status);
      const items = all.slice((page - 1) * pageSize, page * pageSize).map((m) => ({
        ...m.user,
        currentAssignments: m.assignments
          .filter((a) => a.status !== 'REVOKED')
          .map((a) => ({ roleCode: a.roleCode, areaName: a.areaName, areaNameHi: null, status: a.status })),
      }));
      return json(200, { items, page, pageSize, total: all.length });
    }

    if (method === 'POST' && path === '/users') {
      if (this.refuseNextCreate) {
        const refusal = this.refuseNextCreate;
        this.refuseNextCreate = null;
        return json(refusal.status, error(refusal.code));
      }
      const input = body as {
        loginId: string;
        displayName: string;
        assignment: { areaId: string; roleId: string; scope: 'AREA_ONLY' | 'AREA_AND_DESCENDANTS' };
      };
      if (this.managed.some((m) => m.user.loginId === input.loginId)) {
        return json(409, error('LOGIN_ID_TAKEN'));
      }
      const created = this.addManaged(input.loginId, input.displayName);
      created.user.mustChangePassword = true;
      created.user.lastLoginAt = null;
      const area = AREAS.find((a) => a.id === input.assignment.areaId)!;
      const role = ROLES.find((r) => r.id === input.assignment.roleId)!;
      created.assignments[0] = {
        ...created.assignments[0]!,
        areaId: area.id,
        areaName: area.nameEn,
        roleId: role.id,
        roleCode: role.code,
        scope: input.assignment.scope,
      };
      return json(201, { user: created.user, temporaryPassword: 'TEMP-WXYZ-2345' });
    }

    const match = /^\/users\/([^/]+)(?:\/(status|reset-password|revoke-sessions))?$/.exec(path);
    if (!match) return null;
    const target = this.managed.find((m) => m.user.id === match[1]);
    if (!target) return json(404, error('NOT_FOUND'));
    const action = match[2];

    if (method === 'GET' && !action) return json(200, { user: target.user, assignments: target.assignments });
    if (method === 'POST' && action === 'status') {
      if (this.conflictNextStatus) {
        this.conflictNextStatus = false;
        return json(409, error('CONCURRENT_CHANGE'));
      }
      if (target.user.status === 'DEACTIVATED') return json(409, error('INVALID_TRANSITION'));
      target.user = { ...target.user, status: (body as { status: UserView['status'] }).status };
      return json(200, { user: target.user });
    }
    if (method === 'POST' && action === 'reset-password') {
      target.user = { ...target.user, mustChangePassword: true };
      return json(200, { user: target.user, temporaryPassword: 'RESET-ABCD-6789' });
    }
    if (method === 'POST' && action === 'revoke-sessions') return new Response(null, { status: 204 });
    return null;
  }
}
