/**
 * Reminder run (Step 7 decision S): follow-ups due soon / overdue, catch-up of new review tasks
 * and - only when REVIEW_OVERDUE_HOURS is set - overdue reviews. In-app notifications only.
 *
 *   npm run jobs:reminders
 *
 * Schedule it on the server (cron / Windows Task Scheduler), e.g. every 30 minutes. It is
 * idempotent: repeated runs never create duplicate notifications. It prints counts only.
 */
import { PrismaClient } from '@prisma/client';
import { runReminders } from '../src/modules/notifications/reminders';

async function main() {
  const raw = process.env.REVIEW_OVERDUE_HOURS;
  const reviewOverdueHours = raw ? Number(raw) : undefined;
  if (raw && (!Number.isInteger(reviewOverdueHours) || reviewOverdueHours! < 1)) {
    throw new Error('REVIEW_OVERDUE_HOURS must be a whole number of hours (or unset)');
  }
  const prisma = new PrismaClient();
  try {
    const counts = await runReminders(prisma, new Date(), { reviewOverdueHours });
    // eslint-disable-next-line no-console
    console.log('Reminders sent:', counts);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Reminder run failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
