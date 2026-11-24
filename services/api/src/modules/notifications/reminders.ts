import { formatCalendarDate, OPEN_REVIEW_STATUSES, todayInIndia } from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { notify, usersWithPermissionOver, type NotificationInput } from './notifications.service';

/**
 * Notification builders shared by the API (after commit) and the reminder job (Step 7 decision S).
 * Recipients are decided from permissions over the child's CURRENT area at send time.
 */

/** "New review task" for the review of the CURRENT result of a screening. */
export async function reviewTaskNotifications(
  db: PrismaClient,
  sessionId: string,
  at: Date,
): Promise<NotificationInput[]> {
  const review = await db.clinicalReview.findFirst({
    where: { resultRun: { sessionId, supersededAt: null }, status: 'PENDING_REVIEW' },
    select: {
      id: true,
      resultRun: { select: { session: { select: { child: { select: { areaId: true } } } } } },
    },
  });
  if (!review) return [];
  const users = await usersWithPermissionOver(
    db,
    review.resultRun.session.child.areaId,
    'screening.review',
    at,
  );
  return users.map((userId) => ({
    userId,
    type: 'REVIEW_TASK_NEW',
    entityType: 'clinicalReview',
    entityId: review.id,
    dedupeKey: `REVIEW_TASK_NEW:${review.id}`,
  }));
}

export interface ReminderOptions {
  /** Review time limit in hours; undefined = no review-overdue reminders (decision S: off by default). */
  reviewOverdueHours?: number;
  /** Max records handled per kind per run. */
  batch?: number;
}

/**
 * One reminder run. Idempotent (dedupe keys): running it twice, or every few minutes, never
 * creates duplicates. Due soon = due today or tomorrow (India dates; operational assumption).
 */
export async function runReminders(db: PrismaClient, now: Date, options: ReminderOptions = {}) {
  const batch = options.batch ?? 500;
  const today = new Date(`${formatCalendarDate(todayInIndia(now))}T00:00:00Z`);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const open = ['ASSIGNED', 'IN_PROGRESS'] as const;
  const counts = { dueSoon: 0, overdue: 0, reviewNew: 0, reviewOverdue: 0 };

  const tasks = await db.followUp.findMany({
    where: { status: { in: [...open] }, assignedToId: { not: null }, dueDate: { lte: tomorrow } },
    select: { id: true, assignedToId: true, dueDate: true },
    orderBy: { dueDate: 'asc' },
    take: batch,
  });
  const items: NotificationInput[] = tasks.map((t) => {
    const late = t.dueDate.getTime() < today.getTime();
    const type = late ? 'FOLLOW_UP_OVERDUE' : 'FOLLOW_UP_DUE_SOON';
    return {
      userId: t.assignedToId!,
      type,
      entityType: 'followUp',
      entityId: t.id,
      dedupeKey: `${type}:${t.id}:${t.dueDate.toISOString().slice(0, 10)}`,
    };
  });
  counts.overdue = await notify(
    db,
    items.filter((i) => i.type === 'FOLLOW_UP_OVERDUE'),
  );
  counts.dueSoon = await notify(
    db,
    items.filter((i) => i.type === 'FOLLOW_UP_DUE_SOON'),
  );

  // Catch-up for review tasks whose after-commit notification failed (dedupe prevents repeats).
  const pending = await db.clinicalReview.findMany({
    where: { status: 'PENDING_REVIEW', resultRun: { supersededAt: null } },
    select: { resultRun: { select: { sessionId: true } } },
    orderBy: { createdAt: 'asc' },
    take: batch,
  });
  for (const p of pending)
    counts.reviewNew += await notify(db, await reviewTaskNotifications(db, p.resultRun.sessionId, now));

  if (options.reviewOverdueHours && options.reviewOverdueHours > 0) {
    const limit = new Date(now.getTime() - options.reviewOverdueHours * 3_600_000);
    const late = await db.clinicalReview.findMany({
      where: {
        status: { in: [...OPEN_REVIEW_STATUSES] },
        resultRun: { supersededAt: null },
        createdAt: { lt: limit },
      },
      select: {
        id: true,
        resultRun: { select: { session: { select: { child: { select: { areaId: true } } } } } },
      },
      take: batch,
    });
    for (const r of late) {
      const users = await usersWithPermissionOver(
        db,
        r.resultRun.session.child.areaId,
        'screening.review',
        now,
      );
      counts.reviewOverdue += await notify(
        db,
        users.map((userId) => ({
          userId,
          type: 'REVIEW_OVERDUE',
          entityType: 'clinicalReview',
          entityId: r.id,
          dedupeKey: `REVIEW_OVERDUE:${r.id}`,
        })),
      );
    }
  }
  return counts;
}
