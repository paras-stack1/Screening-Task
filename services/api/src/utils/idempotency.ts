import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from './AppError';

/**
 * Safe retries for create operations (Step 5 decision H), using the existing SyncOperation table
 * (unique per user + clientOperationId).
 *
 * - First submission: a SyncOperation row is inserted at the START of the same transaction as the
 *   change. A concurrent duplicate blocks on the unique index until the first commits, then fails
 *   with P2002 and is answered as a replay.
 * - Retry after success: returns the stored entity id with `replayed: true`. The caller rebuilds
 *   the response AND re-checks access (the user may have lost it since).
 * - Same id with a different body or operation: 409 IDEMPOTENCY_KEY_REUSED (never silently applied).
 * - If the change fails, the SyncOperation row is rolled back with it, so the client may retry.
 *
 * Only identifiers and a request fingerprint are stored - never personal data.
 */
export interface IdempotencyKey {
  userId: string;
  clientOperationId: string;
  operationType: string;
  entityType: string;
  /** Validated request body; fingerprinted so a reused id with different content is detected. */
  request: unknown;
}

export interface IdempotentOutcome {
  entityId: string;
  replayed: boolean;
}

const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function runIdempotent(
  db: PrismaClient,
  key: IdempotencyKey,
  work: (tx: Prisma.TransactionClient) => Promise<string>,
): Promise<IdempotentOutcome> {
  const requestHash = fingerprint(key.request);

  const findApplied = async (): Promise<IdempotentOutcome | null> => {
    const existing = await db.syncOperation.findUnique({
      where: { userId_clientOperationId: { userId: key.userId, clientOperationId: key.clientOperationId } },
    });
    if (!existing) return null;
    const snapshot = existing.responseSnapshot as { requestHash?: string } | null;
    if (existing.operationType !== key.operationType || snapshot?.requestHash !== requestHash) {
      throw AppError.conflict(
        'IDEMPOTENCY_KEY_REUSED',
        'This submission id was already used for a different request. Start a new submission.',
      );
    }
    if (existing.status !== 'APPLIED' || !existing.entityId) {
      throw AppError.conflict(
        'OPERATION_IN_PROGRESS',
        'This submission is still being processed. Try again.',
      );
    }
    return { entityId: existing.entityId, replayed: true };
  };

  const earlier = await findApplied();
  if (earlier) return earlier;

  try {
    const entityId = await db.$transaction(async (tx) => {
      const op = await tx.syncOperation.create({
        data: {
          userId: key.userId,
          clientOperationId: key.clientOperationId,
          deviceId: 'worker-app',
          operationType: key.operationType,
          entityType: key.entityType,
          status: 'RECEIVED',
          responseSnapshot: { requestHash },
        },
      });
      const id = await work(tx);
      await tx.syncOperation.update({
        where: { id: op.id },
        data: { status: 'APPLIED', appliedAt: new Date(), entityId: id },
      });
      return id;
    }, TX_OPTIONS);
    return { entityId, replayed: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      error.meta?.modelName === 'SyncOperation'
    ) {
      const applied = await findApplied();
      if (applied) return applied;
    }
    throw error;
  }
}
