/**
 * Imports clinically prepared screening content as a NEW DRAFT protocol version (Step 6F).
 *
 *   npm run db:protocol-import -- --metadata <file.json> --questions <file.csv> --check
 *   npm run db:protocol-import -- --metadata <file.json> --questions <file.csv> --actor <LOGIN-ID>
 *
 * --check validates only and writes nothing. Every problem is listed with its CSV line.
 * Afterwards: db:protocol-status (IN_REVIEW -> APPROVED -> ACTIVE). See
 * docs/step-6/clinical-content-intake/README.md.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import {
  buildDefinition,
  importProtocol,
  ProtocolImportError,
} from '../src/modules/screening/protocolImport';
import { protocolContentHash } from '../src/modules/screening/protocolContent';

const { values } = parseArgs({
  options: {
    metadata: { type: 'string' },
    questions: { type: 'string' },
    actor: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});

async function main() {
  if (!values.metadata || !values.questions || (!values.check && !values.actor)) {
    throw new Error('Usage: --metadata <file.json> --questions <file.csv> (--check | --actor <LOGIN-ID>)');
  }
  // npm runs workspace scripts inside services/api: resolve paths from where the user ran npm.
  const from = (file: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
  const metadata: unknown = JSON.parse(readFileSync(from(values.metadata), 'utf8').replace(/^\uFEFF/, ''));
  const result = buildDefinition(metadata, readFileSync(from(values.questions), 'utf8'));
  /* eslint-disable no-console -- interactive operator tool */
  if (!result.ok) {
    console.error(`Not imported - ${result.problems.length} problem(s):`);
    for (const p of result.problems) console.error(`  ${p.where}: ${p.message}`);
    process.exitCode = 1;
    return;
  }
  const def = result.definition;
  const summary = `${def.code} v${def.version} (${def.category}, ${def.questions.length} questions, age ${def.ageMinDays}-${def.ageMaxDays} days)`;
  if (values.check) {
    console.log(
      `Valid: ${summary}. Content hash ${protocolContentHash(def)}. Nothing was written (--check).`,
    );
    return;
  }
  const prisma = new PrismaClient();
  try {
    const created = await importProtocol(prisma, def, values.actor!);
    console.log(`Imported as DRAFT: ${summary}. Id ${created.id}, content hash ${created.contentSha256}.`);
    console.log(
      'Next: npm run db:protocol-status -- --code ' +
        def.code +
        ' --version ' +
        String(def.version) +
        ' --to IN_REVIEW --actor <LOGIN-ID>',
    );
  } finally {
    await prisma.$disconnect();
  }
  /* eslint-enable no-console */
}

main().catch((error: unknown) => {
  const message =
    error instanceof ProtocolImportError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'unknown error';
  // eslint-disable-next-line no-console
  console.error('Protocol import failed:', message);
  process.exitCode = 1;
});
