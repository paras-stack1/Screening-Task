# Step 6 - Initial Audit and Schema-Change Proposal

> Status: Phases 1-2 of Step 6 (2026-11-22). **Inspection only - no code, schema or data was
> changed.** Branch `feat/step-5-children` at `8538e9b` (Step 5 committed, working tree clean).
> Every proposal below needs approval before implementation (decisions A-U, section 9).

## 1. Baseline (measured on 2026-11-22, before any Step 6 change)

| Suite | Command | Result |
|---|---|---|
| API unit | `npx vitest run` (services/api) | 254 / 254 passed |
| API database | `npx vitest run --config vitest.db.config.mts` | 235 / 235 passed |
| Frontend | `npx jest` (apps/worker-app) | 1433 passed, 10 skipped, 0 failed |
| Migrations | `prisma migrate status` | Dev database up to date (2 migrations) |
| Screening data in dev DB | row counts | `ScreeningProtocol`, `ScreeningQuestion`, `ScreeningSession`, `ScreeningObservation`, `Measurement`, `ScreeningResult`: **0 rows each** |

The schema-drift command (`prisma migrate diff`) exited with an error because the shadow-database
URL was not set in that shell. It is **not** counted as a pass; it will be re-run in Stage 6B.

## 2. Existing modules that Step 6 will reuse (no duplication)

| Need | Existing implementation | File |
|---|---|---|
| Authentication | Access-token middleware, refresh rotation, account status | `middleware/authenticate.ts`, `modules/auth/*` |
| Route permission (audited `authz.denied`) | `requirePermission(code)` | `middleware/authorize.ts` |
| Area + child scope, IDOR as 404 + audit | `childScopeWhere`, `findChildOrDeny`, `assertInScopeOrDeny`, `scopedWhere.screeningSession / screeningObservation / measurement / screeningResult` (already written for screening, unused) | `modules/access-control/accessScope.ts` |
| Consent at point of use | `assertConsentPermits(db, ctx, childId, 'SCREENING', permission, policy)` - latest decision wins, guardian must still be linked and authorised, notice valid, denial audited as `consent.check_denied` | `modules/consent/consentPolicy.ts` |
| Draft-content policy | `allowDraftNotices` (DRAFT allowed outside production only) - same pattern fits draft protocols | `consentPolicy.ts`, `config/env` |
| Idempotent creates | `runIdempotent` over `SyncOperation` (unique user + clientOperationId, request fingerprint, replay) | `utils/idempotency.ts` |
| Audit log (append-only by trigger + revoked rights) | `recordAudit` | `modules/audit/audit.service.ts` |
| Calendar dates, IST "today", leap-year-safe age | `parseCalendarDate`, `todayInIndia`, `ageOn`, `daysInMonth` | `packages/shared-contracts/src/dates.ts` |
| DOB storage helpers | `toDbDate`, `fromDbDate` | `modules/children/birthDate.ts` |
| Errors, validation, rate limits, Helmet, CORS, 1 MB body limit | `AppError`, `validate`, shared `dataRateLimit`, `app.ts` | `utils`, `middleware` |
| Permissions | `screening.conduct` (ASHA, AWW, MHT MO), `screening.review` (MHT MO); `child.read` is defined as "Read individual child, guardian **and screening** records" | `access-control/permissions.ts`, `roles.ts` |
| Frontend | Central `ApiClient` (no direct fetch), TanStack Query with user-prefixed keys, `newSubmissionId()`, `ChoiceGroup`, `FourDCategoryCard`, `StatusBadge`, `ConfirmationDialog`, `OfflineBanner`, en/hi localization, consent overview screens | `apps/worker-app/src/**` |
| Test fixtures | `authzFixture`, `scenarioFixture`, frontend `fakeBackend` | `services/api/tests/db`, `apps/worker-app/tests/support` |

Empty placeholders: `services/api/src/modules/screening/` and `modules/referrals/` (directories
only). The dashboard "Start screening" card is shown disabled with "Coming soon". The child profile
says "Screening is not available in the app yet".

## 3. Existing database entities for screening (approved design v0.1)

| Entity | What it supports today | Gap against Step 6 |
|---|---|---|
| `ScreeningProtocol` | code + version (unique), age band in days, `sourceReference` (required), `status` DRAFT/APPROVED/RETIRED, `clinicalApprovedById/At` | **One protocol per session**, covering all four Ds. No per-category versioning, no IN_REVIEW/ACTIVE states, no effective/retirement dates, no description or approval reference, no rule that an APPROVED row has an approver. Content is not protected from editing after approval |
| `ScreeningQuestion` | category (4D), sort order, answer type, options JSON, required flag, `promptKey`/`helpKey` | Wording lives in **app translation files**, so an app update could change an "approved" question without a new protocol version. No section grouping, no validation rules (number range, unit), and no check that a question's category matches its protocol |
| `ScreeningSession` | child, protocol, conductor, area snapshot, `ageInDaysAtStart`, status DRAFT/IN_PROGRESS/COMPLETED/CANCELLED, timestamps, cancel reason | No per-category progress, no `cancelledById`, no record of the consent used, no DOB/estimated-flag snapshot, no optimistic-lock version, and nothing that stops two open sessions for one child |
| `ScreeningObservation` | one answer per (session, question); explicit `ANSWERED`/`NOT_ASSESSED`/`UNABLE_TO_ASSESS`; typed value columns | No `UNKNOWN` state, notes, source (worker-observed vs guardian-reported), recorder or `updatedAt`. Nothing checks that the question belongs to the protocol used |
| `Measurement` | type, `Decimal(8,2)` value, unit, method, device make/model/serial, quality flag, measuredAt, recorder; CHECK value > 0 | No source (measured vs reported), no correction chain (it has no `updatedAt`, so corrections would overwrite in place). `childId` and `sessionId` can disagree: nothing in the database ties them together |
| `ScreeningResult` | per-category outcome incl. `INSUFFICIENT_DATA`, source, rule-set version, review status; no diagnosis field | Correct for a later rules/AI step. **Not needed in Step 6**: there are no approved rules to produce outcomes |
| `Consent`, `ConsentTemplate` | Step 5, append-only, purpose `SCREENING` exists | Reused as is |
| `AuditLog`, `SyncOperation` | append-only audit; idempotency store | Reused as is |

## 4. Missing functionality

1. Screening API (none exists): templates, sessions, categories, responses, measurements,
   lifecycle, history.
2. Clinical-content lifecycle and approval tooling (no approver role or endpoint exists).
3. Age-at-screening calculation in days and age-band selection (the date helpers exist).
4. All 15 screening screens; screening query keys and contracts in `shared-contracts`.
5. Real "screened today / in progress / drafts" metrics (the dashboard shows "Not available yet").
6. **Approved clinical content: none exists.** No approved questions, age bands, plausibility
   ranges, scoring or referral rules exist anywhere in the repository or docs.

## 5. Security and integrity weaknesses found

| # | Finding | Severity if left | Proposed fix |
|---|---|---|---|
| W1 | `Measurement.childId` and `Measurement.sessionId` may refer to different children (no DB guard). A bug could attach child A's weight to child B's screening | High (data integrity) | Composite FK `(sessionId, childId)` -> `ScreeningSession(id, childId)` (decision I) |
| W2 | An observation can reference a question from a different protocol than the session uses | High (wrong template version) | Service check + DB trigger (decision G) |
| W3 | Approved protocols and questions can be edited in place; nothing preserves the approved content | High (clinical governance) | Immutability trigger once a protocol leaves DRAFT (decision D) |
| W4 | `ApprovalStatus` is shared by consent notices and protocols. Adding protocol states to it would change consent behaviour (`evaluateConsents` treats non-APPROVED as draft) | High if done naively | Separate `ProtocolStatus` enum (decision B) |
| W5 | Question wording in app translation files is outside protocol versioning (see section 3) | Medium | Wording stored with the protocol version + hash (decision C) |
| W6 | No guard against concurrent edits or duplicate open sessions for one child | Medium | Version column + partial unique index (decision K) |
| W7 | Supervisors hold `child.read`, so they will be able to read screening answers (consistent with the permission's definition, but worth confirming) | Policy | Decision M |
| W8 | Health data is not encrypted at application level (only guardian phones are). It relies on database/disk encryption, which is not set up in dev | Policy / infrastructure | Documented limitation; infrastructure decision outside Step 6 |
| W9 | Rate limits are per process, in memory (known from Step 5) | Low now | Unchanged; documented |
| W10 | `AuditLog.details` is free JSON: screening code must never put answer values or notes there | Process | Tests assert audit details contain no values |

No existing Critical vulnerability was found in Steps 1-5 code during this audit.

## 6. Conflicts between the Step 6 brief and the approved architecture

| # | Brief says | Existing approved design | Proposed resolution |
|---|---|---|---|
| C1 | Per-category templates and `ScreeningCategoryResult` | One protocol per session | Additive per-category table (A) |
| C2 | Lifecycle DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> RETIRED | DRAFT/APPROVED/RETIRED (shared enum) | New protocol-only enum (B) |
| C3 | Separate `ScreeningResponse` and `ScreeningObservation` entities | `ScreeningObservation` **is** the per-question response | Reuse `ScreeningObservation` as the response table. Free-text observations go in category-level notes. No duplicate table |
| C4 | Offline drafts, sync states, idempotent sync | Step 4 rule: no child/screening data on the device until an approved offline-security design exists; no SQLite installed | Online-only screening; server-side drafts give resume (Q) |
| C5 | Correction/amendment workflows | None approved | Measurement corrections while a session is open; completed sessions locked; amendments deferred (H, I) |
| C6 | `ScreeningResult`/referral recommendations "when approved rules exist" | No approved rules | Step 6 writes no `ScreeningResult` rows and no recommendation (P) |
| C7 | `/screening-templates` API name | Table is `ScreeningProtocol` | API uses `/screening-protocols` to keep one name (S) |
| C8 | "Unknown DOB" support | `Child.dateOfBirth` is NOT NULL; Step 5 converts "unknown" to an estimated date from an age estimate | Treat as estimated DOB; no schema change (O) |

## 7. Dependencies on Steps 1-5

- Step 3: authentication, `requirePermission`, area scope, audit, rate limiting, error format.
- Step 4: API client, query client, connectivity/offline banner, design system, localization.
- Step 5: child records (DOB + estimated flag), guardian links with consent authority, the
  `SCREENING` consent check, `runIdempotent`, the `allowDraft*` environment policy.
- Seed/infra: `db:setup-roles` must be re-run after the migration. The new tables are covered by
  the default grants. DELETE on completed records is blocked by a trigger, not by grants.

## 8. Schema-change proposal (Phase 2) - NOT applied, needs approval

One additive migration, `step6_screening_foundation`. All affected tables hold 0 rows (section 1),
so no data is rewritten. Prisma 6 cannot express the partial index, composite FK or triggers, so
they go in hand-written SQL in the migration (same practice as Step 5).

### 8.1 New enum and protocol governance (decisions A-E)

```prisma
enum ProtocolStatus { DRAFT IN_REVIEW APPROVED ACTIVE RETIRED }
enum CategoryProgress { NOT_STARTED IN_PROGRESS COMPLETED }
enum ResponseSource { WORKER_OBSERVED GUARDIAN_REPORTED }
enum MeasurementSource { MEASURED GUARDIAN_REPORTED FROM_RECORD }

model ScreeningProtocol {           // changed (0 rows)
  category          FourDCategory   // NEW: one protocol = one D, one age band, one version
  descriptionEn     String?         // NEW
  descriptionHi     String?         // NEW
  status            ProtocolStatus  // CHANGED type (was ApprovalStatus)
  approvalReference String?         // NEW: clinical approval document/minute number
  effectiveFrom     DateTime?       // NEW
  retiredAt         DateTime?       // NEW
  contentSha256     String?         // NEW: hash of protocol + questions, set on leaving DRAFT
  isDemonstration   Boolean @default(false) // NEW: demonstration content, never operational
  @@index([category, status, ageMinDays, ageMaxDays])
}

model ScreeningQuestion {           // changed (0 rows)
  sectionCode String                // NEW: groups questions into one screen at a time
  prompt      Json                  // NEW: { "hi": "...", "en": "..." } frozen with the version
  help        Json?                 // NEW
  validation  Json?                 // NEW: e.g. number min/max/decimals/unit from the protocol
  // promptKey/helpKey kept as stable codes (not displayed text)
}
```

SQL additions:
- CHECK: `status IN ('APPROVED','ACTIVE','RETIRED')` requires `clinicalApprovedById`,
  `clinicalApprovedAt`, `approvalReference`, `contentSha256`, and `isDemonstration = false`.
- CHECK: `retiredAt` is set if and only if `status = 'RETIRED'`.
- Trigger `screening_protocol_protect`: after a protocol leaves DRAFT, its content columns and all
  its questions are immutable (no INSERT/UPDATE/DELETE of questions). Status may only move forward
  DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> RETIRED (IN_REVIEW -> DRAFT allowed for rework). A
  protocol that any session has used can never be deleted (FK RESTRICT already).
- Trigger: `ScreeningQuestion.category` must equal its protocol's `category`.

### 8.2 Session and per-category progress (decisions A, K, N, O, R)

```prisma
model ScreeningSession {            // changed (0 rows)
  protocolId          String?  @db.Uuid  // CHANGED to nullable, deprecated: per-category now
  screeningConsentId  String   @db.Uuid  // NEW FK -> Consent: the SCREENING consent relied on
  dateOfBirthAtStart  DateTime @db.Date  // NEW snapshot
  dobEstimatedAtStart Boolean            // NEW snapshot
  cancelledById       String?  @db.Uuid  // NEW FK -> User
  version             Int      @default(1) // NEW optimistic lock, +1 on every change
  clientOperationId   String?  @unique @db.Uuid // NEW idempotent create
  categories          ScreeningSessionCategory[]
  @@unique([id, childId])            // target of the measurement composite FK
}

model ScreeningSessionCategory {    // NEW
  id                    String           @id @default(uuid()) @db.Uuid
  sessionId             String           @db.Uuid
  category              FourDCategory
  protocolId            String           @db.Uuid   // exact protocol version used
  protocolStatusAtStart ProtocolStatus              // proves whether content was approved at use
  status                CategoryProgress @default(IN_PROGRESS)
  notes                 String?                     // free-text worker observations
  startedAt             DateTime         @db.Timestamptz(3)
  completedAt           DateTime?        @db.Timestamptz(3)
  createdAt / updatedAt
  @@unique([sessionId, category])                  // no duplicate category per session
}
```

SQL additions:
- Partial unique index `screening_one_open_session_per_child` on `ScreeningSession(childId)
  WHERE status IN ('DRAFT','IN_PROGRESS')`.
- CHECKs: `completedAt` set if and only if COMPLETED; `cancelledAt`, `cancelledById` and
  `cancelReason` all set if and only if CANCELLED.
- Trigger `screening_session_protect`: a COMPLETED or CANCELLED session is final. Its own row, its
  category rows, observations and measurements reject UPDATE/DELETE, and no new child rows may be
  added. No DELETE of sessions at all. (Amendment workflow deferred, decision H.)

### 8.3 Responses (decisions G, H)

```prisma
enum ObservationStatus { ANSWERED UNKNOWN NOT_ASSESSED UNABLE_TO_ASSESS }  // + UNKNOWN

model ScreeningObservation {        // changed (0 rows)
  sessionCategoryId String         @db.Uuid  // NEW FK -> ScreeningSessionCategory
  source            ResponseSource           // NEW
  notes             String?                  // NEW
  recordedById      String         @db.Uuid  // NEW FK -> User
  updatedAt         DateTime       @updatedAt // NEW
}
```

Trigger: the observation's question must belong to its category row's `protocolId`, and the
category row must belong to the same `sessionId`. Missing answer = no row (never a default "No").

### 8.4 Measurements (decisions I, J)

```prisma
model Measurement {                 // changed (0 rows)
  source           MeasurementSource         // NEW
  supersedesId     String?  @unique @db.Uuid // NEW: correction chain (self FK)
  correctionReason String?                   // NEW: required when supersedesId is set
  notes            String?                   // NEW
}
```

SQL additions:
- Composite FK `(sessionId, childId)` -> `ScreeningSession(id, childId)` (fixes W1).
- Trigger: measurements are insert-only, with no UPDATE or DELETE. A correction is a new row
  pointing at the row it supersedes, of the same type and child. Superseded rows stay visible in
  the history.
- CHECK: `supersedesId` and `correctionReason` are both set or both null.

### 8.5 Not changed

`ScreeningResult`, `AiAnalysis`, `Referral`, `FollowUp` and `MediaMetadata` are not touched in
Step 6. `ConsentTemplate`/`ApprovalStatus` are unchanged. No columns or rows are dropped.

## 9. Decisions needed (recommended defaults)

| # | Decision | Recommendation |
|---|---|---|
| A | Template granularity | One protocol per Four-D category and age band, with a `ScreeningSessionCategory` row per category screened. `ScreeningSession.protocolId` becomes nullable and unused (kept, not dropped) |
| B | Lifecycle states | New `ProtocolStatus` DRAFT/IN_REVIEW/APPROVED/ACTIVE/RETIRED for protocols only. In production only ACTIVE protocols, within their effective dates, can start a category |
| C | Where approved wording lives | In the database with the protocol version (`{hi, en}`), plus a content hash. App translation files hold only UI text |
| D | Content immutability | DB trigger: content is frozen once a protocol leaves DRAFT; changes need a new version; old versions are kept forever |
| E | Who approves, and how | No approval API/UI in Step 6. An audited admin script (`db:protocol-status`) moves a protocol through the lifecycle and records the approver user, the approval reference and the content hash. It is run by the person the programme designates. Step 6 itself approves nothing |
| F | Content for development | Seed DRAFT **demonstration** protocols for D1-D4 with plainly placeholder wording ("Demonstration question - not clinically approved"). Usable only when `ALLOW_DRAFT_PROTOCOLS` is on (never in production, same as draft consent notices). A banner on every screening screen says "Demonstration content - not for clinical use" |
| G | Answer states | Add `UNKNOWN`. Keep `NOT_ASSESSED` and `UNABLE_TO_ASSESS` (the latter covers "declined / could not complete"). Unanswered = no row. Every response stores its source (worker-observed / guardian-reported), notes and recorder |
| H | Editing and amendments | Answers can be edited while the session is open (version check; audit records "changed", without values). Completed sessions are locked by trigger. Amendment of completed records is **deferred** until a workflow is approved (documented limitation) |
| I | Measurement model | Insert-only. A correction is a new row that supersedes the old one (reason required). Source is stored (measured / guardian-reported / from record). Composite FK keeps child and session consistent. Units are stored as entered: weight `kg`/`g`, lengths `cm`/`mm`; conversions are explicit, tested, read-time only. `HAEMOGLOBIN` is not offered in Step 6 |
| J | Plausibility limits | Reject only invalid numbers (NaN, Infinity, ≤ 0, more decimals than the unit allows, exceeds column precision). Very wide "physically impossible" limits are kept in versioned config and marked **ASSUMPTION - pending programme approval**. No clinical classification at all. The worker sets the quality flag |
| K | Session integrity | Add the consent reference, DOB snapshot, `cancelledById` and an optimistic-lock `version` (stale writes get 409). One open session per child (partial unique index). Idempotent create via `clientOperationId` |
| L | Who may change a session | Only the worker who started it may edit, complete or cancel it. Other authorised workers in the area see it read-only. Cancel needs a reason (no personal data). Reassignment is deferred |
| M | Who may read screening records | `child.read` (as the existing permission text defines), so Supervisors can read answers. Protocol content needs `screening.conduct` or `child.read`. *Alternative: a new `screening.read` permission that excludes Supervisors* |
| N | Completion rules | A category can be completed only when every required question has an explicit state (an answer, UNKNOWN, NOT_ASSESSED or UNABLE_TO_ASSESS). A session can be completed only with at least one completed category. Categories not completed are reported as "not assessed". Completion is transactional and idempotent: repeating it returns the original `completedAt` |
| O | Age and estimated DOB | The server computes age in whole days from the stored DOB to the screening date (India calendar date), and selects the protocol whose band contains it. Client-sent ages are ignored. For an estimated DOB, screening is allowed but the session and each category are flagged "age estimated"; this is shown everywhere and marks the result for clinical review. No age band? The category is "Not available", with no fallback protocol |
| P | Results and referrals | Step 6 writes no `ScreeningResult` rows and shows no recommendation. The summary says "Screening observations recorded. No approved screening rules are configured, so no recommendation is generated. Follow the approved referral protocol" |
| Q | Offline | Online-only screening: no screening data is stored on the device (Step 4 rule). Unsaved answers live in memory, and server drafts enable resume. Saving is disabled offline, with a clear message. A warning shows before leaving unsaved work |
| R | Consent timing | Run `assertConsentPermits('SCREENING')` at session start **and** inside every write and completion transaction. If consent is withdrawn mid-session, writes and completion are blocked; cancellation stays allowed. Media/AI consents are not used (no media in Step 6) |
| S | API shape | `/api/v1/screening-protocols` (read-only) and `/api/v1/screenings` (create, list, get, cancel, complete). Categories are addressed by code (`/screenings/:id/categories/DEFICIENCIES`). Section save is a batch `PUT .../categories/:category/responses` with `expectedVersion` (fewer requests on slow networks). Measurements: POST create, POST `/:measurementId/corrections`. `GET /children/:childId/screenings` (paginated history). `GET /screenings/summary` gives the caller's real counts for the dashboard |
| T | Frontend placement | New stack `app/(app)/screening/*`. Enable the dashboard "Start screening" card and the real metric tiles. The child profile gets "Start / continue screening" and its history. The 4-D cards show workflow state only (never green for "healthy") |
| U | Delivery plan | **6B** migration + protocol framework + demo seed + age/eligibility + protocol API. **6C** session/category/response/measurement/lifecycle API + audit + DB/security tests. **6D** frontend flow (dashboard, select child, eligibility, categories, forms, measurements). **6E** review, summary, history, resume, regression, the 10 `docs/step-6` documents, final report. Stop for review after each |

## 10. Clinical and programme inputs that block **operational** use (not the technical build)

1. Approved Four-D questions, wording (hi/en), age bands and answer options, with source references.
2. Who is the clinical content approver, and what the approval evidence is.
3. Data-quality ranges for each measurement type and unit; measurement methods and devices.
4. Scoring and referral rules, if any (Step 6 implements none).
5. The age-band policy for estimated DOB, and whether screening without an exact DOB is permitted.
6. Amendment workflow for completed screenings.
7. Retention of screening records (D8) and at-rest encryption of health data (W8).

Until these exist, the system runs only with clearly marked demonstration content outside production.
