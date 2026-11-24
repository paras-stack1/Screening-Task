import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * SMS delivery (Step 8, decision PP7). The API only talks to SMS through this interface.
 *
 * - `none`: no provider configured. Nothing is sent; the caller records NOT_CONFIGURED and never
 *   reports a message as delivered. This is the production default until a provider and
 *   DLT-registered templates are approved.
 * - `mock`: DEVELOPMENT AND TESTS ONLY. Messages are kept in memory (tests) and appended to a
 *   local, git-ignored file `services/api/.dev-sms/outbox.log` so a developer can open the link
 *   or read the code. Never the application log. The configuration refuses `mock` in production.
 *
 * Callers pass only fixed templates; message text never contains health information.
 */
export type SmsTemplateId = 'PARENT_INVITATION' | 'PARENT_OTP';

export interface SmsRequest {
  /** Plain mobile number, e.g. +919876543210. */
  to: string;
  templateId: SmsTemplateId;
  /** Template parameters (link / code / minutes). */
  params: Record<string, string>;
}

export interface SmsResult {
  status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED';
  provider: string;
  providerMessageId?: string;
  error?: string;
}

export interface SmsSender {
  readonly provider: string;
  readonly configured: boolean;
  send(request: SmsRequest): Promise<SmsResult>;
}

/** Fixed message templates (English + Hindi). No child names, no health details. */
export function renderTemplate(templateId: SmsTemplateId, params: Record<string, string>): string {
  switch (templateId) {
    case 'PARENT_INVITATION':
      return (
        `BalSwasthya: aapko Parent Portal ka nimantran mila hai / you are invited to the Parent Portal. ` +
        `Link (valid ${params.hours ?? '24'} h): ${params.link ?? ''}`
      );
    case 'PARENT_OTP':
      return `BalSwasthya code: ${params.code ?? ''}. Valid ${params.minutes ?? '5'} min. Do not share it.`;
  }
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '****' : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function createNoSmsSender(): SmsSender {
  return {
    provider: 'none',
    configured: false,
    send: () => Promise.resolve({ status: 'NOT_CONFIGURED', provider: 'none' }),
  };
}

export interface MockSmsSender extends SmsSender {
  /** Messages "sent" in this process (tests read the link / code here). */
  readonly outbox: Array<SmsRequest & { text: string; at: Date }>;
}

export function createMockSmsSender(options: { outboxFile?: string | null } = {}): MockSmsSender {
  const outbox: MockSmsSender['outbox'] = [];
  const file =
    options.outboxFile === undefined
      ? path.resolve(process.cwd(), '.dev-sms', 'outbox.log')
      : options.outboxFile;
  return {
    provider: 'mock',
    configured: true,
    outbox,
    send(request) {
      const text = renderTemplate(request.templateId, request.params);
      outbox.push({ ...request, text, at: new Date() });
      if (file) {
        mkdirSync(path.dirname(file), { recursive: true });
        appendFileSync(file, `${new Date().toISOString()} [DEV SMS to ${maskPhone(request.to)}] ${text}\n`);
      }
      return Promise.resolve({ status: 'SENT', provider: 'mock', providerMessageId: `dev-${outbox.length}` });
    },
  };
}
