# Step 7 - Implementation summary (in progress)

> Updated after each stage. Decisions A-X approved on 2026-11-23 ("approve all recommendations").
> Branch `feat/step-7-referrals` (from 6G-2, commit `b5e4fce`).

## Stages

| Stage | Content | Status |
|---|---|---|
| Phases 1-4 | Audit, architecture, schema proposal (`47b8b4c`) | Done |
| **7B** | Migration (all Step 7 tables and rules), permissions, rule DSL + evaluator, rule-set CLIs, demonstration rule sets, result generation, results and rule-set read API, tests | **Done - awaiting review** |
| 7C | Clinical review actions, referral create/approve/reject/issue/cancel/history, facility read API | Not started |
| 7D | Referral tracking, follow-ups, notifications + reminder job, dashboard/report APIs | Not started |
| 7E | Worker app: results, review, notifications | Not started |
| 7F | Worker app: referrals, follow-ups, dashboards | Not started |
| 7G | Admin portal facilities and reports; security and regression testing; all docs; final report | Not started |

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
