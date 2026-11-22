# Step 6 Bug Report

> Living log, updated per stage. Severity per the Step 6 classification (Critical / High / Medium
> / Low). No Critical or High defect is open.

| ID | Stage | Severity | Description | Status |
|---|---|---|---|---|
| S6-001 | 6C | Medium | Categories in a session were ordered by start time; two categories started in the same millisecond came back in an arbitrary order | Fixed |
| S6-002 | 6C | Medium | A database integrity-rule violation that the service did not pre-check reached the client as 500 `INTERNAL_ERROR` | Fixed |

## S6-001 - Non-deterministic category order

- **Reproduction:** start two categories with the same server time (test clock), complete the
  session, read it: the order of `sessionCategories` varied between runs.
- **Root cause:** `orderBy: { startedAt: 'asc' }` with ties.
- **Affected files:** `services/api/src/modules/screening/sessionDto.ts`.
- **Impact:** no data impact; the screens could show categories in a different order on reload.
  Found by a flaky test.
- **Fix:** order by Four-D category (D1 to D4; PostgreSQL orders enums by declaration), which is
  deterministic and is the display order.
- **Regression test:** `tests/db/screeningSessions.test.ts` "completes once ..." asserts D2 before
  D3 although D3 was started first. Ran twice, passed.

## S6-002 - Trigger violations answered as 500

- **Reproduction:** mutation test that removes the service's required-question pre-check, then
  completes a category with a missing answer: the database trigger refused the change (correct),
  but the client received 500.
- **Root cause:** Prisma reports PostgreSQL `RAISE ... check_violation` from triggers as
  `PrismaClientUnknownRequestError`, which the error handler did not map.
- **Affected files:** `services/api/src/middleware/errorHandler.ts`.
- **Impact:** no data impact (the change was refused); misleading error for the app.
- **Fix:** SQLSTATE 23514 → 409 `INTEGRITY_RULE_VIOLATION`, 40001 → 409 `TRANSACTION_CONFLICT`.
  The database message is never returned.
- **Regression test:** `tests/errors.test.ts` "maps a database integrity-rule violation ...".
  Re-running the mutation now yields 409.
