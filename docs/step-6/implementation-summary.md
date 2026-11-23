# Step 6 - Final Implementation Report: Four-D Child Health Screening

> Date: 2026-11-23 (updated after stage 6F). Branch `feat/step-6-screening`. Commits: `7d9cecf` (audit), `2080c05` (6B),
> `08aff86` (6C), `dc2a2b7` (6D); stage 6E is **not yet committed**. Screening support only: the
> system never diagnoses, classifies, scores or recommends treatment.

## 1. Initial repository findings

The approved schema already had screening tables (protocol, question, session, observation,
measurement, result), all empty and unused. It had one protocol per session, and wording lived in
the app's translation files. There was no offline storage and no approved clinical content.
Reusable modules: authentication, area-scope access control, consent at point of use,
idempotency, audit, calendar dates. Details: [initial-audit.md](initial-audit.md).

## 2. Existing modules reused

`authenticate`, `requirePermission` (extended to any-of), `accessScope` (`findChildOrDeny`,
`assertInScopeOrDeny`, `scopedWhere.screeningSession`), `consentPolicy.evaluateConsents` /
`assertConsentPermits`, `runIdempotent`, `recordAudit`, shared date helpers, the data rate limiter,
the error handler, and the worker app's `ApiClient`, query client, components, localization,
`newSubmissionId`, and the Step 5 consent screens.

## 3. Files created

- **Database:** `services/api/prisma/migrations/20261122120000_step6_screening_foundation/`,
  `prisma/protocol-status.ts`.
- **API:** `services/api/src/modules/screening/` - `protocolContent`, `demoProtocols`,
  `protocolSelection`, `protocolLifecycle`, `screeningAge`, `protocols.service`,
  `protocols.routes`, `measurementRules`, `responseRules`, `sessionDto`, `screenings.service`,
  `screenings.routes`.
- **Contracts:** `packages/shared-contracts/src/screening.ts`.
- **App:** `apps/worker-app/app/(app)/screening/` - `_layout`, `index`, `select-child`,
  `start/[childId]`, `[sessionId]/{index,category/[category],measurements,review,summary}`,
  `history/[childId]`; `src/features/screening/` - `api`, `hooks`, `routes`, `labels`, `errors`,
  `answerDraft`, `components/{ScreeningParts,QuestionField,SessionSummary,CancelSessionCard}`.
- **Tests:** API `screeningRules`, `screeningSessionRules`, `db/screeningFoundation`,
  `db/screeningSessions`; app `screening/answerDraft`, `screens/screening`,
  `screens/screeningComplete`, `support/fakeScreening`.
- **Docs:** `docs/step-6/*` (10 files), `docs/frontend/screening.md`.

## 4. Files modified

`prisma/schema.prisma`, `prisma/seed.ts`, `infrastructure/db/setup-app-role.sql`, `package.json`
(both), `src/app.ts`, `src/routes/index.ts`, `src/middleware/{authorize,errorHandler}.ts`,
`shared-contracts/src/{dates,index}.ts`, `tests/{apiSecurity,errors}.test.ts`,
`tests/db/{authzFixture,authorization.test}.ts`; app `(app)/_layout.tsx`, child profile, dashboard
sections, `queryKeys`, `en.ts`, `hi.ts`, test support and existing tests whose expectations changed
on purpose; `docs/database-design.md` (D13).

## 5. Database changes proposed

Section 8 of [initial-audit.md](initial-audit.md), approved as decisions A-K, N, O.

## 6. Database migrations executed

`20261122120000_step6_screening_foundation`, applied to the dev and test databases with
`prisma migrate deploy` (non-destructive). It is additive: it refuses to run on non-empty
screening tables, and the status type was changed in place. `db:setup-roles` was re-run. The dev
database was seeded with the 4 demonstration protocols. Checksum verified unchanged after
application. Details: [screening-data-model.md](screening-data-model.md).

## 7. Backend functionality

Read-only protocols API; per-child eligibility; sessions: start (idempotent), list, summary,
detail, history, categories, section saves, finish/reopen, measurements and corrections,
idempotent completion, cancellation; governed protocol lifecycle script. See
[screening-api.md](screening-api.md).

## 8. Frontend functionality

Screening home with real counts and resume; choose child; eligibility and consent check;
session hub; sectioned questions; measurements; review and complete; summary and details; cancel;
history; dashboard metric and entry points; Hindi and English. See
[../frontend/screening.md](../frontend/screening.md).

## 9. Four-D workflow status

All four categories have a complete technical workflow, independent of each other. Partial
screening is supported: a completed session reports areas finished, incomplete and not assessed.
See [four-d-workflow.md](four-d-workflow.md). **Clinical content: demonstration only.**

## 10. Template versioning

One protocol per category, age band and version. Wording is stored in both languages, with a
SHA-256 fixed at review. Lifecycle DRAFT → IN_REVIEW → APPROVED → ACTIVE → RETIRED is enforced by
triggers. Content is frozen once reviewed or used. Each category records the exact version and
its status at use, and approved content is re-hashed before use. There is no editing API. See
[clinical-content-governance.md](clinical-content-governance.md).

## 11. Consent integration

SCREENING consent is required to start, re-checked inside every write transaction, and enforced
by a database trigger on session creation. The consent relied on is recorded on the session. A
withdrawal blocks further writes but still allows cancellation. Media and AI consents are not used
(no media in Step 6).

## 12. Geographic authorization

Every session resource is resolved through the child's current area. Out of scope = 404 (same as
non-existent), audited. Lists, history and counts are scope-filtered.

## 13. Security controls

See [security-review.md](security-review.md): authentication, role permissions, area scope,
nested ownership, owner-only writes, consent, strict schemas, row locks and versions, triggers,
runtime-account grants, audit without health values, rate limits, safe errors, no device storage.

## 14. Automated tests executed

API unit (Vitest), API database (Vitest, real PostgreSQL + HTTP), worker app (Jest, real routes
against a contract-validated fake API), 14 mutation checks. See [test-report.md](test-report.md).

## 15. Test results (final, after stage 6F)

| Test Category | Total | Passed | Failed | Status |
|---|---|---|---|---|
| Backend | 374 | 374 | 0 | Pass |
| Frontend | 2091 | 2073 | 0 (18 skipped: opt-in live tests) | Pass |
| Security | 167 | 167 | 0 | Pass (subset of Backend + Database) |
| Database | 304 | 304 | 0 | Pass (1 unexplained timeout in an earlier 6E run, S6-005) |
| Live end to end (app modules → running API → dev DB) | 8 | 8 | 0 | Pass (opt-in, 6F) |
| Regression | 489 + 20 suites | all | 0 | Pass |

## 16. Critical bugs discovered

None.

## 17. Bugs fixed

S6-001 non-deterministic category order (Medium); S6-002 trigger violations answered as 500
(Medium); S6-003 screening screens unreachable through `href: null` (Medium); S6-004 screening
routes missing from the authentication inventory (Medium). See [bug-report.md](bug-report.md).

## 18. Remaining bugs

S6-005 (Low): one DB test timed out once in five full runs; not reproducible, cause not proven.

## 19. Clinical approvals still required

1. The real Four-D questions, wording (hi/en), options, age bands and guideline references.
2. The clinical approver role and approval evidence (assumed: a `screening.review` holder plus a
   reference).
3. The intake format and review checklist for new content.
4. Measurement data-quality ranges and precision per unit (current values are **assumptions**).
5. Scoring and referral rules (none implemented).
6. Policy for estimated dates of birth in age-band selection.
7. An amendment workflow for completed screenings.
8. Review of all Hindi screening text by a qualified translator.

## 20. Known limitations

No approved content, so nothing is operational in production. Online only. No amendments
(waiting for the programme's policy). Structured answers and measurements rely on disk/database
encryption (free text is encrypted at application level since 6F). Rate limits are per process.
Supervisors can read answers (decision M). Not done: testing on a phone, load testing, external
penetration testing. (6F added an automated end-to-end run of the app's modules against the real
API; see section 24.)

## 21. Manual testing instructions

1. `npm run db:up`, then `npx prisma migrate deploy` (in `services/api`), `npm run db:setup-roles`,
   `npm run db:seed`.
2. Create a worker with the ASHA role in a demo village (Step 3 user and assignment API).
3. `npm run dev:api`, then `npm run dev:app`; sign in as the worker.
4. Register a child (Step 5); record SCREENING consent.
5. Dashboard → Start screening → choose the child. Check the age, the consent and the
   demonstration banner. Start.
6. Start Defects at birth. Answer one part, try Save without "who gave this information" (refused),
   use Unknown on a required question, finish. Leave another area unfinished.
7. Measurements: try `12.345 kg` (refused), `3250 g` (saved, shows 3.25 kg), correct it with a reason.
8. Review → Complete. Check the summary: observations only, the incomplete area, the not-assessed
   areas, no recommendation.
9. Child profile → Screening history. Start a new screening and cancel it with a reason.
10. Withdraw consent (Step 5) during an open screening: saving is refused; cancelling works.

## 22. Commands

```powershell
npm install
npm run db:up
cd services/api; npx prisma migrate deploy; cd ../..
npm run db:setup-roles
npm run db:seed
npm run dev:api        # API
npm run dev:app        # Expo app
npm run typecheck; npm run lint; npx prettier --check .
npm test               # API unit + frontend
npm run test:db        # database suite (Docker running)
npm run db:protocol-status -- --code <CODE> --version 1 --to IN_REVIEW --actor <LOGIN-ID>
```

## 23. Final acceptance checklist

| Criterion | Status |
|---|---|
| Existing architecture inspected | ✅ |
| Steps 1-5 remain functional | ✅ (regression suites pass) |
| Screening sessions created securely | ✅ |
| Child authorization enforced on the backend | ✅ |
| Geographic restrictions work | ✅ |
| Consent verified before screening | ✅ (start, every write, DB trigger) |
| All Four-D categories have a technical workflow | ✅ |
| Screening templates versioned | ✅ |
| Unapproved templates not operational | ✅ (production: ACTIVE only; demo never approvable) |
| Age calculation reliable | ✅ (calendar days, India date, tested boundaries) |
| Responses validated | ✅ |
| Measurements stored accurately | ✅ (exact decimal strings, no silent rounding) |
| Missing responses not treated as negative | ✅ |
| Drafts saved and resumed | ✅ (server drafts; online only) |
| Completion transactional and idempotent | ✅ |
| Completed history preserved | ✅ (final, never deleted) |
| Audit logging works | ✅ |
| Sensitive information protected | ⚠️ Mostly: free text encrypted at rest (6F); structured answers rely on disk/database encryption (W8, infrastructure) |
| Frontend connected to actual backend APIs | ✅ App modules run end to end against the real API (6F live test, 8/8); ⚠️ not yet on a phone |
| Loading, error, empty, offline states | ✅ (offline = paused with banner; online-only by design) |
| Critical security tests pass | ✅ |
| High-priority regression tests pass | ✅ |
| No unresolved Critical bugs | ✅ |
| High bugs fixed or documented | ✅ (none open) |
| Documentation complete | ✅ |
| Clinical limitations and approvals documented | ✅ |

## 24. Stage 6F - hardening after the Step 6 review (2026-11-23)

| Item | What was done | Evidence |
|---|---|---|
| Clinical content intake | Template (`clinical-content-intake/`: metadata JSON + questions CSV + README) and `npm run db:protocol-import` (`--check` validates and lists every problem with its CSV line; `--actor` loads a new, audited DRAFT; never overwrites a version; refuses unfilled template text) | `tests/protocolImport.test.ts` (8), DB import test; the real command refuses the shipped template |
| End to end against the real API | `npm run db:dev-live-worker` (dev only, synthetic ASHA worker, password from the environment, audited) and the opt-in `tests/live/liveScreening.test.ts`: sign in → register → consent → eligibility → start (idempotent) → answer with a note → finish → measurement and correction → stale version refused → complete twice → history and counts | **8/8 passed** against the running API and the dev database on 2026-11-23 |
| Free-text encryption | Text answers, answer notes, not-assessed reasons, area notes, measurement notes and correction reasons, cancel reasons: AES-256-GCM (existing PII key), stored as `enc1:…`, bound to session and field; no key → 503 | 4 unit + 4 DB tests (stored rows hold only ciphertext; a moved value is refused; no key → 503); mutation (store plaintext) caught by all 4; the dev DB row from the live run is `enc1:` |
| Measurement date | "When was it measured?" for values from a card or a guardian; real date, not future (India date), not before birth; stored as the start of that day (no invented time) | `tests/screening/measurementDate.test.ts` (9) + a screen test |
| Amendments | **Not started**: waiting for the programme's answers (who may amend, time limit, approval) | - |

Bugs found and fixed in 6F: S6-006 (importer file paths), S6-007 (duplicate codes not reported
alongside other errors). No database migration was needed (no free text existed in the dev
database: verified 0 rows before the change).

**Stop condition:** Step 6 (including 6F) is finished. Step 7, AI integration and referrals have
not been started. Waiting for explicit approval.
