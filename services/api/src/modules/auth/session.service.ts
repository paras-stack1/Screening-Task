import { randomUUID } from 'node:crypto';
import type { PrismaClient, RefreshSession } from '@prisma/client';
import type { Db } from '../../config/database';
import type { AuthConfig } from '../../config/security';
import { generateRefreshToken, hashRefreshToken } from '../../utils/token';

/**
 * Refresh-token sessions (docs/authentication.md, "Session lifecycle").
 *
 * Terms:
 * - A *session family* (familyId) is one sign-in on one device. Access tokens carry it as `sid`.
 * - Each refresh creates a new RefreshSession row in the family and marks the previous row
 *   revoked with reason ROTATED (replacedById -> new row).
 * - The family is *active* while it has a row with revokedAt = null that has not expired.
 *   There is at most one such row per family.
 */
export const REVOCATION_REASONS = {
  rotated: 'ROTATED',
  superseded: 'SUPERSEDED',
  reuseDetected: 'REUSE_DETECTED',
  logout: 'LOGOUT',
  logoutAll: 'LOGOUT_ALL',
  sessionRevoked: 'SESSION_REVOKED',
  passwordChanged: 'PASSWORD_CHANGED',
  accountInactive: 'ACCOUNT_INACTIVE',
  /** An administrator revoked the user's sessions or reset their password. */
  adminRevoked: 'ADMIN_REVOKED',
  passwordReset: 'PASSWORD_RESET',
} as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[keyof typeof REVOCATION_REASONS];

export interface IssuedRefreshToken {
  refreshToken: string;
  expiresAt: Date;
  familyId: string;
  userId: string;
}

/** Starts a new session family (login, or a fresh session after a password change). */
export async function createSessionFamily(
  db: Db,
  config: AuthConfig['refresh'],
  userId: string,
  deviceLabel: string | null,
  now: Date,
): Promise<IssuedRefreshToken> {
  const refreshToken = generateRefreshToken();
  const familyId = randomUUID();
  const expiresAt = new Date(now.getTime() + Math.min(config.idleTtlMs, config.absoluteTtlMs));
  await db.refreshSession.create({
    data: {
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      deviceLabel,
      expiresAt,
      createdAt: now,
    },
  });
  return { refreshToken, expiresAt, familyId, userId };
}

export type RotationResult =
  | { kind: 'rotated'; issued: IssuedRefreshToken }
  /** Unknown, expired or already logged-out token: plain 401, nothing else to do. */
  | { kind: 'invalid' }
  /** An old token was replayed: the family has been revoked. */
  | { kind: 'reuse_detected'; userId: string; familyId: string }
  /** The account is no longer ACTIVE: the family has been revoked. */
  | { kind: 'account_inactive'; userId: string; familyId: string };

/** Thrown inside the transaction when a concurrent request rotated the same row first. */
class LostRotationRace extends Error {}

/** Retries after losing a race to a concurrent duplicate of the same request. */
const MAX_ROTATION_ATTEMPTS = 5;
/** Upper bound on superseded replacements followed in the grace window. */
const MAX_GRACE_CHAIN = 10;

/**
 * Validates a refresh token and rotates it. All writes for one attempt happen in one
 * transaction. Two concurrent requests with the same token cannot both rotate it: the claim is a
 * conditional UPDATE (`revokedAt IS NULL`), which PostgreSQL serialises on the row lock. The
 * loser retries once, now sees the row as just-rotated, and goes through the reuse rules.
 */
export async function rotateRefreshToken(
  prisma: PrismaClient,
  config: AuthConfig['refresh'],
  presentedToken: string,
  now: Date,
): Promise<RotationResult> {
  const tokenHash = hashRefreshToken(presentedToken);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => rotateOnce(tx, config, tokenHash, now));
    } catch (error) {
      if (error instanceof LostRotationRace && attempt < MAX_ROTATION_ATTEMPTS) continue;
      if (error instanceof LostRotationRace || error instanceof SessionLifetimeExceeded) {
        return { kind: 'invalid' };
      }
      throw error;
    }
  }
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function rotateOnce(
  tx: Tx,
  config: AuthConfig['refresh'],
  tokenHash: string,
  now: Date,
): Promise<RotationResult> {
  const row = await tx.refreshSession.findUnique({
    where: { tokenHash },
    include: { user: { select: { status: true } } },
  });
  if (!row) return { kind: 'invalid' };

  if (row.revokedAt) return handleUsedToken(tx, config, row, now);

  if (row.expiresAt <= now) return { kind: 'invalid' };

  if (row.user.status !== 'ACTIVE') {
    await revokeFamily(tx, row.familyId, REVOCATION_REASONS.accountInactive, now);
    return { kind: 'account_inactive', userId: row.userId, familyId: row.familyId };
  }

  // Claim the row. If another request claimed it first, count = 0: retry from the top.
  const claimed = await tx.refreshSession.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: now, revokedReason: REVOCATION_REASONS.rotated, lastUsedAt: now },
  });
  if (claimed.count !== 1) throw new LostRotationRace();

  const issued = await issueSuccessor(tx, config, row, now);
  return { kind: 'rotated', issued };
}

/**
 * A token that has already been used or revoked was presented.
 * - ROTATED within the grace window, and its replacement never used: the client probably lost
 *   the previous response. Supersede the unused replacement and issue a new token (decision B).
 * - ROTATED or SUPERSEDED otherwise: replay of an old token - possible theft. Revoke the family.
 * - Any other reason (logout, password change...): the family is already revoked. Plain 401.
 */
async function handleUsedToken(
  tx: Tx,
  config: AuthConfig['refresh'],
  row: RefreshSession & { user: { status: string } },
  now: Date,
): Promise<RotationResult> {
  const rotatedRecently =
    row.revokedReason === REVOCATION_REASONS.rotated &&
    row.revokedAt !== null &&
    now.getTime() - row.revokedAt.getTime() <= config.reuseGraceMs &&
    row.replacedById !== null;

  if (rotatedRecently && row.user.status === 'ACTIVE') {
    // Walk forward past replacements that were superseded (issued but never used by the client)
    // to the family's current token. If any replacement was actually used (ROTATED), stop:
    // that is a genuine replay.
    let nextId = row.replacedById;
    for (let hop = 0; nextId && hop < MAX_GRACE_CHAIN; hop += 1) {
      const successor = await tx.refreshSession.findUnique({ where: { id: nextId } });
      if (!successor) break;
      if (successor.revokedAt === null) {
        if (successor.expiresAt <= now) break;
        const superseded = await tx.refreshSession.updateMany({
          where: { id: successor.id, revokedAt: null },
          data: { revokedAt: now, revokedReason: REVOCATION_REASONS.superseded },
        });
        // A concurrent duplicate superseded it first: retry and follow the chain again.
        if (superseded.count !== 1) throw new LostRotationRace();
        const issued = await issueSuccessor(tx, config, successor, now);
        return { kind: 'rotated', issued };
      }
      if (successor.revokedReason !== REVOCATION_REASONS.superseded) break;
      nextId = successor.replacedById;
    }
  }

  if (
    row.revokedReason === REVOCATION_REASONS.rotated ||
    row.revokedReason === REVOCATION_REASONS.superseded
  ) {
    await revokeFamily(tx, row.familyId, REVOCATION_REASONS.reuseDetected, now);
    return { kind: 'reuse_detected', userId: row.userId, familyId: row.familyId };
  }
  return { kind: 'invalid' };
}

/** Creates the next token of a family and links the previous row to it. */
async function issueSuccessor(
  tx: Tx,
  config: AuthConfig['refresh'],
  previous: RefreshSession,
  now: Date,
): Promise<IssuedRefreshToken> {
  // The absolute limit counts from the family's first row (the original sign-in).
  const first = await tx.refreshSession.aggregate({
    where: { familyId: previous.familyId },
    _min: { createdAt: true },
  });
  const familyStart = first._min.createdAt ?? previous.createdAt;
  const expiresAt = new Date(
    Math.min(now.getTime() + config.idleTtlMs, familyStart.getTime() + config.absoluteTtlMs),
  );
  if (expiresAt <= now) {
    // Absolute lifetime reached. The caller sees an ordinary expired session.
    throw new SessionLifetimeExceeded();
  }

  const refreshToken = generateRefreshToken();
  const next = await tx.refreshSession.create({
    data: {
      userId: previous.userId,
      familyId: previous.familyId,
      tokenHash: hashRefreshToken(refreshToken),
      deviceLabel: previous.deviceLabel,
      expiresAt,
      createdAt: now,
    },
  });
  await tx.refreshSession.update({ where: { id: previous.id }, data: { replacedById: next.id } });
  return { refreshToken, expiresAt, familyId: previous.familyId, userId: previous.userId };
}

/** Thrown when a family has passed its absolute lifetime; mapped to `invalid` by the caller. */
export class SessionLifetimeExceeded extends Error {}

/** Revokes every still-active row of one family. Returns the number of rows revoked. */
export async function revokeFamily(db: Db, familyId: string, reason: RevocationReason, now: Date) {
  const result = await db.refreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  return result.count;
}

/** Revokes every active session of a user (logout everywhere, password change, account disabled). */
export async function revokeAllUserSessions(db: Db, userId: string, reason: RevocationReason, now: Date) {
  const result = await db.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  return result.count;
}

/** True when the family has a current, unexpired row - checked on every authenticated request. */
export async function isFamilyActive(db: Db, userId: string, familyId: string, now: Date): Promise<boolean> {
  const row = await db.refreshSession.findFirst({
    where: { userId, familyId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  });
  return row !== null;
}

/** Finds the family of a presented token in any state (used by logout). */
export function findFamilyByToken(db: Db, presentedToken: string) {
  return db.refreshSession.findUnique({
    where: { tokenHash: hashRefreshToken(presentedToken) },
    select: { familyId: true, userId: true },
  });
}

/** The user's active sessions, one entry per family. */
export function listActiveSessions(db: Db, userId: string, now: Date) {
  return db.refreshSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    select: { familyId: true, deviceLabel: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
}
