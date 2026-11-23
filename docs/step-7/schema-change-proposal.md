# Step 7 - Schema change proposal

> Phases 3-4 of Step 7. Status: **PROPOSED - no migration has been created or run.**
> Depends on decisions A-X in [architecture.md](architecture.md). If a decision changes, this
> proposal changes with it.

## 1. Summary and safety

- One migration, proposed name `20261124xxxxxx_step7_results_referrals`.
- **No data is migrated or lost:** every table that is reshaped (`ScreeningResult`, `Facility`,
  `Referral`, `ReferralStatusEvent`, `FollowUp`, `Notification`,
  `ScreeningAmendmentReferralImpact`) has **0 rows** in dev and test (checked 2026-11-23). The
  migration starts with a guard that **aborts** if any of them has rows, so it can never silently
  drop data on another database.
- Enum value removals are done by creating a new type and switching the columns (safe only
  because the tables are empty - the guard enforces it).
- Prisma stays at 6.19; no new dependencies.
- After the migration: `npm run db:setup-roles` (grants) and the seed (new permissions).

## 2. Enums

| Enum | Change | Values |
|---|---|---|
| `ResultOutcome` | replace values (decision E) | `NO_CONCERN_IN_COMPLETED_ITEMS, FURTHER_EVALUATION_RECOMMENDED, URGENT_EVALUATION_RECOMMENDED, INCOMPLETE, NOT_ASSESSED, UNABLE_TO_DETERMINE, NOT_INTERPRETED` |
| `ReviewStatus` | **drop** (only used by the old inline review fields) | - |
| `ClinicalReviewStatus` | new | `PENDING_REVIEW, UNDER_REVIEW, ADDITIONAL_INFORMATION_REQUIRED, ESCALATED, REVIEWED, REJECTED` |
| `ClinicalReviewDecision` | new | `ACCEPT_RESULT, REQUEST_ADDITIONAL_SCREENING, RECOMMEND_REFERRAL, ESCALATE_FOR_SPECIALIST_REVIEW, REJECT_WITH_REASON` |
| `RuleSetEventType` | new | `CREATED, STATUS_CHANGED` |
| `ReferralStatus` | replace values (decision J) | `PENDING_APPROVAL, APPROVED, REJECTED, ISSUED, ACKNOWLEDGED, APPOINTMENT_SCHEDULED, VISITED, VISIT_NOT_COMPLETED, UNDER_TREATMENT, FOLLOW_UP_REQUIRED, CLOSED, CANCELLED` |
| `ReferralOrigin` | new | `CLINICAL_REVIEW, RULE_RECOMMENDATION, WORKER_CONCERN` |
| `ReferralUpdateSource` | new | `SYSTEM, APP_USER_DIRECT, FACILITY_PHONE_CALL, FACILITY_DOCUMENT_SEEN, GUARDIAN_REPORTED` |
| `VerificationStatus` | new | `UNVERIFIED, VERIFIED` |
| `FacilityType` | add value | `+ DESIGNATED_SPECIALIST_CENTRE` |
| `FollowUpStatus` | replace values (decision Q) | `PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, MISSED, CANCELLED` |
| `FollowUpEventType` | new | `CREATED, ASSIGNED, REASSIGNED, STARTED, RESCHEDULED, COMPLETED, MISSED, CANCELLED` |
| `NotificationType` | replace values (decision S) | `REVIEW_TASK_NEW, REVIEW_OVERDUE, ADDITIONAL_ASSESSMENT_REQUESTED, REFERRAL_APPROVED, REFERRAL_REJECTED, REFERRAL_ISSUED, REFERRAL_ACKNOWLEDGED, REFERRAL_APPOINTMENT_SCHEDULED, REFERRAL_STATUS_CHANGED, FOLLOW_UP_ASSIGNED, FOLLOW_UP_DUE_SOON, FOLLOW_UP_OVERDUE, SYSTEM` |

`ResultSource` (`RULE_ENGINE, WORKER_OBSERVATION, AI_SUPPORT, CLINICIAN`) is kept unchanged;
Step 7 writes only `RULE_ENGINE`.

## 3. New models

```prisma
/// A versioned clinical rule set for ONE Four-D category and age band (decision B).
/// The rules themselves are in `definition` (validated by the rule DSL); frozen once it leaves DRAFT.
model ClinicalRuleSet {
  id                String         @id @default(uuid()) @db.Uuid
  code              String
  version           Int
  category          FourDCategory
  /// Rules refer to question codes of this protocol code (any version listed in protocolVersions).
  protocolCode      String
  protocolVersions  Int[]
  nameEn            String
  nameHi            String
  ageMinDays        Int
  ageMaxDays        Int
  /// Required: guideline document, edition and section behind EVERY threshold in the set.
  sourceReference   String
  /// { dslVersion, rules: [{ ruleId, name, inputs, when, outcome, referralRecommended,
  ///   suggestedPriority?, clinicalReference }] }
  definition        Json
  status            ProtocolStatus @default(DRAFT)
  isDemonstration   Boolean        @default(false)
  contentSha256     String?
  approvedById      String?        @db.Uuid
  approvedAt        DateTime?      @db.Timestamptz(3)
  approvalReference String?
  effectiveFrom     DateTime?      @db.Timestamptz(3)
  retiredAt         DateTime?      @db.Timestamptz(3)
  createdById       String         @db.Uuid
  createdAt         DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime       @updatedAt @db.Timestamptz(3)

  approvedBy User? @relation("RuleSetApprovedBy", fields: [approvedById], references: [id], onDelete: Restrict)
  createdBy  User  @relation("RuleSetCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  events     ClinicalRuleSetEvent[]
  results    ScreeningResult[]

  @@unique([code, version])
  @@index([category, status, ageMinDays, ageMaxDays])
}

/// Change history of a rule set (append-only).
model ClinicalRuleSetEvent {
  id         String           @id @default(uuid()) @db.Uuid
  ruleSetId  String           @db.Uuid
  type       RuleSetEventType
  fromStatus ProtocolStatus?
  toStatus   ProtocolStatus
  actorId    String           @db.Uuid
  /// Approval document / committee minute reference (no personal data).
  reference  String?
  /// Encrypted (enc1:).
  note       String?
  occurredAt DateTime         @default(now()) @db.Timestamptz(3)

  ruleSet ClinicalRuleSet @relation(fields: [ruleSetId], references: [id], onDelete: Restrict)
  actor   User            @relation(fields: [actorId], references: [id], onDelete: Restrict)

  @@index([ruleSetId, occurredAt])
}

/// Session-level result for ONE screening version (decision F). Immutable except `supersededAt`.
model ScreeningResultRun {
  id               String        @id @default(uuid()) @db.Uuid
  sessionId        String        @db.Uuid
  /// 1 = as completed; n + 1 after amendment n.
  screeningVersion Int
  /// Most cautious category outcome.
  overallOutcome   ResultOutcome
  /// True when any category used demonstration content or rules.
  isDemonstration  Boolean
  /// Evaluator code version, e.g. "rules-engine/1".
  engineVersion    String
  /// null = generated automatically on completion / amendment.
  generatedById    String?       @db.Uuid
  generatedAt      DateTime      @db.Timestamptz(3)
  /// Set once, when the next screening version's run is created.
  supersededAt     DateTime?     @db.Timestamptz(3)

  session     ScreeningSession  @relation(fields: [sessionId], references: [id], onDelete: Restrict)
  generatedBy User?             @relation(fields: [generatedById], references: [id], onDelete: Restrict)
  results     ScreeningResult[]
  review      ClinicalReview?

  @@unique([sessionId, screeningVersion])
  @@index([generatedAt])
}

/// One clinical review per result run (decision H).
model ClinicalReview {
  id                String                  @id @default(uuid()) @db.Uuid
  resultRunId       String                  @unique @db.Uuid
  /// Snapshot of the child's area when the task was created (reporting only; access follows the child).
  areaId            String                  @db.Uuid
  status            ClinicalReviewStatus    @default(PENDING_REVIEW)
  /// Reviewer who has claimed the task (UNDER_REVIEW).
  claimedById       String?                 @db.Uuid
  claimedAt         DateTime?               @db.Timestamptz(3)
  decision          ClinicalReviewDecision?
  decidedById       String?                 @db.Uuid
  /// Role code of the decider at decision time (e.g. MHT_MEDICAL_OFFICER).
  decidedByRoleCode String?
  decidedAt         DateTime?               @db.Timestamptz(3)
  /// Encrypted (enc1:). Required for every decision except ACCEPT_RESULT.
  notes             String?
  version           Int                     @default(1)
  createdAt         DateTime                @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime                @updatedAt @db.Timestamptz(3)

  resultRun ScreeningResultRun    @relation(fields: [resultRunId], references: [id], onDelete: Restrict)
  area      Area                  @relation(fields: [areaId], references: [id], onDelete: Restrict)
  claimedBy User?                 @relation("ReviewClaimedBy", fields: [claimedById], references: [id], onDelete: Restrict)
  decidedBy User?                 @relation("ReviewDecidedBy", fields: [decidedById], references: [id], onDelete: Restrict)
  events    ClinicalReviewEvent[]
  referrals Referral[]
  followUps FollowUp[]

  @@index([status, createdAt])
  @@index([areaId, status])
}

/// Append-only history of a review (claim, release, decision).
model ClinicalReviewEvent {
  id            String                  @id @default(uuid()) @db.Uuid
  reviewId      String                  @db.Uuid
  fromStatus    ClinicalReviewStatus?
  toStatus      ClinicalReviewStatus
  decision      ClinicalReviewDecision?
  actorId       String                  @db.Uuid
  actorRoleCode String
  /// Encrypted (enc1:).
  notes         String?
  occurredAt    DateTime                @default(now()) @db.Timestamptz(3)

  review ClinicalReview @relation(fields: [reviewId], references: [id], onDelete: Restrict)
  actor  User           @relation(fields: [actorId], references: [id], onDelete: Restrict)

  @@index([reviewId, occurredAt])
}

/// Append-only change history of a facility (old/new values of changed fields).
model FacilityHistory {
  id         String   @id @default(uuid()) @db.Uuid
  facilityId String   @db.Uuid
  /// CREATED, UPDATED, VERIFIED, UNVERIFIED, DEACTIVATED, REACTIVATED
  action     String
  changes    Json
  reason     String?
  actorId    String   @db.Uuid
  occurredAt DateTime @default(now()) @db.Timestamptz(3)

  facility Facility @relation(fields: [facilityId], references: [id], onDelete: Restrict)
  actor    User     @relation(fields: [actorId], references: [id], onDelete: Restrict)

  @@index([facilityId, occurredAt])
}

/// Append-only history of a follow-up task.
model FollowUpEvent {
  id           String            @id @default(uuid()) @db.Uuid
  followUpId   String            @db.Uuid
  type         FollowUpEventType
  fromStatus   FollowUpStatus?
  toStatus     FollowUpStatus
  actorId      String            @db.Uuid
  assignedToId String?           @db.Uuid
  oldDueDate   DateTime?         @db.Date
  newDueDate   DateTime?         @db.Date
  /// Encrypted (enc1:). Required for RESCHEDULED, MISSED, CANCELLED, REASSIGNED.
  reason       String?
  occurredAt   DateTime          @default(now()) @db.Timestamptz(3)

  followUp   FollowUp @relation(fields: [followUpId], references: [id], onDelete: Restrict)
  actor      User     @relation("FollowUpEventActor", fields: [actorId], references: [id], onDelete: Restrict)
  assignedTo User?    @relation("FollowUpEventAssignee", fields: [assignedToId], references: [id], onDelete: Restrict)

  @@index([followUpId, occurredAt])
}
```

## 4. Reshaped models (all currently empty)

### 4.1 `ScreeningResult` - one row per category per result run

| Change | Column |
|---|---|
| add | `resultRunId` (FK, required), `sessionCategoryId` (FK, null when NOT_ASSESSED), `protocolId` (FK, null when NOT_ASSESSED), `ruleSetId` (FK, null when NOT_INTERPRETED), `referralRecommended Boolean`, `suggestedPriority ReferralUrgency?` (only from an ACTIVE or demonstration rule) |
| rename/repurpose | `reasons Json` -> `evidence Json`: `[{ kind: "observation" | "measurement" | "amendmentChange", id, questionCode?, ruleId? }]` - references only, no copied values |
| keep | `category`, `outcome`, `source`, `limitations`, `aiAnalysisId` (unused), `createdAt` |
| drop | `ruleSetVersion` (replaced by `ruleSetId`), `reviewStatus`, `reviewedById`, `reviewedAt`, `reviewNotes` (moved to `ClinicalReview`) |
| constraints | `@@unique([resultRunId, category])`; CHECK: `NOT_INTERPRETED` iff `ruleSetId` is null (or category not assessed); `URGENT/FURTHER_EVALUATION` require `ruleSetId`; trigger: immutable after insert; rule set used must be ACTIVE (or demonstration) and match category, protocol code and age |

### 4.2 `Facility`

| Change | Column |
|---|---|
| add | `officialCode String?` (unique when present), `nameHi String?`, `contactPhone` (rename of `phone`), `services String[]` (codes; only when verified), `acceptsReferrals Boolean @default(false)`, `verificationStatus VerificationStatus @default(UNVERIFIED)`, `verifiedById`, `verifiedAt`, `verificationReference`, `deactivatedAt`, `deactivationReason`, `version Int @default(1)`, `createdById`, `updatedById` |
| keep | `name`, `type`, `areaId` (state/district/block come from the area tree - no duplicated text), `address`, `isActive` |
| constraints | unique `officialCode`; unique index on `(areaId, type, lower(name))`; CHECK: `acceptsReferrals` or non-empty `services` require `VERIFIED` + reference; CHECK: `isActive=false` iff `deactivatedAt` set; version +1 trigger; no DELETE |

### 4.3 `Referral`

| Change | Column |
|---|---|
| add | `origin ReferralOrigin`, `screeningResultId` (FK to the category result, optional), `clinicalReviewId` (FK, optional), `approvedById`, `approvedAt`, `issuedAt`, `sharingConsentId` (FK `Consent`, set at ISSUE), `consentVerifiedAt`, `consentWithdrawnAfterIssueAt`, `outOfDistrictReason` (enc1), `version Int @default(1)` |
| change | `facilityId` -> **optional** (required from ISSUED on, CHECK); `status` default `PENDING_APPROVAL`; `reasonCode` -> required; `notes` -> `reasonNote` (enc1); `urgency` kept (shown as "priority") |
| keep | `childId`, `sessionId`, `areaId` snapshot, `category`, `appointmentAt`, `closedAt`, `clientOperationId`, `createdById`, timestamps |
| constraints | partial unique index: one active referral per `(childId, COALESCE(sessionId, zero-uuid), category)` where status not in (REJECTED, CLOSED, CANCELLED) (decision N); CHECK: `screeningResultId`'s run belongs to `sessionId`, which belongs to `childId` (trigger); state-machine trigger (section 6 of architecture.md); version +1; no DELETE; ISSUED and later require `facilityId`, `issuedAt`, `sharingConsentId` |

### 4.4 `ReferralStatusEvent`

| Change | Column |
|---|---|
| add | `actorRoleCode String`, `source ReferralUpdateSource`, `verificationStatus VerificationStatus`, `effectiveAt DateTime?` (when it happened, per the source - e.g. visit date), `facilityId` (facility at that moment), `correctsEventId` (FK self, for decision J corrections) |
| change | `note` -> encrypted; new `reason` (enc1) required (CHECK) for REJECTED, CANCELLED, CLOSED and corrections |
| constraints | append-only (no UPDATE/DELETE); `toStatus` must equal the referral's new status (inserted in the same transaction) |

### 4.5 `FollowUp`

| Change | Column |
|---|---|
| add | `screeningSessionId` (FK, optional), `clinicalReviewId` (FK, optional), `reasonCode String`, `reasonNote` (enc1), `nextAction` (enc1), `assignedById`, `createdById`, `clientOperationId @unique`, `version Int @default(1)` |
| change | `status` new enum (default `PENDING`); `outcomeNote` -> encrypted |
| constraints | partial unique: one active (PENDING/ASSIGNED/IN_PROGRESS) task per `(childId, COALESCE(referralId, zero-uuid), reasonCode)`; CHECK: ASSIGNED/IN_PROGRESS need `assignedToId`; COMPLETED needs `completedAt/ById`; version +1; no DELETE; sessions/referrals/reviews referenced must belong to the same child (trigger) |

### 4.6 `Notification`

| Change | Column |
|---|---|
| add | `entityType String`, `entityId String @db.Uuid`, `dedupeKey String @unique` (e.g. `FOLLOW_UP_DUE_SOON:<followUpId>:<dueDate>`) |
| keep | `userId`, `type` (new enum), `payload` (ids only), `readAt`, `createdAt` |
| constraints | only `readAt` may change, once (trigger) |

### 4.7 Other

- `User`: back-relations only.
- `ScreeningSession`: back-relation `resultRuns`.
- `ScreeningAmendmentReferralImpact`: column `referralStatusAtAmendment` switches to the new
  `ReferralStatus` type (table empty). The 6G trigger's comment already reserves the one-time
  reassessment update for Step 7; no change to the trigger.

## 5. Indexes for the main queries

| Query | Index |
|---|---|
| Review queue in scope | `ClinicalReview(status, createdAt)`, `(areaId, status)` + child scope join |
| Results of a session / latest version | `ScreeningResultRun(sessionId, screeningVersion)` unique |
| Referral lists by status / facility | existing `Referral(areaId, status)`, `(facilityId, status)`, `(childId)`; add `(status, updatedAt)` |
| Referral timeline | existing `ReferralStatusEvent(referralId, changedAt)` |
| My follow-ups due | existing `FollowUp(assignedToId, status, dueDate)`, `(status, dueDate)` |
| My unread notifications | existing `Notification(userId, readAt, createdAt)` |
| Active rule set for category + age | `ClinicalRuleSet(category, status, ageMinDays, ageMaxDays)` + exclusion constraint: ACTIVE sets of one category and protocol code never overlap in age (same technique as Step 6 protocols) |
| Facility picker | existing `Facility(areaId, type, isActive)`; add `(verificationStatus, acceptsReferrals, isActive)` |

## 6. Grants (`infrastructure/db/setup-app-role.sql`)

- Revoke `DELETE, TRUNCATE` from the runtime account on: `ClinicalRuleSet`,
  `ClinicalRuleSetEvent`, `ScreeningResultRun`, `ScreeningResult`, `ClinicalReview`,
  `ClinicalReviewEvent`, `Facility`, `FacilityHistory`, `Referral`, `ReferralStatusEvent`,
  `FollowUp`, `FollowUpEvent`.
- `Notification`: revoke `TRUNCATE` only (old notifications may be purged by a later retention job;
  not in Step 7).

## 7. Seed / configuration (not schema)

- Permissions `referral.approve` and `follow_up.update` (both "fieldwork" delegation class) added
  to `permissions.ts`; role matrix per architecture.md section 7; `db:setup-roles` re-run.
- Demonstration rule sets (decision C) seeded in dev only, `isDemonstration = true`, DRAFT.
- No facility is seeded in dev except clearly named synthetic test facilities
  (`TEST FACILITY - not real`), and none in production.

## 8. Rollback

Before approval there is nothing to roll back. After it is applied: the migration only touches
tables that were empty, so a rollback (a new forward migration restoring the old shapes) loses
only Step 7 test data. It is never run against a database with real referrals - the empty-table
guard is in the migration itself.

## 9. What needs your approval

1. Decisions A-X in [architecture.md](architecture.md) (they drive this proposal).
2. This schema proposal as a whole, including reshaping the six empty tables in place instead of
   adding parallel ones.
3. Running the migration on the **dev** and **test** databases in stage 7B.
