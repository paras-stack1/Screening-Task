/**
 * Imports a clinical rule set (JSON, rule DSL v1) as a NEW DRAFT version (Step 7 decision B).
 *
 *   npm run db:rule-set-import -- --file <rule-set.json> --check
 *   npm run db:rule-set-import -- --file <rule-set.json> --actor <LOGIN-ID>
 *
 * --check validates only (format + fit with the protocol versions it names) and writes nothing.
 * Afterwards: db:rule-set-status (IN_REVIEW -> APPROVED -> ACTIVE). See
 * docs/step-7/clinical-rule-governance.md. Every number in a rule must come from the clinical
 * reference written next to it - this tool never supplies one.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { clinicalRuleSetDefinitionSchema } from '@balswasthya/shared-contracts';
import { PrismaClient } from '@prisma/client';
import { ruleSetContentHash, validateAgainstProtocols } from '../src/modules/clinical-rules/ruleSetContent';
import { importRuleSet, RuleSetLifecycleError } from '../src/modules/clinical-rules/ruleSetLifecycle';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    actor: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});

async function main() {
  if (!values.file || (!values.check && !values.actor)) {
    throw new Error('Usage: --file <rule-set.json> (--check | --actor <LOGIN-ID>)');
  }
  // npm runs workspace scripts inside services/api: resolve paths from where the user ran npm.
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.file);
  const text = readFileSync(file, 'utf8');
  // Drop a byte-order mark (0xFEFF) that spreadsheet tools add.
  const raw: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const parsed = clinicalRuleSetDefinitionSchema.safeParse(raw);
  /* eslint-disable no-console -- interactive operator tool */
  if (!parsed.success) {
    console.error('The rule set file is not valid:');
    for (const issue of parsed.error.issues)
      console.error(`- ${issue.path.join('.') || '(file)'}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient();
  try {
    if (values.check) {
      const protocols = await prisma.screeningProtocol.findMany({
        where: { code: parsed.data.protocolCode, version: { in: parsed.data.protocolVersions } },
        select: {
          code: true,
          version: true,
          category: true,
          isDemonstration: true,
          questions: { select: { code: true, answerType: true, options: true } },
        },
      });
      const problems = validateAgainstProtocols(parsed.data, protocols);
      if (problems.length > 0) {
        console.error('The rule set does not fit its protocols:');
        for (const p of problems) console.error(`- ${p}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `OK: ${parsed.data.code} v${parsed.data.version}, content ${ruleSetContentHash(parsed.data)}`,
      );
      return;
    }
    const result = await importRuleSet(prisma, parsed.data, values.actor!);
    console.log(
      result.created
        ? `Imported ${parsed.data.code} v${parsed.data.version} as DRAFT (id ${result.id})`
        : `${parsed.data.code} v${parsed.data.version} already exists with identical content (id ${result.id})`,
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
  console.error('Rule set import failed:', message);
  process.exitCode = 1;
});
