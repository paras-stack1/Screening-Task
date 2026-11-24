# Step 7 - Security review

> Internal review of stages 7B-7G (2026-11-24), by the implementing engineer - **not** an external
> penetration test. Evidence = automated tests that were run (see [test-report.md](test-report.md)).

## Controls

| Area | Control | Evidence |
|---|---|---|
| Authentication | Every Step 7 route requires a valid access token (Step 3 JWT + refresh rotation) | Route inventory in `tests/apiSecurity.test.ts`: 47 Step 7 routes -> 401 without a token |
| RBAC | Route permission as a first filter; the service re-decides every action from the caller's permissions **over the child's current area** | DB tests: workers cannot approve, track, close, cancel after issue, assign others, administer facilities |
| Area scope / IDOR / BOLA | All child-linked reads and writes go through `scopedWhere` / `assertInScopeOrDeny` (results, runs, reviews, referrals, follow-ups); out of scope = 404, the same as missing, with a DENIED audit row | Table-driven scope tests for every entity incl. `screeningResultRun` and `clinicalReview`; other-district tests for results, reviews, referrals, follow-ups, facilities, reports |
| Identity from the session | Reviewer, creator, approver, assignee-by, changed-by, actor role are taken from the authenticated user; strict request bodies reject extra fields | Tests sending `reviewerId`, `status`, `approvedById`, `createdById`, `origin`, `verificationStatus` -> 400 |
| Server-decided outcomes | Results, verification of tracking updates (from the source), consent verification, facility verification, allowed actions | Tests: client cannot send verification; facility verification only via verify action |
| Consent | REFERRAL_DATA_SHARING verified at issue (`assertConsentPermits`), consent id + time recorded; missing/withdrawn -> 403 audited; no exceptions implemented | DB test + mutation check (removing the check fails the test) |
| Clinical safety | No clinical rule in code; demonstration rules never approvable or used in production; missing data never "no concern" | 38 evaluator tests + 3 mutation checks; DB CHECKs |
| Integrity | Append-only history, state machines, version guards, duplicate guards in the database (see database-design.md); runtime account cannot DELETE/TRUNCATE history | DB rule tests; grants verified on dev |
| Idempotency | `clientOperationId` replay for referrals and follow-ups; dedupe keys for notifications | Replay and duplicate tests |
| Data minimisation | Referrals store references (screening, result, review, consent), not copies; notifications hold ids only; audit details hold labels/ids only | Tests assert no names / notes in notifications and audit rows |
| Free text | Review notes, referral reasons, event reasons/notes, follow-up notes encrypted (`enc1:`, AES-256-GCM, bound to record and field) | Tests assert `enc1:` in the database |
| Aggregate reports | report.aggregate scope only; no child listed; counts 1-4 suppressed | DB + portal tests |
| Input | Zod strict schemas, fixed sort orders (unknown `sort` -> 400), page size <= 50, exact decimal thresholds, safe ORM queries | Tests for unknown sort/fields |
| Web portal | React escapes all text; existing strict CSP (stage PE); facility history changes rendered as text | Portal tests; production build |
| Rate limiting | Existing per-user data limiter on all Step 7 routers | Existing rate-limit tests (per process - known limitation) |
| Notifications | After commit, failures logged without content and never undo a change; no push/SMS/e-mail | Code review; reminder job idempotency test |

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | `npm audit`: 32 advisories (28 moderate, 4 high), all in development/build tooling (Prisma CLI via `deepmerge-ts` / `effect`, Jest, typescript-eslint, Expo tooling). Lockfile unchanged since the admin portal; the advisories are new. The runtime API and apps do not load these packages. The Prisma CLI fix needs Prisma 7, which is not allowed | Medium (tooling only) | Open - documented; re-check before release |
| F2 | Rate limits are per process (Step 3 known limitation) | Medium | Open (unchanged) |
| F3 | Facility list/detail readable by any referral or facility permission holder across areas (facility data is not child data) | Low | Accepted - directory information only |
| F4 | A medical officer may review a screening they conducted (shown, not blocked) | Low | Open - programme decision |
| F5 | Index performance not load-tested | Low | Open |

No Critical or High finding in Step 7 code. Not done: external penetration test, load test, device
testing.
