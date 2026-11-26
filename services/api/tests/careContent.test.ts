import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  careContentDefinitionSchema,
  careContentListQuerySchema,
  careVideoHost,
} from '@balswasthya/shared-contracts';
import { describe, expect, it } from 'vitest';
import { careContentHash } from '../src/modules/care-content/careContentDefinition';
import { DEMO_CARE_CONTENT } from '../src/modules/care-content/demoCareContent';

/** Step 8B: care content format rules. All content here is SYNTHETIC. */
const activity = {
  dslVersion: 1,
  code: 'SYN_ACTIVITY',
  version: 1,
  kind: 'ACTIVITY',
  topic: 'DEVELOPMENT_MOTOR',
  category: null,
  title: { en: 'Synthetic activity', hi: 'Synthetic activity' },
  summary: { en: 'Synthetic summary', hi: 'Synthetic summary' },
  ageMinDays: 0,
  ageMaxDays: 1000,
  steps: [{ en: 'Synthetic step', hi: 'Synthetic step' }],
  suggestedFrequency: { en: 'Synthetic frequency', hi: 'Synthetic frequency' },
  requiresDoctor: false,
  sourceReference: 'SYNTHETIC TEST SOURCE',
  usagePermission: 'SYNTHETIC TEST PERMISSION',
  isDemonstration: false,
};
const video = {
  ...activity,
  code: 'SYN_VIDEO',
  kind: 'VIDEO',
  steps: undefined,
  suggestedFrequency: undefined,
  video: {
    url: 'https://videos.programme.gov.in/care/syn-1',
    durationSeconds: 120,
    sizeBytes: 10_000_000,
    languages: ['hi'],
    hasCaptions: true,
  },
};
const problems = (def: unknown) => {
  const r = careContentDefinitionSchema.safeParse(def);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('care content format', () => {
  it('accepts a complete activity and a complete video', () => {
    expect(problems(activity)).toEqual([]);
    expect(problems(video)).toEqual([]);
  });

  it('an activity needs steps and its source frequency, and has no video', () => {
    expect(problems({ ...activity, steps: undefined })).toContain('An activity needs steps');
    expect(problems({ ...activity, suggestedFrequency: undefined })).toContain(
      'An activity needs the frequency suggested by its source',
    );
    expect(problems({ ...activity, video: video.video })).toContain('An activity has no video');
  });

  it('a video needs its link and has no steps', () => {
    expect(problems({ ...video, video: undefined })).toContain('A video needs its video link');
    expect(problems({ ...video, steps: activity.steps })).toContain('A video has no steps');
  });

  it('requires a source, a usage permission and a sane age band', () => {
    expect(problems({ ...activity, sourceReference: '' }).length).toBeGreaterThan(0);
    expect(problems({ ...activity, usagePermission: ' ' }).length).toBeGreaterThan(0);
    expect(problems({ ...activity, ageMinDays: 10, ageMaxDays: 5 })).toContain(
      'ageMaxDays is below ageMinDays',
    );
  });

  it('refuses unknown fields (no free-form extras such as dosage)', () => {
    expect(problems({ ...activity, dosage: '5 ml' }).length).toBeGreaterThan(0);
  });

  it('video links: https only, no credentials, no IP addresses', () => {
    expect(careVideoHost('https://videos.programme.gov.in/a?b=1')).toBe('videos.programme.gov.in');
    expect(careVideoHost('http://videos.programme.gov.in/a')).toBeNull();
    expect(careVideoHost('https://user:pw@videos.programme.gov.in/a')).toBeNull();
    expect(careVideoHost('https://user@videos.programme.gov.in/a')).toBeNull();
    expect(careVideoHost('https://10.0.0.1/a')).toBeNull();
    expect(careVideoHost('javascript:alert(1)')).toBeNull();
    expect(careVideoHost('https://localhost/a')).toBeNull();
    expect(problems({ ...video, video: { ...video.video, url: 'http://x.org/v' } }).length).toBeGreaterThan(
      0,
    );
  });

  it('real content cannot use reserved domains; demonstration content can use only .invalid', () => {
    const at = (url: string, isDemonstration: boolean) =>
      problems({ ...video, isDemonstration, video: { ...video.video, url } });
    expect(at('https://media.demo.invalid/v', false)).toContain(
      'Real content cannot use a reserved or example domain',
    );
    expect(at('https://www.example.com/v', false)).toContain(
      'Real content cannot use a reserved or example domain',
    );
    expect(at('https://videos.programme.gov.in/v', true)).toContain(
      'Demonstration videos must use the reserved .invalid domain',
    );
    expect(at('https://media.demo.invalid/v', true)).toEqual([]);
  });

  it('the content hash ignores key order and changes with any word', () => {
    const def = careContentDefinitionSchema.parse(activity);
    const reordered = careContentDefinitionSchema.parse(
      Object.fromEntries(Object.entries(activity).reverse()),
    );
    expect(careContentHash(reordered)).toBe(careContentHash(def));
    const changed = careContentDefinitionSchema.parse({
      ...activity,
      steps: [{ en: 'Synthetic step!', hi: 'Synthetic step' }],
    });
    expect(careContentHash(changed)).not.toBe(careContentHash(def));
  });

  it('list query: age must be a whole number of days', () => {
    expect(careContentListQuerySchema.parse({ ageDays: '400' })).toEqual({ ageDays: 400 });
    expect(careContentListQuerySchema.safeParse({ ageDays: '-1' }).success).toBe(false);
    expect(careContentListQuerySchema.safeParse({ ageDays: '1.5' }).success).toBe(false);
    expect(careContentListQuerySchema.safeParse({ childId: 'x' }).success).toBe(false);
  });
});

describe('demonstration care content', () => {
  it('is marked as demonstration, says so in every text, and links nowhere real', () => {
    expect(DEMO_CARE_CONTENT.length).toBeGreaterThanOrEqual(4);
    for (const def of DEMO_CARE_CONTENT) {
      expect(def.isDemonstration).toBe(true);
      expect(def.code.startsWith('DEMO_CARE_')).toBe(true);
      expect(def.title.en).toMatch(/Demonstration/);
      expect(def.summary.en).toMatch(/Not health or parenting guidance/);
      for (const step of def.steps ?? []) expect(step.en).toMatch(/placeholder/);
      if (def.video) expect(careVideoHost(def.video.url)).toMatch(/\.invalid$/);
    }
  });

  it('covers both kinds and one doctor-only item for later plan tests', () => {
    expect(new Set(DEMO_CARE_CONTENT.map((d) => d.kind))).toEqual(new Set(['VIDEO', 'ACTIVITY']));
    expect(DEMO_CARE_CONTENT.filter((d) => d.requiresDoctor)).toHaveLength(1);
  });
});

describe('documentation examples', () => {
  it('the example import files in docs/step-8/examples are valid', () => {
    for (const name of ['care-content-activity', 'care-content-video']) {
      const file = path.resolve(__dirname, `../../../docs/step-8/examples/${name}.example.json`);
      expect(problems(JSON.parse(readFileSync(file, 'utf8')))).toEqual([]);
    }
  });
});
