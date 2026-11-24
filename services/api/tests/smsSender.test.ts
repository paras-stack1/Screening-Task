import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createMockSmsSender,
  createNoSmsSender,
  maskPhone,
  renderTemplate,
} from '../src/integrations/sms/smsSender';

describe('SMS adapters (Step 8, PP7)', () => {
  it('the "none" sender never sends and reports NOT_CONFIGURED', async () => {
    const sender = createNoSmsSender();
    expect(sender.configured).toBe(false);
    await expect(
      sender.send({ to: '+919876543210', templateId: 'PARENT_OTP', params: { code: '123456' } }),
    ).resolves.toEqual({
      status: 'NOT_CONFIGURED',
      provider: 'none',
    });
  });

  it('the development mock keeps messages in memory and in its own outbox file, phone masked', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'sms-')), 'outbox.log');
    const sender = createMockSmsSender({ outboxFile: file });
    const result = await sender.send({
      to: '+919876543210',
      templateId: 'PARENT_INVITATION',
      params: { link: 'https://parent.example.test/invite#abc', hours: '24' },
    });
    expect(result).toMatchObject({ status: 'SENT', provider: 'mock' });
    expect(sender.outbox).toHaveLength(1);
    const written = readFileSync(file, 'utf8');
    expect(written).toContain('https://parent.example.test/invite#abc');
    expect(written).toContain('******3210');
    expect(written).not.toContain('9876543210');
  });

  it('templates carry only the link or code - no child or health details', () => {
    expect(renderTemplate('PARENT_INVITATION', { link: 'L', hours: '24' })).toMatch(
      /Parent Portal.*valid 24 h\): L$/,
    );
    expect(renderTemplate('PARENT_OTP', { code: '654321', minutes: '5' })).toBe(
      'BalSwasthya code: 654321. Valid 5 min. Do not share it.',
    );
  });

  it('masks all but the last four digits', () => {
    expect(maskPhone('+91 98765 43210')).toBe('********3210');
    expect(maskPhone('123')).toBe('****');
  });
});
