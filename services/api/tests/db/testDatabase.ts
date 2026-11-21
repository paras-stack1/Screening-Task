import { PrismaClient } from '@prisma/client';

/** Returns TEST_DATABASE_URL after checking it can only point at a disposable test database. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set (see services/api/.env.example)');
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to use database "${name}": test database names must end in "_test"`);
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: testDatabaseUrl() });
}

/**
 * Empties every table except AuditLog (append-only by design; it has no foreign keys, so stale
 * rows cannot break other tables) and the migration history. Call at the start of each test file.
 */
export async function resetData(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT IN ('AuditLog', '_prisma_migrations')`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
