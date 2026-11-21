/**
 * Creates the first administrator account (run once, by an operator, on the server).
 *
 *   npm run db:bootstrap-admin -- --login-id ADMIN-0001 --display-name "State Administrator"
 *
 * Prints a one-time temporary password. The administrator must change it at first sign-in.
 * Refuses to run when an active root administrator already exists.
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { bootstrapAdmin } from '../src/modules/users/bootstrap';

const { values } = parseArgs({
  options: {
    'login-id': { type: 'string' },
    'display-name': { type: 'string' },
    role: { type: 'string' },
  },
});

async function main() {
  const loginId = values['login-id'];
  const displayName = values['display-name'];
  if (!loginId || !displayName) {
    throw new Error('Usage: --login-id <EMPLOYEE-CODE> --display-name "<name>" [--role STATE_ADMIN]');
  }
  const prisma = new PrismaClient();
  try {
    const result = await bootstrapAdmin(prisma, { loginId, displayName, roleCode: values.role });
    // console is deliberate: this is an interactive operator tool. The password is shown once
    // and is not logged anywhere else.
    // eslint-disable-next-line no-console
    console.log(
      [
        'Administrator created.',
        `  Login ID:           ${result.loginId}`,
        `  Temporary password: ${result.temporaryPassword}`,
        'Give the password to the administrator in person. It must be changed at first sign-in.',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
