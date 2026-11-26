import {
  CARE_CONTENT_DSL_VERSION,
  careContentDefinitionSchema,
  type CareContentDefinition,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { DEMO_AGE_MAX_DAYS } from '../screening/demoProtocols';
import { importCareContent } from './careContentLifecycle';

/**
 * DEMONSTRATION CARE CONTENT (Step 8, decision C2).
 *
 * !!! NONE OF THIS IS HEALTH OR PARENTING GUIDANCE. !!!
 * It exists only so plans, the video player and family hand-outs can be built and tested before
 * the programme supplies approved content. Every item:
 *  - says in its title, summary and every step that it is a placeholder;
 *  - contains no real activity, frequency, food, quantity or medicine;
 *  - links only to the reserved `.invalid` domain, so no real video can ever play;
 *  - is DRAFT with isDemonstration = true, which the database refuses to approve, and is shown
 *    only where draft content is allowed (never in production).
 */
const SOURCE = 'NONE - engineering demonstration content; not from any programme or guideline';
const PERMISSION = 'NONE - placeholder text written for software testing only';

const text = (en: string, hi: string) => ({ en, hi });
const placeholderStep = (n: number) =>
  text(
    `Demonstration step ${n} - placeholder text, not an instruction.`,
    `प्रदर्शन चरण ${n} - नमूना पाठ, कोई निर्देश नहीं।`,
  );

function demo(
  short: string,
  kind: CareContentDefinition['kind'],
  topic: CareContentDefinition['topic'],
  extra: Partial<CareContentDefinition>,
): CareContentDefinition {
  return careContentDefinitionSchema.parse({
    dslVersion: CARE_CONTENT_DSL_VERSION,
    code: `DEMO_CARE_${short}`,
    version: 1,
    kind,
    topic,
    category: null,
    title: text(
      `Demonstration ${kind === 'VIDEO' ? 'video' : 'activity'} ${short} (not approved content)`,
      `प्रदर्शन ${kind === 'VIDEO' ? 'वीडियो' : 'गतिविधि'} ${short} (स्वीकृत सामग्री नहीं)`,
    ),
    summary: text(
      'Placeholder for software testing. Not health or parenting guidance.',
      'सॉफ़्टवेयर जाँच के लिए नमूना। यह स्वास्थ्य या पालन-पोषण की सलाह नहीं है।',
    ),
    ageMinDays: 0,
    ageMaxDays: DEMO_AGE_MAX_DAYS,
    requiresDoctor: false,
    sourceReference: SOURCE,
    usagePermission: PERMISSION,
    isDemonstration: true,
    ...extra,
  });
}

const placeholderFrequency = text('Demonstration frequency (placeholder)', 'प्रदर्शन आवृत्ति (नमूना)');

const video = (short: string) => ({
  url: `https://media.demo.invalid/care/${short.toLowerCase()}`,
  durationSeconds: 60,
  sizeBytes: 5_000_000,
  languages: ['hi'] as Array<'hi' | 'en'>,
  hasCaptions: false,
});

export const DEMO_CARE_CONTENT: readonly CareContentDefinition[] = [
  demo('A1', 'ACTIVITY', 'DEVELOPMENT_MOTOR', {
    steps: [placeholderStep(1), placeholderStep(2), placeholderStep(3)],
    suggestedFrequency: placeholderFrequency,
  }),
  demo('A2', 'ACTIVITY', 'DEVELOPMENT_SPEECH_LANGUAGE', {
    steps: [placeholderStep(1), placeholderStep(2)],
    suggestedFrequency: placeholderFrequency,
  }),
  // Marked "doctor-recommended" so stage 8C can test that only medical officers assign it.
  demo('A3', 'ACTIVITY', 'DEVELOPMENT_COGNITIVE', {
    steps: [placeholderStep(1)],
    suggestedFrequency: placeholderFrequency,
    requiresDoctor: true,
  }),
  demo('V1', 'VIDEO', 'DEVELOPMENT_SOCIAL_PLAY', { video: video('V1') }),
  demo('V2', 'VIDEO', 'HYGIENE', { video: video('V2') }),
];

/** Creates missing demonstration content (DRAFT, no actor). Never changes an existing row. */
export async function ensureDemoCareContent(db: PrismaClient): Promise<void> {
  for (const def of DEMO_CARE_CONTENT) await importCareContent(db, def, null);
}
