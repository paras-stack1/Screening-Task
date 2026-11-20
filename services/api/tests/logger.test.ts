import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/utils/logger';

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  const destination: DestinationStream = {
    write: (msg: string) => {
      lines.push(JSON.parse(msg) as Record<string, unknown>);
    },
  };
  return { lines, destination };
}

describe('logger', () => {
  it('writes structured JSON with message, level label and ISO time', () => {
    const { lines, destination } = capture();
    createLogger('info', destination).info('api_started', { port: 4000 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'info', message: 'api_started', port: 4000 });
    expect(String(lines[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts secrets and common personal-data fields', () => {
    const { lines, destination } = capture();
    createLogger('info', destination).info('event', {
      workerId: 'w-1',
      password: 'hunter2',
      phone: '9876543210',
      session: { refreshToken: 'rt-secret', accessToken: 'at-secret' },
      headers: { 'x-api-key': 'ai-key', accept: 'application/json' },
    });

    const serialized = JSON.stringify(lines[0]);
    for (const secret of ['hunter2', '9876543210', 'rt-secret', 'at-secret', 'ai-key']) {
      expect(serialized).not.toContain(secret);
    }
    expect(lines[0]).toMatchObject({ workerId: 'w-1', headers: { accept: 'application/json' } });
  });

  it('writes nothing when silent', () => {
    const { lines, destination } = capture();
    createLogger('silent', destination).error('ignored');
    expect(lines).toHaveLength(0);
  });
});
