import { DEV_DEFAULT_API_BASE_URL, resolveApiBaseUrl } from '../../src/config/env';

describe('resolveApiBaseUrl (decision J)', () => {
  it('uses the localhost default only in development', () => {
    expect(resolveApiBaseUrl(undefined, true)).toEqual({ ok: true, url: DEV_DEFAULT_API_BASE_URL });
    expect(resolveApiBaseUrl(undefined, false)).toEqual({ ok: false, problem: 'missingApiUrl' });
    expect(resolveApiBaseUrl('  ', false)).toEqual({ ok: false, problem: 'missingApiUrl' });
  });

  it('requires HTTPS in production', () => {
    expect(resolveApiBaseUrl('http://api.example.org/api/v1', false)).toEqual({
      ok: false,
      problem: 'insecureApiUrl',
    });
    expect(resolveApiBaseUrl('https://api.example.org/api/v1', false)).toEqual({
      ok: true,
      url: 'https://api.example.org/api/v1',
    });
  });

  it('allows plain HTTP in development (emulator, LAN phone)', () => {
    expect(resolveApiBaseUrl('http://10.0.2.2:4000/api/v1', true)).toEqual({
      ok: true,
      url: 'http://10.0.2.2:4000/api/v1',
    });
  });

  it('removes trailing slashes', () => {
    expect(resolveApiBaseUrl('https://api.example.org/api/v1///', false)).toMatchObject({
      url: 'https://api.example.org/api/v1',
    });
  });

  it.each([
    'not a url',
    'ftp://api.example.org',
    'https://user:secret@api.example.org/api/v1',
    'https://api.example.org/api/v1?key=abc',
    'https://api.example.org/api/v1#x',
  ])('rejects %s', (value) => {
    expect(resolveApiBaseUrl(value, true)).toEqual({ ok: false, problem: 'invalidApiUrl' });
  });
});
