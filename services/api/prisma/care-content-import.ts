/**
 * Imports a Parent Care content item (JSON, care content format v1) as a NEW DRAFT version
 * (Step 8 decision C2).
 *
 *   npm run db:care-content-import -- --file <content.json> --check
 *   npm run db:care-content-import -- --file <content.json> --actor <LOGIN-ID>
 *
 * --check validates only and writes nothing. Afterwards: db:care-content-status
 * (IN_REVIEW -> APPROVED -> ACTIVE). See docs/step-8/care-content-governance.md. Every word,
 * frequency and video link must come from the approved source named in the file - this tool never
 * supplies one.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { careContentDefinitionSchema } from '@balswasthya/shared-contracts';
import { PrismaClient } from '@prisma/client';
import { careContentHash } from '../src/modules/care-content/careContentDefinition';
import {
  CareContentLifecycleError,
  importCareContent,
} from '../src/modules/care-content/careContentLifecycle';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    actor: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});

async function main() {
  if (!values.file || (!values.check && !values.actor)) {
    throw new Error('Usage: --file <content.json> (--check | --actor <LOGIN-ID>)');
  }
  // npm runs workspace scripts inside services/api: resolve paths from where the user ran npm.
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.file);
  const text = readFileSync(file, 'utf8');
  // Drop a byte-order mark (0xFEFF) that spreadsheet tools add.
  const raw: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const parsed = careContentDefinitionSchema.safeParse(raw);
  /* eslint-disable no-console -- interactive operator tool */
  if (!parsed.success) {
    console.error('The care content file is not valid:');
    for (const issue of parsed.error.issues)
      console.error(`- ${issue.path.join('.') || '(file)'}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  if (values.check) {
    console.log(`OK: ${parsed.data.code} v${parsed.data.version}, content ${careContentHash(parsed.data)}`);
    return;
  }
  const prisma = new PrismaClient();
  try {
    const result = await importCareContent(prisma, parsed.data, values.actor!);
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
    error instanceof CareContentLifecycleError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'unknown error';
  console.error('Care content import failed:', message);
  process.exitCode = 1;
});
