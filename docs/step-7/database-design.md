# Step 7 - Database design

> Migration `20261124100000_step7_results_referrals` (stage 7B, approved proposal:
> [schema-change-proposal.md](schema-change-proposal.md); deviations listed in
> [implementation-summary.md](implementation-summary.md)). Applied to the dev and test databases on
> 2026-11-24. The reshaped tables were empty; the migration refuses to run otherwise.

## Tables

| Table | Purpose | Key rules (database-enforced) |
|---|---|---|
| `ClinicalRuleSet` | Versioned rule set per category, protocol code and age band | Lifecycle DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> RETIRED; content frozen once out of DRAFT or used; approval record + content hash from APPROVED; demonstration sets never approvable; no overlapping ACTIVE sets; no delete |
| `ClinicalRuleSetEvent` | Rule-set history | Append-only |
| `ScreeningResultRun` | Session-level result of one screening version | Unique (session, version); COMPLETED session and existing version checked at commit; needs its category results; only a one-time supersede; no delete |
| `ScreeningResult` | Result of one Four-D category in a run | Insert-only; no rule set <=> NOT_ASSESSED / NOT_INTERPRETED; concern outcomes and referral recommendation need a rule set; rule set must be ACTIVE (or DRAFT) and match category, protocol version and age |
| `ClinicalReview` | One review task per run | Starts PENDING_REVIEW; state machine; decision matches state; notes required except ACCEPT; claim fields consistent; version +1 per change; no delete |
| `ClinicalReviewEvent` | Review history | Append-only |
| `Facility` | Referral destination | Unique official code; unique (area, type, lower(name)); services / accepts referrals only when VERIFIED (who, when, reference); inactive cannot accept; version +1; no delete |
| `FacilityHistory` | Facility changes (old/new) | Append-only |
| `Referral` | A referral | State machine (architecture.md section 6) with corrections of the latest event only; every status backed by a status event in the same transaction (checked at commit); one active referral per child + screening + category; approval and issue records complete; issued referrals keep facility, approval and consent record; version +1; no delete |
| `ReferralStatusEvent` | Referral history | Append-only; reason required for REJECTED / CANCELLED / CLOSED / corrections; first-hand sources always VERIFIED |
| `FollowUp` | Follow-up task | One open task per child + referral + reason; assignee rules; completion fields; state machine; same-child links; version +1; no delete |
| `FollowUpEvent` | Follow-up history | Append-only; reason required for RESCHEDULED / MISSED / CANCELLED / REASSIGNED |
| `Notification` | In-app notification | Unique dedupe key; only a one-time read mark may change |

Reused unchanged: `AuditLog` (append-only), `Consent` (REFERRAL_DATA_SHARING), `Area` /
`AreaClosure` / `WorkerAreaAssignment` (scope), `SyncOperation` (retry safety),
`ScreeningAmendmentReferralImpact` (reassessment flags, now handled by the referral module).

## Runtime account grants

`infrastructure/db/setup-app-role.sql`: DELETE and TRUNCATE revoked on every Step 7 history table
listed above; TRUNCATE revoked on `Notification`. Verified on dev (`has_table_privilege` for
`Referral` DELETE = false).

## Indexes for the main queries

Review queue `(status, createdAt)`, `(areaId, status)`; result runs `(sessionId, screeningVersion)`;
referrals `(areaId, status)`, `(facilityId, status)`, `(status, updatedAt)`, `(childId)`; status
events `(referralId, changedAt)`; follow-ups `(assignedToId, status, dueDate)`, `(status, dueDate)`,
`(referralId)`; notifications `(userId, readAt, createdAt)`; facilities `(areaId, type, isActive)`,
`(verificationStatus, acceptsReferrals, isActive)`; rule sets `(category, status, ageMinDays, ageMaxDays)`.
All lists are paginated (page size <= 50) with fixed sort orders. Index effectiveness under
production-like volumes has **not** been measured (no load test).

## Concurrency

Row locks (`SELECT ... FOR UPDATE`) in every guarded change, plus `version` columns whose triggers
raise a serialization failure (answered as 409) when a stale version is written. Duplicate creation
is prevented by unique indexes (also under concurrent requests) and `clientOperationId` replay.
