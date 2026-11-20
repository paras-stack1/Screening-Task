import type { ReadableStream } from 'node:stream/web';

/** Thrown when an upstream response body exceeds the allowed size. */
export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response body exceeds ${maxBytes} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Reads and parses a JSON response body, aborting once it exceeds `maxBytes`.
 * Protects the API from a misbehaving upstream service streaming an unbounded body.
 * The fetch's own AbortSignal timeout still applies while the body is read.
 */
export async function readJsonWithLimit(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!response.body) {
    throw new SyntaxError('Empty response body');
  }

  // Node's fetch types the body stream as ReadableStream<any>; it yields bytes.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
