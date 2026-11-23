import { describe, expect, it } from 'vitest';
import { devScriptRefusal } from '../prisma/devGuard';

describe('development-only scripts refuse anything but a local development database (PE-2)', () => {
  const local = 'postgresql://user:pw@localhost:5433/balswasthya_dev';

  it.each([
    [local],
    ['postgresql://user:pw@127.0.0.1:5433/balswasthya_dev'],
    ['postgresql://user:pw@[::1]:5433/balswasthya_dev'],
  ])('allows %s', (url) => {
    expect(devScriptRefusal({ NODE_ENV: 'development', DATABASE_URL: url })).toBeNull();
    expect(devScriptRefusal({ DATABASE_URL: url })).toBeNull();
  });

  it.each([
    ['postgresql://user:pw@db.internal.example:5432/balswasthya', /this computer/],
    ['postgresql://user:pw@10.0.0.5:5432/balswasthya', /this computer/],
    ['not a url', /valid URL/],
  ])('refuses %s even without NODE_ENV', (url, message) => {
    expect(devScriptRefusal({ DATABASE_URL: url })).toMatch(message);
  });

  it('refuses production and a missing database URL', () => {
    expect(devScriptRefusal({ NODE_ENV: 'production', DATABASE_URL: local })).toMatch(/production/);
    expect(devScriptRefusal({})).toMatch(/not set/);
  });
});
