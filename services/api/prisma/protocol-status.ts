/**
 * Moves a screening protocol version through its clinical-content lifecycle (Step 6 decision E).
 * Run by the person the programme designates; every change is written to the audit log.
 *
 *   npm run db:protocol-status -- --code <CODE> --version <N> --to IN_REVIEW --actor <LOGIN-ID>
 *   npm run db:protocol-status -- --code <CODE> --version <N> --to APPROVED  --actor <LOGIN-ID> \
 *                                 --reference "<approval document / minute number>"
 *   npm run db:protocol-status -- --code <CODE> --version <N> --to ACTIVE    --actor <LOGIN-ID> \
 *                                 [--effective-from 2027-01-01T00:00:00+05:30]
 *   npm run db:protocol-status -- --code <CODE> --version <N> --to RETIRED   --actor <LOGIN-ID>
 *
 * See docs/step-6/clinical-content-governance.md. Demonstration protocols cannot be approved.
 */
import { parseArgs } from 'node:util';
import { protocolStatusSchema } from '@balswasthya/shared-contracts';
import { PrismaClient } from '@prisma/client';
import { changeProtocolStatus, ProtocolLifecycleError } from '../src/modules/screening/protocolLifecycle';

const { values } = parseArgs({
  options: {
    code: { type: 'string' },
    version: { type: 'string' },
    to: { type: 'string' },
    actor: { type: 'string' },
    reference: { type: 'string' },
    'effective-from': { type: 'string' },
  },
});

async function main() {
  const to = protocolStatusSchema.safeParse(values.to);
  const version = Number(values.version);
  if (!values.code || !Number.isInteger(version) || version < 1 || !to.success || !values.actor) {
    throw new Error(
      'Usage: --code <CODE> --version <N> --to <IN_REVIEW|DRAFT|APPROVED|ACTIVE|RETIRED> --actor <LOGIN-ID> [--reference "..."] [--effective-from <ISO date-time>]',
    );
  }
  let effectiveFrom: Date | undefined;
  if (values['effective-from']) {
    effectiveFrom = new Date(values['effective-from']);
    if (Number.isNaN(effectiveFrom.getTime())) throw new Error('--effective-from is not a valid date-time');
  }
  const prisma = new PrismaClient();
  try {
    const result = await changeProtocolStatus(prisma, {
      code: values.code,
      version,
      to: to.data,
      actorLoginId: values.actor,
      approvalReference: values.reference,
      effectiveFrom,
    });
    // eslint-disable-next-line no-console
    console.log(
      `Protocol ${values.code} v${version}: ${result.from} -> ${result.to}` +
        (result.contentSha256 ? ` (content ${result.contentSha256})` : ''),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof ProtocolLifecycleError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'unknown error';
  // eslint-disable-next-line no-console
  console.error('Protocol status change failed:', message);
  process.exitCode = 1;
});
