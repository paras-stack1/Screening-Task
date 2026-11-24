# Step 7 - Implementation summary and final report

> Updated after each stage. Decisions A-X approved on 2026-11-23 ("approve all recommendations").
> Branch `feat/step-7-referrals` (from 6G-2, commit `b5e4fce`).

## Stages

| Stage | Content | Status |
|---|---|---|
| Phases 1-4 | Audit, architecture, schema proposal (`47b8b4c`) | Done |
| 7B | Migration (all Step 7 tables and rules), permissions, rule DSL + evaluator, rule-set CLIs, demonstration rule sets, result generation, results and rule-set read API, tests | Done (`01af3c6`) |
| 7C | Clinical review actions, referral create/approve/reject/issue/cancel/history, facility read API | Done (`f9bcc84`) |
| 7D | Referral tracking, follow-ups, notifications + reminder job, dashboard/report APIs | Done (`986e676`) |
| 7E | Worker app: results, review, notifications | Done (`cf62ab9`) |
| 7F | Worker app: referrals, follow-ups, dashboards | Done (`d8fba0d`) |
| 7G | Admin portal facilities and reports; security and regression testing; all docs; final report | Done (`3183ca1`) - approved 2026-11-24 |

## Stage 7B

### Files created

- `services/api/prisma/migrations/20261124100000_step7_results_referrals/migration.sql`
- `packages/shared-contracts/src/clinicalRules.ts`, `results.ts`
- `services/api/src/modules/clinical-rules/`: `evaluator.ts`, `ruleSetContent.ts`,
  `ruleSetLifecycle.ts`, `demoRuleSets.ts`, `resultGeneration.ts`, `results.service.ts`,
  `results.routes.ts`
- `services/api/prisma/rule-set-import.ts`, `rule-set-status.ts`
- Tests: `services/api/tests/clinicalRules.test.ts`, `tests/db/screeningResults.test.ts`
- Docs: `clinical-rule-governance.md`, `result-generation-architecture.md`, this file

### Files modified

`schema.prisma`; `permissions.ts`, `roles.ts`, `accessScope.ts` (result-run scope);
`screenings.service.ts` (generation on completion), `amendments.service.ts` (generation per
amendment), `screenings.routes.ts`, `routes/index.ts`; `prisma/seed.ts`, `package.json`
(two scripts), `infrastructure/db/setup-app-role.sql` (no DELETE/TRUNCATE on Step 7 history
tables); `shared-contracts/src/index.ts`; `docs/authorization.md`; test fixtures
(`authzFixture.ts`, `authorization.test.ts`, `screeningAmendments.test.ts`, `apiSecurity.test.ts`).

### Database

Migration applied to the **test** and **dev** databases on 2026-11-24; `db:setup-roles` and the seed
re-run on dev (4 demonstration rule sets, 16 permissions). The reshaped tables were empty (the
migration's guard checks this). No dev data was changed or deleted. The 2 screenings completed
in dev before Step 7 have no result yet; `POST /screenings/:id/generate-result` creates it.

### Deviations from the schema proposal (all small, all documented in the schema)

1. `ScreeningResultRun.usesUnapprovedContent` instead of `isDemonstration`: it also covers
   real-but-unapproved (DRAFT) content.
2. `ClinicalRuleSet.createdById` and `ClinicalRuleSetEvent.actorId` may be null **only** for
   demonstration sets created by the development seed (CHECK constraints).
   `ClinicalReviewEvent.actorId` is null for the system-created first event.
3. `ScreeningResult` keeps its `sessionId` column (a trigger keeps it equal to the run's).
4. The rule-set history stores the content hash at each event instead of a free-text note.
5. The duplicate-referral guard is two partial unique indexes (with / without category):
   PostgreSQL does not allow the planned enum-to-text cast in an index.
6. "A status change needs its status event in the same transaction" is detected by the event row's
   transaction id, not by comparing clocks.
7. The migration was edited once after being applied to the test database (point 2); the test
   database was brought in line with the same SQL and its migration checksum updated. Dev received
   the final file.

### Test results (actually run, 2026-11-24)

| Suite | Before 7B | After 7B | Result |
|---|---|---|---|
| API unit | 398 | 442 (+38 rule engine, +6 route inventory) | All pass |
| Database / API | 348 | 380 (+30 results/rules/DB rules, +2 scope) | All pass |
| Worker app | 2297 passed / 20 skipped | 2297 passed / 20 skipped | Unchanged (no app changes in 7B) |
| Admin portal | - | 308 passed / 5 skipped | All pass |
| Typecheck, lint, Prettier (whole repository) | clean | clean | - |
| Mutation checks (evaluator) | - | 3 of 3 caught | missing answer read as "no"; UNKNOWN hidden by NOT_MET; unfinished category reported as no concern |

### Bugs

No defect was found in previously working code. During development the first migration run
failed on the test database (an enum cast in an index expression); it rolled back completely and
was fixed before anything else ran (not shipped). Open from earlier steps: S6-005 (Low).

### Not in 7B (by plan)

Review actions, referral and facility services/APIs (7C); tracking, follow-ups, notifications,
dashboards (7D); all screens (7E-7G). The database rules for those tables are already in place and
tested.

## Stage 7C

### Built

- **Clinical review** (`modules/clinical-review/review.service.ts`): queue, detail with the full
  result and history, claim / release / decide. RECOMMEND_REFERRAL creates an APPROVED referral;
  REQUEST_ADDITIONAL_SCREENING creates a follow-up task. See
  [clinical-review-workflow.md](clinical-review-workflow.md).
- **Referrals** (`modules/referrals/referrals.service.ts`): create (retry-safe, duplicate guard),
  list (scope, filters, "awaiting my approval"), detail with history, reassessment flags and the
  actions the caller may take; approve, reject, change facility, issue (consent verified and
  recorded), cancel, reassess after amendment. See [referral-workflow.md](referral-workflow.md).
- **Facilities** (`modules/facilities/facilities.service.ts`): selection list for a child with
  district placement and "selectable"; directory for facility managers; detail. See
  [facility-management.md](facility-management.md).
- Shared helpers (`referralCommon.ts`): record-bound encryption of all Step 7 free text, actor role
  for history, the district rule, due dates.
- Contracts `packages/shared-contracts/src/referrals.ts`; scope rule `clinicalReview` in
  `accessScope.ts`; 17 routes added to the authentication inventory.

No schema change was needed (all tables and database rules came with 7B).

### Test results (actually run, 2026-11-24)

| Suite | After 7B | After 7C | Result |
|---|---|---|---|
| API unit | 442 | 459 (+17 route inventory) | All pass |
| Database / API | 380 | 402 (+20 review/referral/facility, +2 scope) | All pass |
| Worker app, admin portal | 2297 / 20 skipped; 308 / 5 skipped | not re-run: 7C adds contract exports only, no app code | - |
| Typecheck, lint, Prettier (whole repository) | clean | clean | - |
| Mutation checks | - | 2 of 2 caught | consent check removed at issue; any reviewer allowed to decide |

During one mutation run two unrelated tests timed out at 20 s (known slow Docker disk on this
machine; they pass on the restored code and in the full run).

### Assumptions to confirm (not invented clinical content)

1. District rule for facilities (in district or above; out-of-district only by a medical officer
   with a reason).
2. A medical officer may review a screening they conducted (shown, not blocked).
3. Workflow reason codes for referrals and follow-ups (`REFERRAL_REASON_CODES`,
   `FOLLOW_UP_REASON_CODES`) - labels, not clinical classifications.
4. Follow-up due dates from today up to one year ahead.

### Bugs

None found in existing code. Open from earlier steps: S6-005 (Low).

## Stage 7D

### Built

- **Referral tracking** after issue with source-derived verification, closure rules, and
  corrections of the latest update (`referrals.service.ts`: track, close, correct). See
  [referral-workflow.md](referral-workflow.md) section 2a.
- **Follow-ups** (`modules/follow-ups/followUps.service.ts`): create (retry-safe, one open task per
  child + referral + reason), assign/reassign with eligibility check, start, complete, reschedule,
  miss, cancel; history; computed overdue. See [follow-up-management.md](follow-up-management.md).
- **Notifications** (`modules/notifications`): ids-only in-app notifications with dedupe keys, sent
  after commit (failures logged, never undo the change); a user lists and marks only their own;
  reminder job `npm run jobs:reminders` (`prisma/jobs-reminders.ts`).
- **Dashboards and reports** (`modules/reports/reports.service.ts`): referral and result dashboards
  over the caller's scope; aggregate report by area and date range with small-cell suppression,
  per-category and per-sub-area counts. Metric definitions in
  [api-documentation.md](api-documentation.md).
- 18 routes added to the authentication inventory. No schema change.

### Test results (actually run, 2026-11-24)

| Suite | After 7C | After 7D | Result |
|---|---|---|---|
| API unit | 459 | 476 (+17 route inventory) | All pass |
| Database / API | 402 | 415 (+13 tracking, follow-ups, notifications, reminders, dashboards, reports) | All pass |
| Typecheck, lint, Prettier | clean | clean | - |
| Mutation checks | - | 2 of 2 caught | closing with open follow-ups; family reports recorded as verified |
| Reminder command on dev | - | ran, sent 0 (nothing due) | - |

Worker app and admin portal suites not re-run (no app code changed in 7D).

### Assumptions to confirm

1. Small-cell suppression threshold 5 for reports.
2. "Due soon" = due today or tomorrow; reminder run every ~30 minutes.
3. Facility phone calls and documents count as verified; family reports never do.
4. Review-overdue reminders stay off until a time limit is agreed (`REVIEW_OVERDUE_HOURS`).

### Known limitations

A correction does not revert an appointment time. Notifications are in-app only (no push).
Reports list sub-areas one level down only.

## Stage 7E

### Built (worker app)

Result screen per screening (four layers kept apart, version history), results list with real
counts and an outcome filter, clinical review queue and review screen (claim, release, decision
form with notes, referral area and priority, repeat-screening date), and the Notifications tab
(generic text, unread count, mark read). Details: [docs/frontend/results.md](../frontend/results.md).
English and Hindi text added (Hindi drafted, needs translator review). Contract change:
`clinicalReviewSummary.overallOutcome` is now typed as a result outcome (was a plain string).

### Test results (actually run, 2026-11-24)

| Suite | Before 7E | After 7E | Result |
|---|---|---|---|
| Worker app (Jest) | 2297 passed / 20 skipped | 2684 passed / 20 skipped | All pass (+11 screen tests, + per-key translation checks) |
| App typecheck, expo lint, Prettier (repository) | clean | clean | - |
| API typecheck after the contract change | clean | clean | - |

In one full parallel run two result-screen tests timed out (known Jest load flakiness on this
machine); they pass alone, with the other screen tests, and in the next full run.

### Limitations

Referral and follow-up notifications open their screens since 7F. The
repeat-screening date is typed as YYYY-MM-DD (no date picker).

## Stage 7F

### Built (worker app)

Referral dashboard and list with real counts, new referral (from a screening result or for another
concern), referral detail with timeline and every action the API allows (approve, reject, facility,
issue with consent message, tracking updates with source, close, undo last update, cancel,
reassessment), facility choice with verified details, follow-up list and detail (start, complete,
reschedule, miss, cancel). Home dashboard: real pending follow-up and referral counts and working
Referrals / Follow-ups cards (replacing Step 4 placeholders). Referral and follow-up notifications
open their screens. Details: [docs/frontend/referrals.md](../frontend/referrals.md). en/hi text added
(Hindi drafted, needs translator review). No API or schema change.

### Test results (actually run, 2026-11-24)

| Suite | After 7E | After 7F | Result |
|---|---|---|---|
| Worker app (Jest) | 2684 passed / 20 skipped | 3182 passed / 20 skipped | All pass (+13 referral screen tests, + per-key translation checks) |
| App typecheck, expo lint | clean | clean | - |

Changed expectations: the Step 4 dashboard tests (placeholders replaced by real counts and a
role check) and the start-up network test (one more dashboard call).

### Limitations

Dates and times are typed (no date picker). No offline queue: referral actions need a connection.
The district / state facility administration and aggregate reports come with the admin portal (7G).

## Stage 7G

Facility administration API (`facilityAdmin.service.ts`: create, edit with reason, verify, remove
verification, deactivate, reactivate, detail with history) and admin portal pages (Facilities, Add
facility, facility page, Reports with suppressed counts; menu entries by permission; PATCH added to
the portal API client). Security review, database design, bug and test reports written. Tests: 3 DB
tests, 6 route-inventory entries, 4 portal tests. No schema change.

---

# Step 7 - Final report

Written for: the project owner and the engineering / clinical reviewers of BalSwasthya AI.

## 1. Initial audit

[initial-audit.md](initial-audit.md): the Step 7 tables existed but were empty and unused; consent,
scope, audit, idempotency and the Step 6 content lifecycle were reusable; no rule engine, review,
referral, facility, follow-up, notification or report logic existed. Decisions A-X
([architecture.md](architecture.md)) and the schema proposal were approved on 2026-11-23.

## 2. Existing modules reused

Step 3 authentication and RBAC; area scope (`accessScope.ts`, extended with result runs and reviews);
`assertConsentPermits` (REFERRAL_SHARING); `recordAudit`; `runIdempotent`; `enc1:` text encryption;
the Step 6 protocol lifecycle pattern and amendment overlay; Step 6G reassessment flags; the worker
app's API client, TanStack Query, localization and components; the admin portal shell, area picker
and session.

## 3-4. Files created / modified

Listed per stage above (7B-7G). In short: one migration; `packages/shared-contracts/src/{clinicalRules,results,referrals,followUps}.ts`;
API modules `clinical-rules`, `clinical-review`, `referrals`, `facilities`, `follow-ups`,
`notifications`, `reports`; CLIs `db:rule-set-import`, `db:rule-set-status`, `jobs:reminders`;
worker-app `features/results`, `features/referrals` and 9 screens; admin portal `features/facilities`
(4 pages); tests and fakes; 13 documents in `docs/step-7` plus `docs/frontend/{results,referrals}.md`.

## 5-6. Database

Proposed: [schema-change-proposal.md](schema-change-proposal.md). Executed (approved): migration
`20261124100000_step7_results_referrals` on the test and dev databases; `db:setup-roles` and seed
re-run on dev. Design and deviations: [database-design.md](database-design.md) and stage 7B above.

## 7-14. Functionality

| Area | Summary | Document |
|---|---|---|
| Screening results | Automatic per completion / amendment, four category results + session outcome, versioned, evidence references, never reassuring on missing data | result-generation-architecture.md |
| Rule engine | Versioned rule sets as data, DSL without negation, governed CLI lifecycle, demonstration sets only | clinical-rule-governance.md |
| Clinical review | Queue, claim, decisions, history, encrypted notes | clinical-review-workflow.md |
| Referrals | Create / approve / reject / facility / issue with consent / track / close / correct / cancel / reassess | referral-workflow.md |
| Facilities | Verified directory, district rule, administration with history | facility-management.md |
| Follow-ups | Tasks with assignment, history, reschedule, missed, overdue | follow-up-management.md |
| Notifications | In-app, ids only, dedupe, after commit, reminder job | api-documentation.md |
| Dashboards / reports | Scoped dashboards; suppressed aggregate reports | api-documentation.md |

## 15-16. Security and APIs

[security-review.md](security-review.md) and [api-documentation.md](api-documentation.md) (47 new
routes, all authenticated, permission-filtered and scope-checked).

## 17-21. Tests and bugs

[test-report.md](test-report.md) (final numbers: API unit 482/482; worker app 3182 passed / 20
skipped; admin portal 396 passed / 5 skipped; database 413/418 in the last full run with 5 timeouts,
each file passing alone). [bug-report.md](bug-report.md): S7-001 to S7-003 fixed (Low); S7-004
(test timeouts from slow disk sync) and S6-005 open (Low). No Critical or High bug.

## 22. Clinical approvals required

1. Approved rule sets (all thresholds with references) - none exist; production shows "not interpreted".
2. Approved, non-demonstration Four-D protocols (from Step 6).
3. The approver role for rules and protocols (assumed: `screening.review` holder).
4. Meaning of ROUTINE / PRIORITY / URGENT and any escalation times.
5. Which results need review, and a review time limit (`REVIEW_OVERDUE_HOURS` is off).
6. Approved REFERRAL_DATA_SHARING consent wording (hi/en) and legal guidance on what may be recorded
   after consent is withdrawn post-issue.
7. Emergency notice wording (hi/en).
8. Hindi review of all new text (worker app and portal).

Programme / privacy decisions: facility list with official codes and verified services, the district
rule for facility choice, who verifies facilities, self-review by medical officers, small-cell
threshold (5 assumed), facility staff accounts (not built).

## 23. Known limitations

No approved clinical content (nothing operational in production). In-app notifications only. No
facility staff accounts (manual updates with source). Online only (no offline queue). Dates typed
(no picker). A correction does not revert an appointment time. Rate limits per process. Reports one
level of sub-areas. Not done: device testing, load testing, external penetration test, live
end-to-end run of the Step 7 screens. `npm audit`: 32 tooling advisories (security-review F1).

## 24. Manual testing

1. `npm run db:up`; in `services/api`: `npx prisma migrate deploy`; `npm run db:setup-roles`;
   `npm run db:seed` (demonstration protocols and rule sets).
2. Create a worker (ASHA, village), a medical officer (MHT_MEDICAL_OFFICER, same village) and a
   district administrator through the admin portal.
3. Portal (district admin): Facilities -> add a facility in the district -> record verification with
   "accepts referrals".
4. Worker app (ASHA): register a child, record SCREENING and REFERRAL_DATA_SHARING consent, screen
   Diseases with question 1 = Yes, complete -> "View screening result" (demonstration warning,
   urgent check recommended, no diagnosis) -> "Create referral" -> choose priority and facility.
5. Worker app (medical officer): Screening -> Clinical reviews -> claim -> decide; Referrals ->
   "Waiting for my approval" -> approve; ASHA issues it (try once without referral consent first).
6. Medical officer: record "Facility acknowledged" (phone call) and "Visit recorded" (family report,
   shown as not verified); undo the last update; add a follow-up; ASHA completes it; close the referral.
7. Notifications tab on each phone; `npm run jobs:reminders`; portal Reports for the district.

## 25. Commands

```powershell
npm install; npm run db:up
cd services/api; npx prisma migrate deploy; cd ../..
npm run db:setup-roles; npm run db:seed
npm run dev:api; npm run dev:app            # API and worker app
npm run dev:admin                            # admin portal
npm run typecheck; npm run lint; npx prettier --check .
npm test; npm run test:db                    # run the DB suite alone (slow disk: see test-report)
npm run db:rule-set-import -- --file <set.json> --check
npm run db:rule-set-status -- --code <C> --version <N> --to IN_REVIEW --actor <LOGIN-ID>
npm run jobs:reminders
```

## 26. Acceptance checklist

| Criterion | Status |
|---|---|
| Steps 1-6 audited | Yes |
| Previous modules remain functional | Yes (regression suites; DB suite with the S7-004 timeout caveat) |
| Results generated from valid completed sessions | Yes |
| Unapproved rules cannot produce operational classifications | Yes (demonstration never approvable, never used in production; "not approved" shown) |
| Rule versions preserved | Yes |
| Four-D results displayed independently | Yes |
| Incomplete and uncertain results handled safely | Yes |
| Clinical review permissions enforced | Yes |
| Review history preserved | Yes |
| Referrals created securely | Yes |
| Approval follows the authorised workflow | Yes |
| Status transitions validated | Yes (service + database) |
| Duplicate referrals prevented | Yes |
| Facility information validated | Yes |
| Facility assignment authorised | Yes |
| Facility visit tracking works | Yes (manual, with source and verification) |
| Follow-ups created and assigned | Yes |
| Follow-up history preserved | Yes |
| Notifications without sensitive information | Yes (in-app only) |
| Dashboards use real data | Yes |
| Geographic restrictions enforced | Yes |
| Consent and data-sharing checks | Yes (at issue) |
| Audit logging | Yes |
| Critical security tests pass | Yes |
| High-priority regression tests pass | Yes, except intermittent DB test timeouts (S7-004, environment) |
| No unresolved Critical bugs | Yes |
| High bugs fixed or documented | Yes (none) |
| Documentation complete | Yes (13 documents) |
| Clinical limitations and approvals documented | Yes (section 22) |

**Stop condition:** Step 7 is complete. Step 8, AI models, image / voice / video analysis and parent
activity plans have **not** been started. Waiting for explicit approval.
