import {
  ANSWER_TYPES,
  FOUR_D_CATEGORIES,
  protocolDefinitionSchema,
  type AnswerType,
  type ProtocolDefinition,
} from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import { recordAudit } from '../audit/audit.service';
import { normalizeLoginId } from '../auth/loginId';
import { definitionToCreateInput, protocolContentHash } from './protocolContent';

/**
 * Clinical content intake (Step 6F). The programme fills two files - protocol metadata (JSON) and
 * the questions sheet (CSV saved from Excel / Google Sheets, UTF-8) - see
 * docs/step-6/clinical-content-intake/README.md. This module only CONVERTS and VALIDATES them; it
 * never invents or changes clinical content. Imported content is always a NEW DRAFT version;
 * review and approval follow through `db:protocol-status`.
 */
export interface ImportProblem {
  /** 'metadata' or the 1-based CSV line number (header = line 1). */
  where: string;
  message: string;
}

export const QUESTION_COLUMNS = [
  'code',
  'section',
  'order',
  'answer_type',
  'required',
  'prompt_hi',
  'prompt_en',
  'help_hi',
  'help_en',
  'options',
  'min',
  'max',
  'max_decimals',
  'unit',
  'max_length',
] as const;
type Column = (typeof QUESTION_COLUMNS)[number];

/** Text left over from the template ("<<…>>") must never be imported as clinical wording. */
const TEMPLATE_MARK = /<<|>>/;

/** RFC 4180 CSV: quoted fields, "" escapes, commas and line breaks inside quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, ''); // Excel's UTF-8 byte-order mark
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('The CSV file ends inside a quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const asNumber = (value: string) => (value.trim() === '' ? undefined : Number(value.trim()));

/** "CODE=हिन्दी|English; CODE2=…" -> choice options. */
function parseOptions(value: string, line: string, problems: ImportProblem[]) {
  if (value.trim() === '') return undefined;
  return value.split(';').map((part) => {
    const [code, labels = ''] = part.split('=');
    const [hi = '', en = ''] = labels.split('|');
    if (!code?.trim() || !hi.trim() || !en.trim()) {
      problems.push({ where: line, message: `Option "${part.trim()}" must look like CODE=हिन्दी|English` });
    }
    return { code: (code ?? '').trim(), label: { hi: hi.trim(), en: en.trim() } };
  });
}

/**
 * Builds and validates a protocol definition. Returns every problem found (not just the first),
 * with the CSV line, so the content team can fix the sheet in one go.
 */
export function buildDefinition(
  metadata: unknown,
  csv: string,
): { ok: true; definition: ProtocolDefinition } | { ok: false; problems: ImportProblem[] } {
  const problems: ImportProblem[] = [];
  let rows: string[][];
  try {
    rows = parseCsv(csv);
  } catch (error) {
    return { ok: false, problems: [{ where: 'questions', message: (error as Error).message }] };
  }
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = QUESTION_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { ok: false, problems: [{ where: 'line 1', message: `Missing columns: ${missing.join(', ')}` }] };
  }
  const col = (row: string[], name: Column) => (row[header.indexOf(name)] ?? '').trim();

  const questions = rows.slice(1).map((row, index) => {
    const line = `line ${index + 2}`;
    const answerType = col(row, 'answer_type').toUpperCase() as AnswerType;
    if (!ANSWER_TYPES.includes(answerType)) {
      problems.push({ where: line, message: `answer_type must be one of ${ANSWER_TYPES.join(', ')}` });
    }
    const required = col(row, 'required').toLowerCase();
    if (!['yes', 'no'].includes(required))
      problems.push({ where: line, message: 'required must be yes or no' });
    const helpHi = col(row, 'help_hi');
    const helpEn = col(row, 'help_en');
    if (Boolean(helpHi) !== Boolean(helpEn)) {
      problems.push({ where: line, message: 'help needs both help_hi and help_en (or neither)' });
    }
    const validation = {
      min: asNumber(col(row, 'min')),
      max: asNumber(col(row, 'max')),
      maxDecimals: asNumber(col(row, 'max_decimals')),
      unit: col(row, 'unit') || undefined,
      maxLength: asNumber(col(row, 'max_length')),
    };
    const hasValidation = Object.values(validation).some((v) => v !== undefined);
    if (
      [col(row, 'prompt_hi'), col(row, 'prompt_en'), helpHi, helpEn, col(row, 'options')].some((text) =>
        TEMPLATE_MARK.test(text),
      )
    ) {
      problems.push({ where: line, message: 'Template placeholder text (<< >>) left in' });
    }
    return {
      code: col(row, 'code'),
      sectionCode: col(row, 'section'),
      sortOrder: Number(col(row, 'order')),
      prompt: { hi: col(row, 'prompt_hi'), en: col(row, 'prompt_en') },
      ...(helpHi || helpEn ? { help: { hi: helpHi, en: helpEn } } : {}),
      answerType,
      ...(col(row, 'options') ? { options: parseOptions(col(row, 'options'), line, problems) } : {}),
      ...(hasValidation
        ? { validation: Object.fromEntries(Object.entries(validation).filter(([, v]) => v !== undefined)) }
        : {}),
      isRequired: required === 'yes',
    };
  });

  // Cross-row checks run here too: the schema's own whole-object checks only run once every
  // field is valid, and the content team should see every problem in one pass.
  const seen = new Map<string, number>();
  questions.forEach((q, index) => {
    const first = seen.get(q.code);
    if (q.code && first !== undefined) {
      problems.push({
        where: `line ${index + 2}`,
        message: `Question codes must be unique (${q.code} is also on line ${first + 2})`,
      });
    } else seen.set(q.code, index);
  });

  const m = (metadata ?? {}) as Record<string, unknown>;
  if (
    typeof m.age_min_days === 'number' &&
    typeof m.age_max_days === 'number' &&
    m.age_max_days < m.age_min_days
  ) {
    problems.push({ where: 'metadata', message: 'age_max_days must not be below age_min_days' });
  }
  if (typeof m.category === 'string' && !FOUR_D_CATEGORIES.includes(m.category as never)) {
    problems.push({ where: 'metadata', message: `category must be one of ${FOUR_D_CATEGORIES.join(', ')}` });
  }
  for (const value of Object.values(m)) {
    if (typeof value === 'string' && TEMPLATE_MARK.test(value)) {
      problems.push({ where: 'metadata', message: 'Template placeholder text (<< >>) left in' });
      break;
    }
  }
  const candidate = {
    code: m.code,
    version: m.version,
    category: m.category,
    name: { hi: m.name_hi, en: m.name_en },
    ...(m.description_hi || m.description_en
      ? { description: { hi: m.description_hi, en: m.description_en } }
      : {}),
    ageMinDays: m.age_min_days,
    ageMaxDays: m.age_max_days,
    sourceReference: m.source_reference,
    // Imported content is real content: it can never be marked as demonstration.
    isDemonstration: false,
    questions,
  };
  const parsed = protocolDefinitionSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [first, index, ...rest] = issue.path;
      const where = first === 'questions' && typeof index === 'number' ? `line ${index + 2}` : 'metadata';
      const field = first === 'questions' ? rest.join('.') : issue.path.join('.');
      problems.push({ where, message: `${field ? `${field}: ` : ''}${issue.message}` });
    }
  }
  if (problems.length > 0 || !parsed.success) return { ok: false, problems };
  return { ok: true, definition: parsed.data };
}

export class ProtocolImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolImportError';
  }
}

/** Creates the protocol as a NEW DRAFT (never overwrites a version) and audits it. */
export async function importProtocol(
  db: PrismaClient,
  definition: ProtocolDefinition,
  actorLoginId: string,
): Promise<{ id: string; contentSha256: string }> {
  const actor = await db.user.findUnique({ where: { loginId: normalizeLoginId(actorLoginId) } });
  if (!actor || actor.status !== 'ACTIVE') {
    throw new ProtocolImportError('ACTOR_NOT_ACTIVE', 'The acting user does not exist or is not active');
  }
  const contentSha256 = protocolContentHash(definition);
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.screeningProtocol.create({ data: definitionToCreateInput(definition) });
      await recordAudit(tx, {
        actorUserId: actor.id,
        action: 'screening_protocol.imported',
        entityType: 'screeningProtocol',
        entityId: created.id,
        outcome: 'SUCCESS',
        details: {
          code: definition.code,
          version: definition.version,
          category: definition.category,
          questions: definition.questions.length,
          contentSha256,
          via: 'admin-script',
        },
      });
      return { id: created.id, contentSha256 };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ProtocolImportError(
        'VERSION_EXISTS',
        `${definition.code} version ${definition.version} already exists. Content is never overwritten: use the next version number.`,
      );
    }
    throw error;
  }
}
