import type { Db } from '../../config/database';
import { assignmentCoversAreaWhere, effectiveAssignmentWhere } from './accessScope';
import { PERMISSION_CODES, PERMISSION_DELEGATION, type PermissionCode } from './permissions';

/**
 * Role and permission checks (docs/authorization.md). All are evaluated from the database at
 * request time (R10) - never from token claims - and deny by default (R8).
 */

const KNOWN = new Set<string>(PERMISSION_CODES);
const asPermissionCodes = (codes: Iterable<string>) =>
  new Set([...codes].filter((code): code is PermissionCode => KNOWN.has(code)));

/** True when the user holds `permission` through at least one effective assignment, anywhere. */
export async function hasPermissionAnywhere(
  db: Db,
  userId: string,
  permission: PermissionCode,
  at: Date,
): Promise<boolean> {
  const found = await db.workerAreaAssignment.findFirst({
    where: effectiveAssignmentWhere(userId, permission, at),
    select: { id: true },
  });
  return found !== null;
}

/**
 * The union of permissions the user holds OVER one area, from effective assignments covering it
 * (R4: a permission only counts where the assignment granting it applies). With `wholeSubtree`,
 * only assignments that also cover everything below the area count.
 */
export async function permissionsOverArea(
  db: Db,
  userId: string,
  areaId: string,
  at: Date,
  wholeSubtree = false,
): Promise<Set<PermissionCode>> {
  const rows = await db.permission.findMany({
    where: {
      roles: {
        some: {
          role: {
            assignments: {
              some: effectiveAssignmentWhere(
                userId,
                null,
                at,
                assignmentCoversAreaWhere(areaId, wholeSubtree),
              ),
            },
          },
        },
      },
    },
    select: { code: true },
  });
  return asPermissionCodes(rows.map((row) => row.code));
}

/** Permission codes granted by one role (empty for an inactive or unknown role). */
export async function rolePermissions(db: Db, roleId: string): Promise<Set<PermissionCode>> {
  const rows = await db.permission.findMany({
    where: { roles: { some: { roleId, role: { isActive: true } } } },
    select: { code: true },
  });
  return asPermissionCodes(rows.map((row) => row.code));
}

export type DelegationDenial =
  'MISSING_MANAGE_PERMISSION' | 'ROLE_EXCEEDS_OWN_PERMISSIONS' | 'ROLE_INACTIVE' | 'SELF_MODIFICATION';

/**
 * Design section 4.4: may `actorId` grant or change an assignment of `roleId` at `areaId` with
 * `scope`, using `managePermission` (assignment.manage or user.manage)?
 *  1. the actor holds `managePermission` over the area (over its whole subtree when the
 *     assignment includes descendants);
 *  2. every MANAGEMENT permission of the role is one the actor holds over that same area/subtree
 *     (no privilege escalation). Fieldwork permissions may be granted without being held
 *     (decision D11), so administrators who do not read child records can still provision
 *     field workers;
 *  3. the actor is not the assignment holder.
 */
export async function checkDelegation(
  db: Db,
  input: {
    actorId: string;
    targetUserId: string;
    areaId: string;
    roleId: string;
    scope: 'AREA_ONLY' | 'AREA_AND_DESCENDANTS';
    managePermission: PermissionCode;
    at: Date;
  },
): Promise<DelegationDenial | null> {
  if (input.actorId === input.targetUserId) return 'SELF_MODIFICATION';
  const wholeSubtree = input.scope === 'AREA_AND_DESCENDANTS';
  const held = await permissionsOverArea(db, input.actorId, input.areaId, input.at, wholeSubtree);
  if (!held.has(input.managePermission)) return 'MISSING_MANAGE_PERMISSION';

  const role = await db.role.findUnique({ where: { id: input.roleId }, select: { isActive: true } });
  if (!role?.isActive) return 'ROLE_INACTIVE';
  const granted = await rolePermissions(db, input.roleId);
  for (const permission of granted) {
    if (PERMISSION_DELEGATION[permission] === 'management' && !held.has(permission)) {
      return 'ROLE_EXCEEDS_OWN_PERMISSIONS';
    }
  }
  return null;
}

/**
 * Decision G: an actor may manage another user's ACCOUNT (status, password reset, sessions) only
 * if every current assignment of that user passes `checkDelegation` with `user.manage` - i.e.
 * the user sits entirely inside the actor's area and holds no more power there than the actor.
 * A user without current assignments is judged by all historical assignments; a user with no
 * assignments at all cannot be managed through the API.
 */
export async function canManageUser(
  db: Db,
  actorId: string,
  targetUserId: string,
  at: Date,
): Promise<boolean> {
  if (actorId === targetUserId) return false;
  const all = await db.workerAreaAssignment.findMany({
    where: { userId: targetUserId },
    select: { areaId: true, roleId: true, scope: true, status: true, effectiveTo: true },
  });
  const current = all.filter((a) => a.status !== 'REVOKED' && (a.effectiveTo === null || a.effectiveTo > at));
  const judged = current.length > 0 ? current : all;
  if (judged.length === 0) return false;

  for (const assignment of judged) {
    const denial = await checkDelegation(db, {
      actorId,
      targetUserId,
      areaId: assignment.areaId,
      roleId: assignment.roleId,
      scope: assignment.scope,
      managePermission: 'user.manage',
      at,
    });
    // An inactive role on the target's side grants nothing, so it never blocks management.
    if (denial && denial !== 'ROLE_INACTIVE') return false;
  }
  return true;
}

/** The caller's effective access, for the app to adapt its UI (never used for enforcement). */
export async function effectiveAccess(db: Db, userId: string, at: Date) {
  const assignments = await db.workerAreaAssignment.findMany({
    where: effectiveAssignmentWhere(userId, null, at),
    select: {
      id: true,
      scope: true,
      effectiveTo: true,
      area: { select: { id: true, nameEn: true, nameHi: true, level: { select: { code: true } } } },
      role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const permissions = new Set<string>();
  for (const a of assignments) for (const p of a.role.permissions) permissions.add(p.permission.code);
  return {
    permissions: [...asPermissionCodes(permissions)].sort(),
    assignments: assignments.map((a) => ({
      assignmentId: a.id,
      roleCode: a.role.code,
      scope: a.scope,
      areaId: a.area.id,
      areaName: a.area.nameEn,
      areaNameHi: a.area.nameHi,
      areaLevel: a.area.level.code,
      effectiveTo: a.effectiveTo?.toISOString() ?? null,
    })),
  };
}
