# Step 6 Test Report

> All numbers below come from runs executed on 2026-11-22/23 on the developer machine (Windows,
> Node 22, PostgreSQL 17 in Docker). Nothing is estimated. Not run: device tests, load tests,
> external penetration test, live API smoke test with the app.

## 1. Summary

| Test Category | Total | Passed | Failed | Status |
|---|---|---|---|---|
| Backend (API unit, no database) | 362 | 362 | 0 | Pass |
| Frontend (Jest, worker app) | 2060 | 2050 | 0 (10 skipped) | Pass |
| Security (subset: `apiSecurity` 71 + `authorization` 76 + `accessScope` 20) | 167 | 167 | 0 | Pass |
| Database (real PostgreSQL + real HTTP API) | 299 | 299 | 0 | Pass (see S6-005) |
| Regression (Steps 1-5: API unit 254, DB 235, the 20 pre-existing frontend suites) | 489 + 20 suites | all | 0 | Pass |

Security is a subset of the backend and database rows, not extra tests. The 10 skipped frontend
tests are the pre-existing live-API tests (skipped without a running server).

Other checks: TypeScript, all workspaces: 0 errors. ESLint: 0 problems. Prettier: clean.
`prisma migrate diff`: no drift (6B). `npm audit --omit=dev`: 24 advisories, unchanged.

## 2. Baseline vs final

| Suite | Before Step 6 | After 6B | After 6C | After 6D | Final (6E) |
|---|---|---|---|---|---|
| API unit | 254 | 295 | 346 | 346 | **362** |
| Database | 235 | 268 | 299 | 299 | **299** |
| Frontend | 1433 + 10 skipped | 1433 | 1433 | 1920 | **2050** + 10 skipped |

## 3. Step 6 test files

| File | Tests | Covers (brief section 20) |
|---|---|---|
| `services/api/tests/screeningRules.test.ts` | 41 | E age: day boundaries, leap years, month/year transitions, future DOB, India date, estimated DOB; B protocol selection and applicability; content hash; definition validation; demo content |
| `services/api/tests/screeningSessionRules.test.ts` | 50 | D measurements: units, conversion, decimals, NaN/Infinity/sign/exponent, plausibility, future time; C answer types and states; completeness; F mass assignment |
| `services/api/tests/apiSecurity.test.ts` (+16) | 71 | F unauthenticated, invalid and forged tokens on every route |
| `services/api/tests/errors.test.ts` (+1) | 15 | Trigger violation → 409, no database text |
| `services/api/tests/db/screeningFoundation.test.ts` | 33 | G integrity triggers, lifecycle, approval, overlap, historical template preservation; protocol API; eligibility incl. consent, scope, estimated DOB |
| `services/api/tests/db/screeningSessions.test.ts` | 31 | A sessions (create, idempotent, duplicate, consent, cancel, complete, history); B D1-D4; C responses; D measurements and corrections; F IDOR/BOLA, ownership, role, rate limit; G concurrency, idempotent completion, audit content |
| `apps/worker-app/tests/screening/answerDraft.test.ts` | 7 | Unknown never "No", missing stays missing, only changes sent |
| `apps/worker-app/tests/screens/screening.test.tsx` | 21 | H dashboard, child selection, consent restriction, categories, answers, validation, save, version conflict, network failure, leave warning, accessibility, measurements, session expiry, Hindi |
| `apps/worker-app/tests/screens/screeningComplete.test.tsx` | 8 | H review and complete, idempotent confirm, summary wording, read-only, cancel, history, Hindi |

## 4. Mutation checks (do the tests catch real breakage?)

Each safeguard was removed, the suite run, and the file restored.

| Mutation | Caught by |
|---|---|
| Ignore protocol effective date | `screeningRules` |
| Drop consent blocker in eligibility | `screeningFoundation` (3 tests) |
| Show drafts in production | `screeningFoundation` |
| Skip approver permission | `screeningFoundation` |
| Remove owner check | `screeningSessions` (2) |
| Remove version check | `screeningSessions` (3) |
| Remove consent re-check on writes | `screeningSessions` |
| Remove area-scope check on writes | `screeningSessions` (2) |
| Remove idempotent completion | `screeningSessions` |
| Remove required-question pre-check | `screeningSessions` (2) |
| App: source not required | frontend (3) |
| App: no unsaved-changes guard | frontend |
| App: Start not blocked by consent | frontend |
| App: Unknown carries a value | frontend |

All 14 mutations were caught.

## 5. Known test limitations

- S6-005: one unexplained DB test timeout in five full runs.
- The frontend runs against an in-memory fake API (`tests/support/fakeScreening.ts`) that
  validates requests with the real contracts. The real API is covered by the DB suite, but the
  two have not been run together end to end on a device.
- Hindi strings are checked for presence, placeholders and script, not for meaning.
