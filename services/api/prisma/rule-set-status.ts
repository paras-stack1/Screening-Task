/**
 * Moves a clinical rule set version through its lifecycle (Step 7 decision B). Run by the person
 * the programme designates; every change writes a rule-set history event and an audit record.
 *
 *   npm run db:rule-set-status -- --code <CODE> --version <N> --to IN_REVIEW --actor <LOGIN-ID>
 *   npm run db:rule-set-status -- --code <CODE> --version <N> --to APPROVED  --actor <LOGIN-ID> \
 *                                 --reference "<approval document / minute number>"
 *   npm run db:rule-set-status -- --code <CODE> --version <N> --to ACTIVE    --actor <LOGIN-ID> \
 *                                 [--effective-from 2027-01-01T00:00:00+05:30]
 *   npm run db:rule-set-status -- --code <CODE> --version <N> --to RETIRED   --actor <LOGIN-ID>
 *
 * Demonstration rule sets cannot be approved. See docs/step-7/clinical-rule-governance.md.
 */
import { parseArgs } from 'node:util';
import { protocolStatusSchema } from '@balswasthya/shared-contracts';
import { PrismaClient } from '@prisma/client';
import { changeRuleSetStatus, RuleSetLifecycleError } from '../src/modules/clinical-rules/ruleSetLifecycle';

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
    const result = await changeRuleSetStatus(prisma, {
      code: values.code,
      version,
      to: to.data,
      actorLoginId: values.actor,
      approvalReference: values.reference,
      effectiveFrom,
    });
    // eslint-disable-next-line no-console
    console.log(
      `Rule set ${values.code} v${version}: ${result.from} -> ${result.to}` +
        (result.contentSha256 ? ` (content ${result.contentSha256})` : ''),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof RuleSetLifecycleError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'unknown error';
  // eslint-disable-next-line no-console
  console.error('Rule set status change failed:', message);
  process.exitCode = 1;
});
