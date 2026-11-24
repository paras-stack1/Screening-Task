import { randomUUID } from 'node:crypto';
import type { ParentRefreshSession, Prisma, PrismaClient } from '@prisma/client';
import type { AuthConfig } from '../../config/security';
import { generateRefreshToken, hashRefreshToken } from '../../utils/token';
import { REVOCATION_REASONS, type RevocationReason } from '../auth/session.service';

/**
 * Parent refresh-token sessions (Step 8, PP9). The same rules as staff sessions
 * (src/modules/auth/session.service.ts), on the separate ParentRefreshSession table:
 * - one family per sign-in on one device (`sid` in the access token);
 * - every refresh rotates the token; the old row is revoked ROTATED -> replacedById;
 * - a just-rotated token presented again within the grace window whose replacement was never used
 *   gets a new token (lost response on a poor network); any other replay revokes the family;
 * - idle and absolute lifetimes; logout revokes the family immediately.
 */
type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export interface IssuedParentRefreshToken {
  refreshToken: string;
  expiresAt: Date;
  familyId: string;
  parentAccountId: string;
}

export async function createParentSessionFamily(
  db: Db,
  config: AuthConfig['refresh'],
  parentAccountId: string,
  deviceLabel: string | null,
  now: Date,
): Promise<IssuedParentRefreshToken> {
  const refreshToken = generateRefreshToken();
  const familyId = randomUUID();
  const expiresAt = new Date(now.getTime() + Math.min(config.idleTtlMs, config.absoluteTtlMs));
  await db.parentRefreshSession.create({
    data: {
      parentAccountId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      deviceLabel,
      expiresAt,
      createdAt: now,
    },
  });
  return { refreshToken, expiresAt, familyId, parentAccountId };
}

export type ParentRotationResult =
  | { kind: 'rotated'; issued: IssuedParentRefreshToken }
  | { kind: 'invalid' }
  | { kind: 'reuse_detected'; parentAccountId: string; familyId: string }
  | { kind: 'account_inactive'; parentAccountId: string; familyId: string };

class LostRotationRace extends Error {}
class LifetimeExceeded extends Error {}
const MAX_ATTEMPTS = 5;
const MAX_GRACE_CHAIN = 10;

export async function rotateParentRefreshToken(
  prisma: PrismaClient,
  config: AuthConfig['refresh'],
  presentedToken: string,
  now: Date,
): Promise<ParentRotationResult> {
  const tokenHash = hashRefreshToken(presentedToken);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => rotateOnce(tx, config, tokenHash, now));
    } catch (error) {
      if (error instanceof LostRotationRace && attempt < MAX_ATTEMPTS) continue;
      if (error instanceof LostRotationRace || error instanceof LifetimeExceeded) return { kind: 'invalid' };
      throw error;
    }
  }
}

async function rotateOnce(
  tx: Tx,
  config: AuthConfig['refresh'],
  tokenHash: string,
  now: Date,
): Promise<ParentRotationResult> {
  const row = await tx.parentRefreshSession.findUnique({
    where: { tokenHash },
    include: { parentAccount: { select: { status: true } } },
  });
  if (!row) return { kind: 'invalid' };
  if (row.revokedAt) return handleUsedToken(tx, config, row, now);
  if (row.expiresAt <= now) return { kind: 'invalid' };
  if (row.parentAccount.status !== 'ACTIVE') {
    await revokeParentFamily(tx, row.familyId, REVOCATION_REASONS.accountInactive, now);
    return { kind: 'account_inactive', parentAccountId: row.parentAccountId, familyId: row.familyId };
  }
  const claimed = await tx.parentRefreshSession.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: now, revokedReason: REVOCATION_REASONS.rotated, lastUsedAt: now },
  });
  if (claimed.count !== 1) throw new LostRotationRace();
  return { kind: 'rotated', issued: await issueSuccessor(tx, config, row, now) };
}

async function handleUsedToken(
  tx: Tx,
  config: AuthConfig['refresh'],
  row: ParentRefreshSession & { parentAccount: { status: string } },
  now: Date,
): Promise<ParentRotationResult> {
  const rotatedRecently =
    row.revokedReason === REVOCATION_REASONS.rotated &&
    row.revokedAt !== null &&
    now.getTime() - row.revokedAt.getTime() <= config.reuseGraceMs &&
    row.replacedById !== null;
  if (rotatedRecently && row.parentAccount.status === 'ACTIVE') {
    let nextId = row.replacedById;
    for (let hop = 0; nextId && hop < MAX_GRACE_CHAIN; hop += 1) {
      const successor = await tx.parentRefreshSession.findUnique({ where: { id: nextId } });
      if (!successor) break;
      if (successor.revokedAt === null) {
        if (successor.expiresAt <= now) break;
        const superseded = await tx.parentRefreshSession.updateMany({
          where: { id: successor.id, revokedAt: null },
          data: { revokedAt: now, revokedReason: REVOCATION_REASONS.superseded },
        });
        if (superseded.count !== 1) throw new LostRotationRace();
        return { kind: 'rotated', issued: await issueSuccessor(tx, config, successor, now) };
      }
      if (successor.revokedReason !== REVOCATION_REASONS.superseded) break;
      nextId = successor.replacedById;
    }
  }
  if (
    row.revokedReason === REVOCATION_REASONS.rotated ||
    row.revokedReason === REVOCATION_REASONS.superseded
  ) {
    await revokeParentFamily(tx, row.familyId, REVOCATION_REASONS.reuseDetected, now);
    return { kind: 'reuse_detected', parentAccountId: row.parentAccountId, familyId: row.familyId };
  }
  return { kind: 'invalid' };
}

async function issueSuccessor(
  tx: Tx,
  config: AuthConfig['refresh'],
  previous: ParentRefreshSession,
  now: Date,
): Promise<IssuedParentRefreshToken> {
  const first = await tx.parentRefreshSession.aggregate({
    where: { familyId: previous.familyId },
    _min: { createdAt: true },
  });
  const familyStart = first._min.createdAt ?? previous.createdAt;
  const expiresAt = new Date(
    Math.min(now.getTime() + config.idleTtlMs, familyStart.getTime() + config.absoluteTtlMs),
  );
  if (expiresAt <= now) throw new LifetimeExceeded();
  const refreshToken = generateRefreshToken();
  const next = await tx.parentRefreshSession.create({
    data: {
      parentAccountId: previous.parentAccountId,
      familyId: previous.familyId,
      tokenHash: hashRefreshToken(refreshToken),
      deviceLabel: previous.deviceLabel,
      expiresAt,
      createdAt: now,
    },
  });
  await tx.parentRefreshSession.update({ where: { id: previous.id }, data: { replacedById: next.id } });
  return { refreshToken, expiresAt, familyId: previous.familyId, parentAccountId: previous.parentAccountId };
}

export async function revokeParentFamily(db: Db, familyId: string, reason: RevocationReason, now: Date) {
  const result = await db.parentRefreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  return result.count;
}

export async function revokeAllParentSessions(
  db: Db,
  parentAccountId: string,
  reason: RevocationReason,
  now: Date,
  exceptFamilyId?: string,
) {
  const result = await db.parentRefreshSession.updateMany({
    where: { parentAccountId, revokedAt: null, ...(exceptFamilyId && { familyId: { not: exceptFamilyId } }) },
    data: { revokedAt: now, revokedReason: reason },
  });
  return result.count;
}

export function findParentFamilyByToken(db: Db, presentedToken: string) {
  return db.parentRefreshSession.findUnique({
    where: { tokenHash: hashRefreshToken(presentedToken) },
    select: { familyId: true, parentAccountId: true },
  });
}
