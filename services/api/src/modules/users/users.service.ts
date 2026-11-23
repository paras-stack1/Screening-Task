import type {
  ChangeUserStatusRequest,
  CreateUserRequest,
  UserListQuery,
  UserListResponse,
  UserView,
} from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient, type User } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { generateTemporaryPassword, hashPassword } from '../../utils/password';
import { areaScopeWhere } from '../access-control/accessScope';
import { canManageUser, checkDelegation } from '../access-control/authorization.service';
import { recordAudit } from '../audit/audit.service';
import { LOGIN_ID_PATTERN, normalizeLoginId } from '../auth/loginId';
import { revokeAllUserSessions, REVOCATION_REASONS } from '../auth/session.service';
import {
  assignmentViewSelect,
  denyAdmin,
  insertAssignment,
  toAssignmentView,
  type AdminContext,
} from './assignments.service';

/**
 * Account administration (decision G). Only holders of `user.manage` reach these functions
 * (route gate); each operation then checks that the TARGET user lies entirely within the
 * actor's scope (`canManageUser`). Out-of-scope targets look like unknown users (404).
 */
export function toUserView(user: User): UserView {
  return {
    id: user.id,
    loginId: user.loginId,
    displayName: user.displayName,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export function createUsersService(db: PrismaClient) {
  async function loadManageableUser(ctx: AdminContext, userId: string, action: string): Promise<User> {
    if (userId === ctx.actorId) {
      throw await denyAdmin(db, ctx, action, 'User', userId, 'SELF_MODIFICATION');
    }
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || !(await canManageUser(db, ctx.actorId, userId, ctx.at))) {
      await denyAdmin(db, ctx, action, 'User', user ? userId : undefined, 'OUT_OF_SCOPE');
      throw AppError.notFound('User not found');
    }
    return user;
  }

  return {
    /** Users with a current assignment inside the actor's user.manage areas (never the actor). */
    async list(ctx: AdminContext, query: UserListQuery): Promise<UserListResponse> {
      // Current assignments inside the actor's user.manage areas (used to find AND to show).
      const currentInScope: Prisma.WorkerAreaAssignmentWhereInput = {
        status: { not: 'REVOKED' },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: ctx.at } }],
        area: areaScopeWhere(ctx.actorId, 'user.manage', ctx.at),
      };
      const where: Prisma.UserWhereInput = {
        AND: [
          { id: { not: ctx.actorId } },
          { assignmentsHeld: { some: currentInScope } },
          query.status ? { status: query.status } : {},
          query.search
            ? {
                OR: [
                  { loginId: { contains: normalizeLoginId(query.search) } },
                  { displayName: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      };
      const [rows, total] = await Promise.all([
        db.user.findMany({
          where,
          include: {
            assignmentsHeld: {
              where: currentInScope,
              select: {
                status: true,
                role: { select: { code: true } },
                area: { select: { nameEn: true, nameHi: true } },
              },
              orderBy: { effectiveFrom: 'asc' },
            },
          },
          orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.user.count({ where }),
      ]);
      return {
        items: rows.map(({ assignmentsHeld, ...user }) => ({
          ...toUserView(user),
          currentAssignments: assignmentsHeld.map((a) => ({
            roleCode: a.role.code,
            areaName: a.area.nameEn,
            areaNameHi: a.area.nameHi,
            // REVOKED rows are filtered out above.
            status: a.status as 'ACTIVE' | 'SUSPENDED',
          })),
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },

    async get(ctx: AdminContext, userId: string) {
      const user = await loadManageableUser(ctx, userId, 'user.denied');
      const assignments = await db.workerAreaAssignment.findMany({
        where: { userId },
        select: assignmentViewSelect,
        orderBy: { effectiveFrom: 'desc' },
      });
      return { user: toUserView(user), assignments: assignments.map(toAssignmentView) };
    },

    /**
     * Creates an account together with its first assignment, in one transaction. The actor needs
     * user.manage AND assignment.manage over the area, and may only grant a role within their
     * own permissions there. Returns a one-time temporary password.
     */
    async create(ctx: AdminContext, input: CreateUserRequest) {
      const loginId = normalizeLoginId(input.loginId);
      if (!LOGIN_ID_PATTERN.test(loginId)) {
        throw AppError.badRequest('Login ID must be 3-64 characters: letters, digits, ".", "_" or "-"');
      }
      // user.manage over the area is required in addition to assignment.manage (checked below).
      const userManage = await checkDelegation(db, {
        actorId: ctx.actorId,
        targetUserId: 'new-account',
        areaId: input.assignment.areaId,
        roleId: input.assignment.roleId,
        scope: input.assignment.scope,
        managePermission: 'user.manage',
        at: ctx.at,
      });
      if (userManage) throw await denyAdmin(db, ctx, 'user.denied', 'User', undefined, userManage);

      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      try {
        const user = await db.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              loginId,
              displayName: input.displayName,
              preferredLanguage: input.preferredLanguage ?? 'hi',
              passwordHash,
              status: 'ACTIVE',
              mustChangePassword: true,
            },
          });
          const assignment = await insertAssignment(
            tx,
            db,
            ctx,
            created.id,
            input.assignment,
            'assignment.manage',
          );
          await recordAudit(tx, {
            actorUserId: ctx.actorId,
            action: 'user.created',
            entityType: 'User',
            entityId: created.id,
            areaId: assignment.areaId,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            details: { assignmentId: assignment.id, roleId: assignment.roleId, scope: assignment.scope },
          });
          await recordAudit(tx, {
            actorUserId: ctx.actorId,
            action: 'assignment.created',
            entityType: 'WorkerAreaAssignment',
            entityId: assignment.id,
            areaId: assignment.areaId,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            details: {
              userId: created.id,
              areaId: assignment.areaId,
              roleId: assignment.roleId,
              scope: assignment.scope,
              effectiveFrom: assignment.effectiveFrom.toISOString(),
              effectiveTo: assignment.effectiveTo?.toISOString() ?? null,
              reason: assignment.reason,
            },
          });
          return created;
        });
        return { user: toUserView(user), temporaryPassword };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AppError(409, 'LOGIN_ID_TAKEN', 'This login ID is already in use');
        }
        throw error;
      }
    },

    /**
     * ACTIVE <-> SUSPENDED, or -> DEACTIVATED (permanent). Leaving ACTIVE revokes every session
     * at once; the account's tokens stop working on the next request.
     */
    async changeStatus(ctx: AdminContext, userId: string, input: ChangeUserStatusRequest) {
      const user = await loadManageableUser(ctx, userId, 'user.denied');
      if (user.status === 'DEACTIVATED') {
        throw new AppError(409, 'INVALID_TRANSITION', 'A deactivated account cannot be changed');
      }
      if (user.status === input.status) return toUserView(user);

      const updated = await db.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
          where: { id: userId, status: user.status },
          data: { status: input.status },
        });
        if (changed.count !== 1)
          throw new AppError(409, 'CONCURRENT_CHANGE', 'Account changed meanwhile; reload');
        const revoked =
          input.status === 'ACTIVE'
            ? 0
            : await revokeAllUserSessions(tx, userId, REVOCATION_REASONS.accountInactive, ctx.at);
        await recordAudit(tx, {
          actorUserId: ctx.actorId,
          action: 'user.status_changed',
          entityType: 'User',
          entityId: userId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: {
            previousStatus: user.status,
            status: input.status,
            reason: input.reason,
            sessionsRevoked: revoked,
          },
        });
        return tx.user.findUniqueOrThrow({ where: { id: userId } });
      });
      return toUserView(updated);
    },

    /** Admin-assisted reset (no SMS/email channel): new one-time password, all sessions revoked. */
    async resetPassword(ctx: AdminContext, userId: string, reason: string) {
      const user = await loadManageableUser(ctx, userId, 'user.denied');
      if (user.status === 'DEACTIVATED')
        throw new AppError(409, 'INVALID_TRANSITION', 'Account is deactivated');
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const updated = await db.$transaction(async (tx) => {
        const saved = await tx.user.update({
          where: { id: userId },
          data: {
            passwordHash,
            mustChangePassword: true,
            failedLoginCount: 0,
            lockedUntil: null,
            passwordChangedAt: ctx.at,
          },
        });
        const revoked = await revokeAllUserSessions(tx, userId, REVOCATION_REASONS.passwordReset, ctx.at);
        await recordAudit(tx, {
          actorUserId: ctx.actorId,
          action: 'user.password_reset',
          entityType: 'User',
          entityId: userId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: { reason, sessionsRevoked: revoked },
        });
        return saved;
      });
      return { user: toUserView(updated), temporaryPassword };
    },

    async revokeSessions(ctx: AdminContext, userId: string, reason: string): Promise<void> {
      await loadManageableUser(ctx, userId, 'user.denied');
      await db.$transaction(async (tx) => {
        const revoked = await revokeAllUserSessions(tx, userId, REVOCATION_REASONS.adminRevoked, ctx.at);
        await recordAudit(tx, {
          actorUserId: ctx.actorId,
          action: 'user.sessions_revoked',
          entityType: 'User',
          entityId: userId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: { reason, sessionsRevoked: revoked },
        });
      });
    },

    /** Active roles and their permissions, for the assignment form. */
    async listRoles() {
      const roles = await db.role.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameHi: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
        orderBy: { code: 'asc' },
      });
      return {
        roles: roles.map((r) => ({
          id: r.id,
          code: r.code,
          nameEn: r.nameEn,
          nameHi: r.nameHi,
          permissions: r.permissions.map((p) => p.permission.code).sort(),
        })),
      };
    },
  };
}
