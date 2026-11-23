/**
 * DEVELOPMENT ONLY: resets a forgotten password on a local development database.
 * Refuses to run when NODE_ENV=production or when the database is not on this computer
 * (prisma/devGuard.ts).
 *
 *   npm run db:dev-reset-password -- --login-id ADMIN-0001
 *
 * Does exactly what an administrator's "reset password" does (users.service resetPassword):
 * a new one-time password (printed once, never stored except as an Argon2 hash), forced change
 * at the next sign-in, lock and failed-attempt counter cleared, every session signed out, and an
 * audit entry. In a real deployment another administrator resets passwords through the API or
 * the admin portal instead.
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { assertDevelopmentDatabase } from './devGuard';
import { normalizeLoginId } from '../src/modules/auth/loginId';
import { REVOCATION_REASONS, revokeAllUserSessions } from '../src/modules/auth/session.service';
import { recordAudit } from '../src/modules/audit/audit.service';
import { generateTemporaryPassword, hashPassword } from '../src/utils/password';

async function main() {
  assertDevelopmentDatabase();
  const { values } = parseArgs({ options: { 'login-id': { type: 'string' } } });
  const raw = values['login-id'];
  if (!raw) throw new Error('Usage: npm run db:dev-reset-password -- --login-id <LOGIN-ID>');
  const loginId = normalizeLoginId(raw);

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { loginId } });
    if (!user) throw new Error(`No account with login ID ${loginId}`);
    if (user.status === 'DEACTIVATED') throw new Error('This account is deactivated');

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
          passwordChangedAt: now,
        },
      });
      const revoked = await revokeAllUserSessions(tx, user.id, REVOCATION_REASONS.passwordReset, now);
      await recordAudit(tx, {
        actorUserId: user.id,
        action: 'user.password_reset',
        entityType: 'User',
        entityId: user.id,
        outcome: 'SUCCESS',
        details: {
          reason: 'Development password reset (dev-script)',
          sessionsRevoked: revoked,
          via: 'dev-script',
        },
      });
    });

    // eslint-disable-next-line no-console
    console.log(
      [
        `Password reset for ${loginId} (${user.displayName}).`,
        `One-time password: ${temporaryPassword}`,
        'Sign in with it now; you will be asked to choose your own password. It is shown only once.',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Password reset failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
