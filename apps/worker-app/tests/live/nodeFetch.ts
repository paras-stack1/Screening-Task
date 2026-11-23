import http from 'http';
import https from 'https';

/**
 * React Native's Jest setup replaces global fetch with a polyfill that cannot reach a server, so
 * the opt-in live tests talk to the API through Node's http module. Only the subset used by
 * src/services/api/http.ts is implemented (status, ok, headers.get, text, abort).
 */
export const nodeFetch = ((input: string, init: RequestInit = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(input);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      { method: init.method ?? 'GET', headers: init.headers as Record<string, string> },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (name: string) => (response.headers[name.toLowerCase()] as string) ?? null },
            text: async () => body,
          });
        });
      },
    );
    request.on('error', reject);
    init.signal?.addEventListener('abort', () => request.destroy(new Error('aborted')));
    if (init.body) request.write(init.body);
    request.end();
  })) as unknown as typeof fetch;
