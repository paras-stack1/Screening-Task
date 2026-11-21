import type { AuditOutcome, Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * One audit event. `details` must contain identifiers and field names/values that are not
 * personal data - never child names, phone numbers or health details.
 */
export interface AuditEntry {
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  areaId?: string;
  outcome: AuditOutcome;
  requestId?: string;
  details?: Prisma.InputJsonValue;
}

/**
 * Appends to AuditLog (append-only at database level). Pass the transaction client when the
 * audited change happens in a transaction, so the change and its audit record commit together.
 */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({ data: entry });
}
