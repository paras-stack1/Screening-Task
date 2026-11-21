import type {
  AuthTokensResponse,
  AuthUser,
  MeResponse,
  SessionListResponse,
} from '@balswasthya/shared-contracts';
import { AUTH_ERROR_CODES } from '@balswasthya/shared-contracts';
import type { PrismaClient, User } from '@prisma/client';
import type { AuthConfig } from '../../config/security';
import { AppError } from '../../utils/AppError';
import { signAccessToken } from '../../utils/jwt';
import {
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_POLICY_MESSAGES,
  passwordNeedsRehash,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../../utils/password';
import { effectiveAccess } from '../access-control/authorization.service';
import { recordAudit } from '../audit/audit.service';
import { normalizeLoginId } from './loginId';
import {
  createSessionFamily,
  findFamilyByToken,
  listActiveSessions,
  revokeAllUserSessions,
  revokeFamily,
  REVOCATION_REASONS,
  rotateRefreshToken,
  type IssuedRefreshToken,
} from './session.service';

/** The authenticated caller, set by the `authenticate` middleware. */
export interface AuthContext {
  userId: string;
  /** Session family id (`sid` claim). */
  sessionId: string;
  mustChangePassword: boolean;
}

export interface RequestMeta {
  requestId?: string;
}

export interface AuthServiceDependencies {
  db: PrismaClient;
  config: AuthConfig;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/** Deliberately identical for unknown account, wrong password, locked and inactive accounts. */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials or account unavailable.';
const invalidCredentials = () =>
  AppError.unauthorized(AUTH_ERROR_CODES.invalidCredentials, INVALID_CREDENTIALS_MESSAGE);
const sessionExpired = () =>
  AppError.unauthorized(AUTH_ERROR_CODES.sessionExpired, 'Session expired. Please sign in again.');

function toAuthUser(
  user: Pick<User, 'id' | 'displayName' | 'preferredLanguage' | 'mustChangePassword'>,
): AuthUser {
  return {
    id: user.id,
    displayName: user.displayName,
    preferredLanguage: user.preferredLanguage,
    mustChangePassword: user.mustChangePassword,
  };
}

export function createAuthService({ db, config, now = () => new Date() }: AuthServiceDependencies) {
  async function tokensFor(
    user: Pick<User, 'id' | 'displayName' | 'preferredLanguage' | 'mustChangePassword'>,
    issued: IssuedRefreshToken,
    at: Date,
  ): Promise<AuthTokensResponse> {
    const access = await signAccessToken(config.jwt, { userId: user.id, sessionId: issued.familyId }, at);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: issued.refreshToken,
      refreshTokenExpiresAt: issued.expiresAt.toISOString(),
      user: toAuthUser(user),
    };
  }

  /** Counts a failed password and applies a temporary, doubling lock (never permanent). */
  async function registerFailedLogin(userId: string, at: Date): Promise<boolean> {
    const { failedLoginCount } = await db.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const { maxFailedAttempts, lockoutBaseMs, lockoutMaxMs } = config.login;
    if (failedLoginCount < maxFailedAttempts) return false;
    const lockMs = Math.min(lockoutBaseMs * 2 ** (failedLoginCount - maxFailedAttempts), lockoutMaxMs);
    await db.user.update({ where: { id: userId }, data: { lockedUntil: new Date(at.getTime() + lockMs) } });
    return true;
  }

  async function auditLogin(
    meta: RequestMeta,
    outcome: 'SUCCESS' | 'FAILED' | 'DENIED',
    reason: string,
    userId?: string,
  ) {
    await recordAudit(db, {
      actorUserId: userId,
      action: 'auth.login',
      entityType: 'User',
      entityId: userId,
      outcome,
      requestId: meta.requestId,
      details: { reason },
    });
  }

  return {
    /**
     * Exactly one Argon2 verification runs for every attempt (a dummy one for unknown accounts),
     * so timing does not reveal whether a login ID exists or is locked.
     */
    async login(
      input: { loginId: string; password: string; deviceLabel?: string },
      meta: RequestMeta,
    ): Promise<AuthTokensResponse> {
      const at = now();
      const user = await db.user.findUnique({ where: { loginId: normalizeLoginId(input.loginId) } });

      if (!user) {
        await verifyAgainstDummyHash(input.password);
        await auditLogin(meta, 'FAILED', 'UNKNOWN_ACCOUNT');
        throw invalidCredentials();
      }

      const passwordOk = await verifyPassword(user.passwordHash, input.password);

      if (user.lockedUntil && user.lockedUntil > at) {
        // Attempts during a lock do not extend it (limits lock-out abuse by third parties).
        await auditLogin(meta, 'DENIED', 'ACCOUNT_LOCKED', user.id);
        throw invalidCredentials();
      }
      if (!passwordOk) {
        const locked = await registerFailedLogin(user.id, at);
        await auditLogin(meta, 'FAILED', locked ? 'BAD_PASSWORD_LOCKED' : 'BAD_PASSWORD', user.id);
        throw invalidCredentials();
      }
      if (user.status !== 'ACTIVE') {
        await auditLogin(meta, 'DENIED', `ACCOUNT_${user.status}`, user.id);
        throw invalidCredentials();
      }

      const newHash = passwordNeedsRehash(user.passwordHash) ? await hashPassword(input.password) : undefined;
      const issued = await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: at,
            ...(newHash && { passwordHash: newHash }),
          },
        });
        const family = await createSessionFamily(tx, config.refresh, user.id, input.deviceLabel ?? null, at);
        await recordAudit(tx, {
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'User',
          entityId: user.id,
          outcome: 'SUCCESS',
          requestId: meta.requestId,
          details: { reason: 'OK', sessionId: family.familyId },
        });
        return family;
      });
      return tokensFor(user, issued, at);
    },

    async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthTokensResponse> {
      const at = now();
      const result = await rotateRefreshToken(db, config.refresh, refreshToken, at);

      switch (result.kind) {
        case 'rotated': {
          const user = await db.user.findUnique({ where: { id: result.issued.userId } });
          if (!user || user.status !== 'ACTIVE') throw sessionExpired();
          return tokensFor(user, result.issued, at);
        }
        case 'reuse_detected':
          await recordAudit(db, {
            actorUserId: result.userId,
            action: 'auth.refresh_reuse_detected',
            entityType: 'SessionFamily',
            entityId: result.familyId,
            outcome: 'DENIED',
            requestId: meta.requestId,
            details: { action: 'FAMILY_REVOKED' },
          });
          throw sessionExpired();
        case 'account_inactive':
          await recordAudit(db, {
            actorUserId: result.userId,
            action: 'auth.refresh_denied',
            entityType: 'SessionFamily',
            entityId: result.familyId,
            outcome: 'DENIED',
            requestId: meta.requestId,
            details: { reason: 'ACCOUNT_INACTIVE' },
          });
          throw sessionExpired();
        case 'invalid':
          throw sessionExpired();
      }
    },

    /** Always succeeds from the client's point of view (no token-validity oracle). */
    async logout(refreshToken: string, meta: RequestMeta): Promise<void> {
      const family = await findFamilyByToken(db, refreshToken);
      if (!family) return;
      const revoked = await revokeFamily(db, family.familyId, REVOCATION_REASONS.logout, now());
      if (revoked > 0) {
        await recordAudit(db, {
          actorUserId: family.userId,
          action: 'auth.logout',
          entityType: 'SessionFamily',
          entityId: family.familyId,
          outcome: 'SUCCESS',
          requestId: meta.requestId,
        });
      }
    },

    async logoutAll(auth: AuthContext, meta: RequestMeta): Promise<void> {
      const revoked = await revokeAllUserSessions(db, auth.userId, REVOCATION_REASONS.logoutAll, now());
      await recordAudit(db, {
        actorUserId: auth.userId,
        action: 'auth.logout_all',
        entityType: 'User',
        entityId: auth.userId,
        outcome: 'SUCCESS',
        requestId: meta.requestId,
        details: { sessionsRevoked: revoked },
      });
    },

    /**
     * Changes the password, revokes EVERY session of the user (all devices, including this one)
     * and starts one new session for the calling device.
     */
    async changePassword(
      auth: AuthContext,
      input: { currentPassword: string; newPassword: string },
      meta: RequestMeta,
    ): Promise<AuthTokensResponse> {
      const at = now();
      const user = await db.user.findUnique({ where: { id: auth.userId } });
      if (!user || user.status !== 'ACTIVE') throw AppError.unauthorized();

      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        await recordAudit(db, {
          actorUserId: user.id,
          action: 'auth.password_change',
          entityType: 'User',
          entityId: user.id,
          outcome: 'FAILED',
          requestId: meta.requestId,
          details: { reason: 'INVALID_CURRENT_PASSWORD' },
        });
        throw new AppError(400, AUTH_ERROR_CODES.invalidCurrentPassword, 'Current password is incorrect');
      }

      const violation = checkPasswordPolicy(input.newPassword, user.loginId);
      if (violation) {
        throw new AppError(400, AUTH_ERROR_CODES.passwordPolicy, PASSWORD_POLICY_MESSAGES[violation], {
          rule: violation,
        });
      }
      if (await verifyPassword(user.passwordHash, input.newPassword)) {
        throw new AppError(400, AUTH_ERROR_CODES.passwordPolicy, 'New password must be different', {
          rule: 'SAME_AS_CURRENT',
        });
      }

      const passwordHash = await hashPassword(input.newPassword);
      const current = await db.refreshSession.findFirst({
        where: { familyId: auth.sessionId },
        select: { deviceLabel: true },
      });

      const { updated, issued } = await db.$transaction(async (tx) => {
        const saved = await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            passwordChangedAt: at,
            mustChangePassword: false,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        const revoked = await revokeAllUserSessions(tx, user.id, REVOCATION_REASONS.passwordChanged, at);
        const family = await createSessionFamily(
          tx,
          config.refresh,
          user.id,
          current?.deviceLabel ?? null,
          at,
        );
        await recordAudit(tx, {
          actorUserId: user.id,
          action: 'auth.password_change',
          entityType: 'User',
          entityId: user.id,
          outcome: 'SUCCESS',
          requestId: meta.requestId,
          details: { sessionsRevoked: revoked },
        });
        return { updated: saved, issued: family };
      });
      return tokensFor(updated, issued, at);
    },

    /** Profile plus effective access, for the app's UI only - the API re-checks every request. */
    async me(auth: AuthContext): Promise<MeResponse> {
      const user = await db.user.findUnique({ where: { id: auth.userId } });
      if (!user) throw AppError.unauthorized();
      return { user: toAuthUser(user), access: await effectiveAccess(db, user.id, now()) };
    },

    async listSessions(auth: AuthContext): Promise<SessionListResponse> {
      const rows = await listActiveSessions(db, auth.userId, now());
      return {
        sessions: rows.map((row) => ({
          sessionId: row.familyId,
          deviceLabel: row.deviceLabel,
          lastActiveAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          current: row.familyId === auth.sessionId,
        })),
      };
    },

    /** Revokes one of the caller's own sessions. Someone else's session id gives 404. */
    async revokeSession(auth: AuthContext, sessionId: string, meta: RequestMeta): Promise<void> {
      const result = await db.refreshSession.updateMany({
        where: { userId: auth.userId, familyId: sessionId, revokedAt: null },
        data: { revokedAt: now(), revokedReason: REVOCATION_REASONS.sessionRevoked },
      });
      if (result.count === 0) throw AppError.notFound('Session not found');
      await recordAudit(db, {
        actorUserId: auth.userId,
        action: 'auth.session_revoked',
        entityType: 'SessionFamily',
        entityId: sessionId,
        outcome: 'SUCCESS',
        requestId: meta.requestId,
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
