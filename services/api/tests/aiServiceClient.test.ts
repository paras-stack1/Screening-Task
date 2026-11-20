import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiServiceClient } from '../src/integrations/ai-service/aiServiceClient';

/** Fake AI service on a random local port, so the real fetch/timeout/size logic is exercised. */
const openServers: Array<() => Promise<void>> = [];

async function fakeAiService(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  openServers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((close) => close()));
});

const HEALTHY = JSON.stringify({
  status: 'ok',
  service: 'ai-service',
  version: '0.1.0',
  modelsLoaded: false,
});

function client(baseUrl: string, overrides: { timeoutMs?: number; maxResponseBytes?: number } = {}) {
  return createAiServiceClient({ baseUrl, apiKey: 'test-key', timeoutMs: 1_000, ...overrides });
}

describe('AI service client - health contract', () => {
  it('reports not_configured when no URL is set', async () => {
    expect(await client('').getStatus()).toBe('not_configured');
  });

  it('reports up for a valid response and sends the API key', async () => {
    let receivedKey: string | undefined;
    const url = await fakeAiService((req, res) => {
      receivedKey = req.headers['x-api-key'] as string | undefined;
      res.setHeader('Content-Type', 'application/json').end(HEALTHY);
    });
    expect(await client(url).getStatus()).toBe('up');
    expect(receivedKey).toBe('test-key');
  });

  it('reports down for a non-2xx response', async () => {
    const url = await fakeAiService((_req, res) => {
      res.statusCode = 500;
      res.end('{}');
    });
    expect(await client(url).getStatus()).toBe('down');
  });

  it('reports down when the response breaks the contract', async () => {
    const url = await fakeAiService((_req, res) => res.end(JSON.stringify({ status: 'ok' })));
    expect(await client(url).getStatus()).toBe('down');
  });

  it('reports down for invalid JSON', async () => {
    const url = await fakeAiService((_req, res) => res.end('<html>not json'));
    expect(await client(url).getStatus()).toBe('down');
  });

  it('reports down when the service is unreachable', async () => {
    const url = await fakeAiService((_req, res) => res.end(HEALTHY));
    await Promise.all(openServers.splice(0).map((close) => close()));
    expect(await client(url).getStatus()).toBe('down');
  });

  it('does not follow redirects (even to a healthy-looking target)', async () => {
    const url = await fakeAiService((req, res) => {
      if (req.url === '/health') {
        res.statusCode = 302;
        res.setHeader('Location', '/elsewhere');
        res.end();
        return;
      }
      res.end(HEALTHY); // following the redirect would report "up"
    });
    expect(await client(url).getStatus()).toBe('down');
  });
});

describe('AI service client - resource limits', () => {
  it('gives up after the timeout', async () => {
    const url = await fakeAiService((_req, res) => {
      setTimeout(() => res.end(HEALTHY), 2_000).unref();
    });
    const started = Date.now();
    expect(await client(url, { timeoutMs: 100 }).getStatus()).toBe('down');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('rejects a body whose declared length is over the limit', async () => {
    const url = await fakeAiService((_req, res) => {
      res.setHeader('Content-Length', '5000');
      res.end('x'.repeat(5000));
    });
    expect(await client(url, { maxResponseBytes: 100 }).getStatus()).toBe('down');
  });

  it('rejects a streamed body that grows over the limit', async () => {
    const url = await fakeAiService((_req, res) => {
      for (let i = 0; i < 20; i += 1) res.write('x'.repeat(64)); // chunked, no Content-Length
      res.end();
    });
    expect(await client(url, { maxResponseBytes: 100 }).getStatus()).toBe('down');
  });
});
