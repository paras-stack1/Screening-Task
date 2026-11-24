# Step 7 - Bug report

> Severity per the Step 7 brief (Critical / High / Medium / Low). No Critical or High defect was
> found or is open. All entries below were found by our own checks during Step 7.

| ID | Stage | Severity | Description | Status |
|---|---|---|---|---|
| S7-001 | 7B | Low | First run of the Step 7 migration failed on the test database: an enum-to-text cast is not allowed in an index expression (duplicate-referral index) | Fixed before any data was written (the migration rolled back completely); now two partial indexes. Regression: DB test "one active referral per screening and category" |
| S7-002 | 7B | Low | `db:rule-set-import` contained a literal byte-order-mark character instead of the escape (lint `no-irregular-whitespace`) | Fixed: character-code check. Found by lint before commit |
| S7-003 | 7E | Low | Contract typed the review queue's `overallOutcome` as a plain string, so the app needed casts | Fixed: typed as a result outcome; API and app typecheck |
| S7-004 | 7C-7G | Low | Under heavy parallel load (database suite and portal / app suites at the same time) some tests hit their 20 s timeout on this machine (slow Docker disk, see S6-005) | Open - not a product defect: every affected test passes alone and in sequential full runs (see test-report.md) |
| S6-005 | 6E | Low | One-off DB test timeout (Step 6) | Open, same cause as S7-004 most likely |

## S7-001 details

- **Reproduction:** `prisma migrate deploy` of the first draft on the test database.
- **Root cause:** `COALESCE("category"::text, '')` in a unique index - casts from enum to text are
  not IMMUTABLE in PostgreSQL.
- **Files:** `services/api/prisma/migrations/20261124100000_step7_results_referrals/migration.sql`.
- **Impact:** none (test database, transaction rolled back, no data).
- **Fix:** `referral_one_active_per_category` and `referral_one_active_without_category`.
- **Verification:** migration applied to test and dev; duplicate tests pass.

No defect was found in code from Steps 1-6 or the admin portal during Step 7 regression runs.
