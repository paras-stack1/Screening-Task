/**
 * DEVELOPMENT ONLY (Step 6F): prepares a SYNTHETIC ASHA worker for the opt-in live tests
 * (apps/worker-app/tests/live). Refuses to run when NODE_ENV=production.
 *
 *   $env:LIVE_WORKER_PASSWORD="<8+ characters>"; npm run db:dev-live-worker
 *
 * Creates or refreshes login LIVE-ASHA-01 ("Synthetic Live Worker") with that password, no forced
 * password change, and an ASHA assignment (AREA_ONLY) in the seeded demo village
 * DEMO-D1-B1-S1-V1. The password comes from the environment only and is never printed or stored
 * anywhere but as an Argon2 hash. The change is audited.
 */
import { PrismaClient } from '@prisma/client';
import { assertDevelopmentDatabase } from './devGuard';
import { recordAudit } from '../src/modules/audit/audit.service';
import { checkPasswordPolicy, hashPassword } from '../src/utils/password';

const LOGIN_ID = 'LIVE-ASHA-01';
const AREA_CODE = 'DEMO-D1-B1-S1-V1';

async function main() {
  assertDevelopmentDatabase();
  const password = process.env.LIVE_WORKER_PASSWORD;
  if (!password) throw new Error('Set LIVE_WORKER_PASSWORD');
  const violation = checkPasswordPolicy(password, LOGIN_ID);
  if (violation) throw new Error(`LIVE_WORKER_PASSWORD does not meet the password policy (${violation})`);

  const prisma = new PrismaClient();
  try {
    const area = await prisma.area.findFirst({ where: { code: AREA_CODE } });
    const role = await prisma.role.findUnique({ where: { code: 'ASHA' } });
    if (!area || !role) throw new Error('Demo area or ASHA role missing - run npm run db:seed first');
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { loginId: LOGIN_ID },
      update: {
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: {
        loginId: LOGIN_ID,
        displayName: 'Synthetic Live Worker',
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    const now = new Date();
    const existing = await prisma.workerAreaAssignment.findFirst({
      where: {
        userId: user.id,
        areaId: area.id,
        roleId: role.id,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
    });
    if (!existing) {
      await prisma.workerAreaAssignment.create({
        data: {
          userId: user.id,
          areaId: area.id,
          roleId: role.id,
          scope: 'AREA_ONLY',
          effectiveFrom: new Date(now.getTime() - 60_000),
          reason: 'Development live test worker (synthetic)',
          createdById: user.id,
        },
      });
    }
    await recordAudit(prisma, {
      actorUserId: user.id,
      action: 'dev.live_worker_prepared',
      entityType: 'user',
      entityId: user.id,
      areaId: area.id,
      outcome: 'SUCCESS',
      details: { loginId: LOGIN_ID, areaCode: AREA_CODE, via: 'dev-script' },
    });
    // eslint-disable-next-line no-console
    console.log(
      `Ready: ${LOGIN_ID} (ASHA, ${AREA_CODE}). Password taken from LIVE_WORKER_PASSWORD, not printed.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(
    'Preparing the live worker failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
