// Creates/updates the least-privilege runtime database account in the LOCAL Docker database.
// Usage (repo root):  npm run db:setup-roles
//
// Reads POSTGRES_USER, POSTGRES_DB, APP_DB_USER and APP_DB_PASSWORD from the root .env and runs
// setup-app-role.sql inside the balswasthya-postgres container. All values, including the
// password, go to psql over stdin - never on a command line, never printed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER = 'balswasthya-postgres';
const here = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = join(here, '..', '..', '.env');

function readEnvFile(path) {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function fail(message) {
  console.error(`db:setup-roles: ${message}`);
  process.exit(1);
}

let env;
try {
  env = readEnvFile(rootEnvPath);
} catch {
  fail('root .env not found. Run: Copy-Item .env.example .env');
}

const required = ['POSTGRES_USER', 'POSTGRES_DB', 'APP_DB_USER', 'APP_DB_PASSWORD'];
const missing = required.filter((key) => !env[key]);
if (missing.length) fail(`missing in root .env: ${missing.join(', ')}`);
if (env.APP_DB_USER === env.POSTGRES_USER) fail('APP_DB_USER must differ from POSTGRES_USER');
if (env.APP_DB_PASSWORD.length < 16) fail('APP_DB_PASSWORD must be at least 16 characters');

/** psql quoted value: single quotes doubled. */
const psqlQuote = (value) => `'${value.replaceAll("'", "''")}'`;

const script =
  [
    `\\set app_user ${psqlQuote(env.APP_DB_USER)}`,
    `\\set app_password ${psqlQuote(env.APP_DB_PASSWORD)}`,
    `\\set db_name ${psqlQuote(env.POSTGRES_DB)}`,
    `\\set owner_user ${psqlQuote(env.POSTGRES_USER)}`,
  ].join('\n') +
  '\n' +
  readFileSync(join(here, 'setup-app-role.sql'), 'utf8');

const result = spawnSync(
  'docker',
  ['exec', '-i', CONTAINER, 'psql', '-X', '-q', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB],
  { input: script, encoding: 'utf8' },
);

if (result.error) fail(`could not run docker: ${result.error.message}`);
process.stdout.write(result.stdout ?? '');
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? '');
  fail(`psql exited with code ${result.status}. Is the database running? (npm run db:up)`);
}
