import { execFileSync } from 'node:child_process';
import { testDatabaseUrl } from './testDatabase';

/**
 * Brings the test database up to the committed migrations with `prisma migrate deploy` - the
 * same non-destructive command production uses, including the hand-written SQL additions.
 * Each test file then clears data with resetData() (refuses non-"_test" databases).
 *
 * One-time setup (PowerShell, repo root):
 *   docker exec balswasthya-postgres psql -U balswasthya -d balswasthya_dev -c "CREATE DATABASE balswasthya_test"
 * If a migration file was edited after it was applied, drop and recreate balswasthya_test manually.
 */
export default function setup() {
  const url = testDatabaseUrl(); // throws unless the database name ends in _test

  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
      env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
    });
  } catch (error) {
    const output = (error as { stderr?: Buffer; stdout?: Buffer }).stderr?.toString() ?? '';
    throw new Error(`prisma migrate deploy failed for the test database:\n${output}`);
  }
}
