import type {
  AppNotification,
  NotificationListQuery,
  NotificationListResponse,
} from '@balswasthya/shared-contracts';
import type { NotificationType, PrismaClient } from '@prisma/client';
import type { Db } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { assignmentCoversAreaWhere, effectiveAssignmentWhere } from '../access-control/accessScope';
import type { PermissionCode } from '../access-control/permissions';

/**
 * In-app notifications (Step 7 decision S). No push, SMS or e-mail. A notification holds the type
 * and the id of the record only - the app shows generic translated text ("A referral was
 * updated") and loads details through the normal, permission-checked API.
 *
 * `dedupeKey` (unique) makes every send idempotent: a retried request or a second reminder run
 * never creates a second copy.
 */
export interface NotificationInput {
  userId: string;
  type: NotificationType;
  entityType: 'clinicalReview' | 'referral' | 'followUp' | 'system';
  entityId: string;
  /** Unique per (event, recipient); the recipient is appended automatically. */
  dedupeKey: string;
}

export async function notify(db: Db, items: readonly NotificationInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const result = await db.notification.createMany({
    data: items.map((n) => ({
      userId: n.userId,
      type: n.type,
      entityType: n.entityType,
      entityId: n.entityId,
      dedupeKey: `${n.dedupeKey}:${n.userId}`,
      payload: { entityType: n.entityType, entityId: n.entityId },
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Sends notifications AFTER the change they describe has committed. A failure is logged (ids
 * only) and never undoes or fails the committed change (Step 7 brief section 24); the reminder job
 * and dedupe keys make a later retry safe.
 */
export async function notifyAfterCommit(
  db: PrismaClient,
  build: () => Promise<readonly NotificationInput[]>,
): Promise<void> {
  try {
    await notify(db, await build());
  } catch (error) {
    logger.error('notification_failed', { reason: error instanceof Error ? error.name : 'unknown' });
  }
}

/** Active users holding `permission` over `areaId` right now (recipients of task notifications). */
export async function usersWithPermissionOver(
  db: Db,
  areaId: string,
  permission: PermissionCode,
  at: Date,
): Promise<string[]> {
  const rows = await db.workerAreaAssignment.findMany({
    where: {
      ...effectiveAssignmentWhere('', permission, at, assignmentCoversAreaWhere(areaId)),
      userId: undefined,
    },
    select: { userId: true },
    distinct: ['userId'],
    take: 200,
  });
  return rows.map((r) => r.userId);
}

const toDto = (n: {
  id: string;
  type: NotificationType;
  entityType: string;
  entityId: string;
  createdAt: Date;
  readAt: Date | null;
}): AppNotification => ({
  id: n.id,
  type: n.type,
  entityType: n.entityType as AppNotification['entityType'],
  entityId: n.entityId,
  createdAt: n.createdAt.toISOString(),
  readAt: n.readAt?.toISOString() ?? null,
});

/** A user's own notifications only (no other permission involved). */
export function createNotificationsService({ db }: { db: PrismaClient }) {
  return {
    async list(userId: string, query: NotificationListQuery): Promise<NotificationListResponse> {
      const where = { userId, ...(query.unreadOnly === 'true' && { readAt: null }) };
      const [rows, total, unread] = await Promise.all([
        db.notification.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.notification.count({ where }),
        db.notification.count({ where: { userId, readAt: null } }),
      ]);
      return { items: rows.map(toDto), unread, page: query.page, pageSize: query.pageSize, total };
    },

    /** Idempotent: an already read notification stays as it was. Another user's -> 404. */
    async markRead(userId: string, id: string, at: Date): Promise<AppNotification> {
      const row = await db.notification.findFirst({ where: { id, userId } });
      if (!row) throw AppError.notFound('Notification not found');
      if (row.readAt) return toDto(row);
      await db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: at } });
      return toDto(await db.notification.findUniqueOrThrow({ where: { id } }));
    },
  };
}
