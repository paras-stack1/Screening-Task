import type { PrismaClient } from '@prisma/client';
import { generateTemporaryPassword, hashPassword } from '../../utils/password';
import { recordAudit } from '../audit/audit.service';
import { LOGIN_ID_PATTERN, normalizeLoginId } from '../auth/loginId';

/**
 * Creates the FIRST administrator: a `roleCode` (default STATE_ADMIN) assignment at the root area
 * with AREA_AND_DESCENDANTS scope (design 4.1: no special "global" users). Run once by an
 * operator from the server, never through the API.
 *
 * Refuses when an ACTIVE user already holds user.manage at the root, so it cannot be used to
 * mint extra administrators later.
 */
export async function bootstrapAdmin(
  db: PrismaClient,
  input: { loginId: string; displayName: string; roleCode?: string; now?: Date },
): Promise<{ userId: string; loginId: string; temporaryPassword: string }> {
  const at = input.now ?? new Date();
  const loginId = normalizeLoginId(input.loginId);
  if (!LOGIN_ID_PATTERN.test(loginId)) throw new Error('Invalid login ID format');
  if (input.displayName.trim().length < 2) throw new Error('Display name is required');

  const root = await db.area.findFirst({ where: { parentId: null }, select: { id: true } });
  if (!root) throw new Error('No root area exists. Run the seed (npm run db:seed) first.');

  const roleCode = input.roleCode ?? 'STATE_ADMIN';
  const role = await db.role.findUnique({
    where: { code: roleCode },
    select: { id: true, isActive: true, permissions: { select: { permission: { select: { code: true } } } } },
  });
  if (!role?.isActive) throw new Error(`Role ${roleCode} does not exist or is inactive`);
  if (!role.permissions.some((p) => p.permission.code === 'user.manage')) {
    throw new Error(`Role ${roleCode} does not grant user.manage`);
  }

  // Any user (not one specific user) with an effective user.manage assignment at the root.
  const existingAdmin = await db.workerAreaAssignment.findFirst({
    where: {
      areaId: root.id,
      status: 'ACTIVE',
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      user: { status: 'ACTIVE' },
      role: { isActive: true, permissions: { some: { permission: { code: 'user.manage' } } } },
    },
    select: { id: true },
  });
  if (existingAdmin) {
    throw new Error('An active root administrator already exists. Use the API to create further accounts.');
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { loginId, displayName: input.displayName.trim(), passwordHash, mustChangePassword: true },
    });
    const assignment = await tx.workerAreaAssignment.create({
      data: {
        userId: created.id,
        areaId: root.id,
        roleId: role.id,
        scope: 'AREA_AND_DESCENDANTS',
        effectiveFrom: at,
        reason: 'Initial administrator (bootstrap)',
        createdById: created.id,
      },
    });
    await recordAudit(tx, {
      actorUserId: created.id,
      action: 'user.bootstrap_admin',
      entityType: 'User',
      entityId: created.id,
      areaId: root.id,
      outcome: 'SUCCESS',
      details: { assignmentId: assignment.id, roleCode },
    });
    return created;
  });
  return { userId: user.id, loginId, temporaryPassword };
}
