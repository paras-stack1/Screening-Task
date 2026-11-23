# Step 7 - Initial repository audit

> Phase 1 of Step 7 (screening results, clinical review, referrals, follow-up).
> Date: 2026-11-23. Read-only audit: no code, schema or database was changed.
> Companion documents: [architecture.md](architecture.md) (Phase 2 design and decisions) and
> [schema-change-proposal.md](schema-change-proposal.md) (Phases 3-4, waiting for approval).

## 0. Repository state at the start of Step 7

| Item | State |
|---|---|
| Branch | `feat/step-6g2-amendment-screens`, stacked on `feat/admin-portal` -> `feat/step-6-screening` |
| Uncommitted work | **Stage 6G-2** (worker-app amendment screens and review queue), still waiting for review |
| Last commits | Admin portal PA-PE (`790aac7` ... `9a29f6e`), 6G-1 `9324319` |
| Migrations applied | `20261121052025_init`, `..._step5_guardian_links_consent_integrity`, `..._step6_screening_foundation`, `..._step6g_screening_amendments` |
| Docker database | Running (`balswasthya-postgres`, healthy) |

Step 7 tables already exist (created by the initial migration) but are **empty in both databases
and unused by any code**:

| Table | dev rows | test rows | Code that uses it |
|---|---|---|---|
| `ScreeningResult` | 0 | 0 | only the generic scope check in `accessScope.ts` |
| `Facility` | 0 | 0 | none |
| `Referral` | 0 | 0 | scope check; Step 6G amendment flags (`amendments.service.ts`) |
| `ReferralStatusEvent` | 0 | 0 | none |
| `FollowUp` | 0 | 0 | scope check |
| `Notification` | 0 | 0 | none |
| `ScreeningSession` (COMPLETED) | 2 | 0 | Step 6 |

Because these tables are empty, their columns and enums can be reshaped now without migrating any
data. This is the main reason the schema proposal can change them rather than add parallel tables.

## 1. Existing modules that can be reused

| Need in Step 7 | Existing piece | Location |
|---|---|---|
| Authentication, sessions, refresh | Step 3 JWT + refresh rotation | `middleware/authenticate.ts`, `modules/auth/*` |
| Permission check | `authorize(permission)` | `middleware/authorize.ts`, `access-control/permissions.ts` |
| Area scope (child-linked data) | `childScopeWhere`, `scopedWhere.referral/followUp/screeningResult`, `assertInScopeOrDeny`, `findChildOrDeny`, `denyAsNotFound` (404 + DENIED audit) | `access-control/accessScope.ts` |
| Consent at point of use | `assertConsentPermits(..., 'REFERRAL_SHARING', ...)` - the activity `REFERRAL_SHARING -> [REFERRAL_DATA_SHARING]` **already exists** | `consent/consentPolicy.ts` |
| Audit | `recordAudit(db, entry)` on the append-only `AuditLog` | `audit/audit.service.ts` |
| Idempotent creates | `runIdempotent` over `SyncOperation` (user + clientOperationId, request fingerprint) | `utils/idempotency.ts` |
| Optimistic locking pattern | `version` column + trigger "must increase by exactly 1" | Step 6 `ScreeningSession` |
| Free-text encryption | `sensitiveText.ts` (`enc1:` AES-GCM, bound to the record) | `modules/screening/sensitiveText.ts` |
| Versioned clinical content lifecycle | `ProtocolStatus` DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> RETIRED, content hash, `isDemonstration` never approvable, approval reference, CLI `db:protocol-status`, `db:protocol-import` | `screening/protocolLifecycle.ts`, `protocolImport.ts`, step6 migration triggers |
| Current version of an amended screening | amendment overlay | `screening/amendmentOverlay.ts`, `sessionDetail.ts` |
| Referral reassessment flags after an amendment | `ScreeningAmendmentReferralImpact` (decision G9, "shown in Step 7") | step6g migration |
| Error shape | `AppError` -> `{ error: { code, message, details? } }`; 400/401/403/404/409/422/429; DB 23514/40001 mapped (S6-002) | `utils/AppError.ts`, `middleware/errorHandler.ts` |
| Rate limiting | `createDataRateLimiters` (per process) | `middleware/rateLimit.ts` |
| Validation | Zod via `validate()` middleware, `.strict()` bodies | `middleware/validate.ts` |
| Shared request/response types | `@balswasthya/shared-contracts` | `packages/shared-contracts/src` |
| App API client, token refresh, TanStack Query, query keys, localization hi/en, design system | Step 4 | `apps/worker-app/src/services`, `src/localization`, `src/components` |
| Medical officer review queue screen | 6G-2 (uncommitted) | `apps/worker-app/app/(app)/screening/review-queue.tsx` |
| Admin web portal (React + Vite), admin-only gate, area tree | PA-PE | `apps/admin-portal` |
| Route inventory security test | manual list (bug S6-004) | `services/api/tests/apiSecurity.test.ts` |

## 2. Existing database entities (Step 7 relevant)

| Entity | Current shape | Fit for Step 7 |
|---|---|---|
| `ScreeningResult` | per **category**: outcome (`REFERRAL_RECOMMENDED`, `FOLLOW_UP_RECOMMENDED`, `NO_CONCERN_IN_COMPLETED_ITEMS`, `INSUFFICIENT_DATA`), source, `ruleSetVersion` text, `reasons` JSON, `limitations`, inline review fields (`reviewStatus`, `reviewedById`, `reviewNotes` plain text) | Partial. No session-level result, no screening version, no link to a rule-set record, no protocol version, review is a single overwritable field (no history), notes unencrypted, no immutability |
| `AiAnalysis` | exists, unused | Not used in Step 7 (stop condition: no AI) |
| `Facility` | name, type, area, address, phone, isActive | Partial. No official code, no verification, no history, no uniqueness |
| `Referral` | child, session?, facility (required), area snapshot, category?, urgency, status, reasonCode, notes (plain), appointmentAt, closedAt, clientOperationId | Partial. Status set does not match the required lifecycle; no approval, no origin, no consent reference, no result link, no version, facility required too early, no duplicate guard |
| `ReferralStatusEvent` | from/to, actor, note | Partial. No source, verification, reason rule, role snapshot; not protected against edits |
| `FollowUp` | child, referral?, due date, status (PENDING/DONE/MISSED/CANCELLED), assignee, outcome note | Partial. No reason, no history, no reschedule, no version, no duplicate guard |
| `Notification` | user, type (3 values), payload JSON (ids only), readAt | Partial. No de-duplication key, type list too small |
| `AuditLog` | insert-only, no FKs | Fits as is |
| `Consent` / `ConsentTemplate` | purpose `REFERRAL_DATA_SHARING` exists; all templates in dev are DRAFT placeholders | Fits; production use needs approved wording |
| `WorkerAreaAssignment`, `AreaClosure` | scope + effective dates | Fits as is |
| `ScreeningAmendmentReferralImpact` | uses the `ReferralStatus` enum | Must be kept consistent if the enum changes |

No `ClinicalRuleSet`, `ClinicalReview`, review history, facility history or follow-up history
entity exists.

## 3. Existing API conventions

- Base path `/api/v1`; routers registered in `src/routes/index.ts`; module layout
  `routes / service / schema` (thin handlers may be inline).
- Every protected route: `authenticate` -> `authorize(permission)` -> `validate(zod)` -> service.
- Lists: `?page=&pageSize=` -> `{ items, page, pageSize, total }`; fixed, whitelisted sort orders
  (no client-supplied sort field).
- Out-of-scope and non-existent records both return **404** and write a DENIED audit row (R11).
- Retried creates: `clientOperationId` (UUID) -> replay returns the first result; reuse with a
  different body -> 409 `IDEMPOTENCY_KEY_REUSED`.
- Stale writes: `expectedVersion` / `expectedSequence` -> 409.
- Writes that change state run in one transaction together with their audit rows; denial audits
  use the root client so a rollback does not erase them.
- The app has no `PUT`; state changes use `POST` action routes (e.g. `/screenings/:id/complete`).

## 4. Existing screening completion logic (Step 6)

- `POST /screenings/:id/complete` (`screenings.service.ts` `complete`): idempotent; requires at
  least one COMPLETED category; started-but-unfinished categories stay `IN_PROGRESS`
  (incomplete) for ever; never-started categories have **no row** (not assessed).
- Completed and cancelled sessions are immutable (triggers). Changes after completion are
  **amendments** (6G): a new screening version, append-only, with old/new values.
- Unanswered question = no row; `UNKNOWN`, `NOT_ASSESSED`, `UNABLE_TO_ASSESS` are explicit states,
  never read as "No" (decision G). This is the basis for "missing data is never reassuring".
- Each category stores the exact protocol version and its status at start
  (`protocolStatusAtStart`), so a result can prove whether approved content was used.
- The completion summary shows observations only, "no recommendation" (Step 6 design).

## 5. Existing consent verification

- `evaluateConsents` returns the current decision per purpose (latest record wins, withdrawal
  respected, draft notices accepted only outside production).
- `assertConsentPermits(db, ctx, childId, activity, permission, policy)` checks child access and
  every purpose of the activity; failure -> 403 `CONSENT_REQUIRED` with the blocking purposes,
  audited as `consent.check_denied`; returns the consent ids used.
- The `REFERRAL_SHARING` activity is defined but **not called anywhere yet**.
- Screening sessions store the SCREENING consent they relied on; a trigger re-checks it.

## 6. Existing authorization rules

- Role -> permission matrix (`roles.ts`, illustrative, decision D2):
  - ASHA, ANGANWADI_WORKER: `child.read/create/update`, `consent.record`, `screening.conduct`,
    `referral.create`
  - MHT_MEDICAL_OFFICER: worker set + `screening.review`, `referral.update`
  - SUPERVISOR: `child.read`, `referral.update`, `report.aggregate`, `assignment.manage`
  - DISTRICT_ADMIN: `report.aggregate`, `assignment.manage`, `user.manage`, `facility.manage`
  - STATE_ADMIN: as district + `area.manage`, `audit.read`
- District and state administrators **never read individual child records** (D3).
- Access follows the child's **current** area (D4); area snapshots on sessions/referrals are for
  reporting only.
- Role permission and area scope are separate: a permission counts only through an effective
  assignment whose area covers the child (rules R1-R11, `docs/authorization.md`).
- There is no facility-level scope and no facility staff role.

## 7. Missing referral functionality

Everything above the table level: referral API, lifecycle/state machine, approval, issue,
cancellation/rejection reasons, consent check at sharing time, duplicate guard, facility
selection rules, acknowledgement/appointment/visit tracking, manual update provenance,
correction workflow, history API, reassessment of the 6G amendment flags, worker-app screens.
Facility directory API and admin screens. Follow-up API and screens. Notifications API, reminder
job and screen (the worker app's Notifications tab is a placeholder - Step 4 decision I).

## 8. Missing result functionality

- No rule-set entity, rule language, evaluator, approval lifecycle or rule change history.
- No result generation (on completion or on demand), no session-level result, no link from a
  result to the screening version (amendments), protocol versions and rule version used.
- No clinical review entity with states, decisions and history.
- No result screens; the Step 6 summary intentionally shows "no recommendation".

## 9. Potential security weaknesses (in the existing Step 7 tables)

| # | Weakness | Severity if left | Planned fix |
|---|---|---|---|
| W1 | `ScreeningResult.reviewNotes`, `Referral.notes`, `ReferralStatusEvent.note`, `FollowUp.outcomeNote` are plain text | High (clinical free text readable in DB dumps) | Encrypt with the existing `enc1:` scheme |
| W2 | No triggers protect referral history, results or follow-up history from UPDATE/DELETE | High (history could be rewritten) | Append-only triggers + revoke DELETE/TRUNCATE (as Step 6) |
| W3 | Referral status can be set to any value (no state machine anywhere) | High | State machine in the service **and** a database trigger |
| W4 | No duplicate guard for referrals except `clientOperationId` | High (duplicate referrals) | Partial unique index on active referrals |
| W5 | `ScreeningResult` review is one overwritable field set | High (decision history lost) | Separate review + append-only review events |
| W6 | `Notification` has no de-duplication | Medium | Unique `dedupeKey` |
| W7 | `Facility` has no unique identifier | Medium (duplicate facilities) | Unique official code + name/area/type guard |
| W8 | No facility-level authorisation dimension | Medium (needed only when facility staff get accounts) | Deferred with facility staff accounts (decision O) |
| W9 | Rate limits are per process (known, Step 3) | Medium (multi-instance deployments) | Unchanged; documented |
| W10 | Route inventory in `apiSecurity.test.ts` is manual (S6-004) | Medium | Add every Step 7 route; keep the reminder in `routes/index.ts` |

## 10. Required schema changes

Summarised here; full detail and SQL rules in [schema-change-proposal.md](schema-change-proposal.md).

1. New: `ClinicalRuleSet`, `ClinicalRuleSetEvent`, `ScreeningResultRun`, `ClinicalReview`,
   `ClinicalReviewEvent`, `FacilityHistory`, `FollowUpEvent`.
2. Reshape (empty tables): `ScreeningResult`, `Referral`, `ReferralStatusEvent`, `Facility`,
   `FollowUp`, `Notification`.
3. Enum changes: `ResultOutcome`, `ReferralStatus`, `FollowUpStatus`, `NotificationType`,
   `FacilityType` (+1); new `ClinicalReviewStatus`, `ClinicalReviewDecision`, `ReferralOrigin`,
   `ReferralUpdateSource`, `VerificationStatus`, `FollowUpEventType`; drop the unused `ReviewStatus`.
4. New permissions: `referral.approve`, `follow_up.update` (seed/config, not schema).
5. Triggers: immutability, append-only history, state machines, version increments, active
   uniqueness; DB grants updated in `infrastructure/db/setup-app-role.sql`.

No migration will be created until the proposal is approved.

## 11. Integration dependencies

| Dependency | Owner | Blocks |
|---|---|---|
| Approved clinical rule sets (what makes a result "further evaluation" or "urgent"), with references | Clinical team | Operational interpretations (framework works without them; results show "not interpreted") |
| Approved Four-D protocols (Step 6, still demonstration only) | Clinical team | Any operational screening, and therefore any operational result |
| Review policy: which results need review, review time limits | Programme | Review task creation rule, "review overdue" reminders |
| Meaning of ROUTINE / PRIORITY / URGENT, escalation times | Clinical team | Priority guidance text; no timers are built without it |
| Referral facility list with official codes and verified services | District/state programme | Facility directory content (no facility will be invented) |
| Approved `REFERRAL_DATA_SHARING` consent wording (hi/en) | Legal/programme | Issuing referrals in production (dev uses DRAFT placeholders) |
| Emergency guidance wording (hi/en) | Programme | Emergency banner text (draft provided, marked for review) |
| Facility staff accounts and their scope | Programme | Direct facility updates (manual workflow used meanwhile) |
| Small-cell suppression threshold for reports | Privacy policy | Aggregate reports (assumed threshold, marked) |
| Hindi translation review | Translator | All new screen text |
| AI service | Other team | **Not used in Step 7** |
| Push/SMS/email provider | Programme | **Not used**: in-app notifications only |

## 12. Known bugs from earlier steps

| ID | Severity | Status | Relevance to Step 7 |
|---|---|---|---|
| S6-005 | Low | Open, not reproducible (one DB test timeout once in five runs). Memory/notes: slow Docker disk I/O on this Windows machine causes occasional timeouts that pass on rerun | Heavy DB suites run one at a time |
| (none) | - | No Critical, High or Medium bug is open in Steps 3-6 or the admin portal | - |

Known limitations carried forward (not bugs): online-only screening; demonstration content only;
rate limits per process; supervisors can read screening answers (Step 6 decision M); 6G-2 not yet
reviewed or committed.

## 13. Baseline tests

The last recorded full results (6G-1, 2026-11-23): API unit 377, DB 321, frontend 2073 passed /
18 skipped, live 8/8. They will be re-run at the start of stage 7B, on the committed 6G-2 code,
before any Step 7 change. They were **not** re-run for this documentation-only stage.
