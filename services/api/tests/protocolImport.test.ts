import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDefinition, parseCsv, QUESTION_COLUMNS } from '../src/modules/screening/protocolImport';

/** Step 6F: clinical content intake - conversion and validation only (no clinical content here). */
const INTAKE = path.resolve(__dirname, '../../../docs/step-6/clinical-content-intake');
const HEADER = QUESTION_COLUMNS.join(',');

/** Synthetic, obviously non-clinical content in the intake format. */
const META = {
  code: 'SYNTHETIC_IMPORT',
  version: 1,
  category: 'DISEASES',
  name_hi: 'कृत्रिम परीक्षण',
  name_en: 'Synthetic test',
  age_min_days: 0,
  age_max_days: 365,
  source_reference: 'Synthetic test data, not a guideline',
};
const ROWS = [
  'Q1,PART_A,10,YES_NO,yes,कृत्रिम प्रश्न 1,Synthetic question 1,,,,,,,,',
  'Q2,PART_A,20,SINGLE_CHOICE,yes,"कृत्रिम प्रश्न 2, अल्पविराम के साथ","Synthetic question 2, with a comma",,,A=क|a;B=ख|b,,,,,',
  'Q3,PART_B,30,NUMBER,no,कृत्रिम प्रश्न 3,Synthetic question 3,,,,0,30,0,days,',
];
const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n');

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes, commas, line breaks, CRLF and the Excel BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"two\nlines",z\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('reports an unterminated quoted field', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/quoted field/);
  });
});

describe('building a protocol definition', () => {
  it('accepts valid content and keeps Hindi, commas, options and number rules', () => {
    const result = buildDefinition(META, csv(...ROWS));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const def = result.definition;
    expect(def).toMatchObject({ code: 'SYNTHETIC_IMPORT', category: 'DISEASES', isDemonstration: false });
    expect(def.questions[1]).toMatchObject({
      prompt: { hi: 'कृत्रिम प्रश्न 2, अल्पविराम के साथ', en: 'Synthetic question 2, with a comma' },
      options: [
        { code: 'A', label: { hi: 'क', en: 'a' } },
        { code: 'B', label: { hi: 'ख', en: 'b' } },
      ],
    });
    expect(def.questions[2]!.validation).toEqual({ min: 0, max: 30, maxDecimals: 0, unit: 'days' });
  });

  it('never imports content as demonstration, whatever the metadata says', () => {
    const result = buildDefinition({ ...META, isDemonstration: true }, csv(...ROWS));
    expect(result.ok && result.definition.isDemonstration).toBe(false);
  });

  it('lists every problem with its CSV line, in one pass', () => {
    const result = buildDefinition(
      { ...META, category: 'D9', age_max_days: -1 },
      csv(
        'Q1,PART_A,10,MAYBE,yes,कृत्रिम,Synthetic,,,,,,,,',
        'Q2,PART_A,20,YES_NO,perhaps,,Synthetic,,,,,,,,',
        'Q3,PART_A,30,SINGLE_CHOICE,yes,कृत्रिम,Synthetic,,,A=क|a,,,,,',
        'Q4,PART_A,40,NUMBER,no,कृत्रिम,Synthetic,हिन्दी,,,5,1,,,',
        'Q1,PART_A,50,YES_NO,no,कृत्रिम,Synthetic,,,A=क|a;B=ख|b,,,,,',
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.problems.map((p) => `${p.where}: ${p.message}`).join('\n');
    expect(text).toMatch(/metadata: category must be one of/);
    expect(text).toMatch(/line 2: answer_type must be one of/);
    expect(text).toMatch(/line 3: required must be yes or no/);
    expect(text).toMatch(/line 3: prompt\.hi/); // missing Hindi
    expect(text).toMatch(/line 4: options: Choice questions need at least two options/);
    expect(text).toMatch(/line 5: help needs both help_hi and help_en/);
    expect(text).toMatch(/line 5: validation: min must not exceed max/);
    expect(text).toMatch(/line 6: options: Only choice questions have options/);
    expect(text).toMatch(/Question codes must be unique/);
  });

  it('refuses missing columns', () => {
    const result = buildDefinition(META, 'code,section\nQ1,A');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]!.message).toMatch(/Missing columns: order, answer_type/);
  });

  it('refuses the shipped template until every placeholder is replaced', () => {
    const meta: unknown = JSON.parse(
      readFileSync(path.join(INTAKE, 'protocol-metadata.template.json'), 'utf8'),
    );
    const result = buildDefinition(meta, readFileSync(path.join(INTAKE, 'questions.template.csv'), 'utf8'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const placeholders = result.problems.filter((p) => /placeholder/.test(p.message));
    expect(placeholders.map((p) => p.where)).toEqual(
      expect.arrayContaining(['metadata', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6']),
    );
  });

  it('the template header matches the importer columns exactly', () => {
    const [header] = parseCsv(readFileSync(path.join(INTAKE, 'questions.template.csv'), 'utf8'));
    expect(header).toEqual([...QUESTION_COLUMNS]);
  });
});
