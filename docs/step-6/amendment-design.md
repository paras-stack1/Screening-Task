# Amending Completed Screenings - Design and Schema Proposal (Stage 6G)

> Status: **APPROVED 2026-11-23. 6G-1 (database, API, tests) implemented**; 6G-2 (app screens) not
> started. Implementation notes: section 9.
> Based on the user's rules of 2026-11-23 (below).

## 1. Agreed rules (from the user)

1. **Who:** the worker who conducted the screening **and** an authorised supervisor / medical
   officer.
2. **Time limit:** the original worker may amend for **7 days** after completion.
3. **No separate approval** for permitted amendments, but:
   - a reason is mandatory;
   - original data is never overwritten or deleted;
   - old value, new value, who, when and why are stored;
   - the amendment history is append-only;
   - the summary shows the history and the latest (amended) values;
   - amendments to clinically significant information are flagged for review by an authorised
     medical officer.
4. **Safeguards:** the original version stays immutable; amendments create a new version;
   concurrent amendments never silently overwrite each other; unauthorised users cannot amend even
   with the id; everything is audited; referrals made from the earlier version keep their history
   and are flagged for reassessment.

## 2. Approach: versions as an append-only overlay

The completed session and its answers, areas and measurements are **never touched**: the
existing database trigger that freezes completed sessions stays exactly as it is.

Each amendment is a new **version** of the screening: one `ScreeningAmendment` row (version 2,
3, …) with one or more `ScreeningAmendmentChange` rows. Each change stores the **old value** (as
it was in the previous version) and the **new value**.

```
Version 1  = the original completed screening (immutable rows, as today)
Version 2  = version 1 + amendment #1's changes
Version 3  = version 2 + amendment #2's changes  ...
Current    = original + all amendments applied in order (computed when read)
```

Why not copy the whole session for each version: copies duplicate health data, make the "what
changed" question hard to answer, and would need the completed-session lock to be relaxed.

## 3. What can and cannot be amended

| Can be amended | Cannot be amended (a new screening is needed instead) |
|---|---|
| An answer: its state (answer / unknown / not assessed / could not assess), value, source, notes, reason - including answering a question that was left unanswered | The child, age, area, consent, worker or dates of the session |
| A measurement: value, unit, source, reliability, measured date (the original measurement and any earlier corrections stay) | Starting a Four-D area that was not started, or removing one |
| The notes of a Four-D area | A cancelled screening, or one still in progress (in progress = edit normally) |

## 4. Schema changes proposed (one additive migration)

```prisma
enum AmendmentBasis {
  CONDUCTOR_WITHIN_WINDOW   // the worker who did the screening, within 7 days
  MEDICAL_OFFICER           // a screening.review holder covering the child's area
}
enum AmendmentReviewStatus { NOT_REQUIRED PENDING REVIEWED }
enum AmendmentChangeKind { RESPONSE MEASUREMENT CATEGORY_NOTES }
enum ReassessmentStatus { PENDING REASSESSED }

/// One amendment = one new version of a COMPLETED screening. Append-only.
model ScreeningAmendment {
  id                    String   @id @default(uuid()) @db.Uuid
  sessionId             String   @db.Uuid
  /// 1 for the first amendment (= version 2 of the screening), 2 for the next, ...
  sequence              Int
  amendedById           String   @db.Uuid
  amendedAt             DateTime @db.Timestamptz(3)
  basis                 AmendmentBasis
  /// Mandatory; encrypted (enc1:), may describe the child.
  reason                String
  clinicallySignificant Boolean
  reviewStatus          AmendmentReviewStatus
  reviewedById          String?  @db.Uuid
  reviewedAt            DateTime? @db.Timestamptz(3)
  reviewNotes           String?  /// encrypted
  clientOperationId     String?  @unique @db.Uuid   // safe retry
  createdAt             DateTime @default(now())
  @@unique([sessionId, sequence])                    // concurrency guard
  @@index([reviewStatus, amendedAt])                 // medical officer's review queue
}

/// One changed item inside an amendment. Append-only.
model ScreeningAmendmentChange {
  id                    String   @id @default(uuid()) @db.Uuid
  amendmentId           String   @db.Uuid
  kind                  AmendmentChangeKind
  sessionCategoryId     String?  @db.Uuid   // RESPONSE, CATEGORY_NOTES
  questionId            String?  @db.Uuid   // RESPONSE
  measurementId         String?  @db.Uuid   // MEASUREMENT (the measurement being amended)
  /// Exact previous and new values; free-text parts encrypted. null = "not answered".
  oldValue              Json?
  newValue              Json?
  clinicallySignificant Boolean
  @@unique([amendmentId, kind, questionId, measurementId, sessionCategoryId])
}

/// A referral that was made from an earlier version and must be reassessed. The referral itself
/// is NOT changed (its history stays as it was); Step 7 shows these flags.
model ScreeningAmendmentReferralImpact {
  id                        String   @id @default(uuid()) @db.Uuid
  amendmentId               String   @db.Uuid
  referralId                String   @db.Uuid
  referralStatusAtAmendment ReferralStatus
  reassessmentStatus        ReassessmentStatus @default(PENDING)
  reassessedById            String?  @db.Uuid
  reassessedAt              DateTime? @db.Timestamptz(3)
  @@unique([amendmentId, referralId])
}
```

Database rules (triggers / CHECKs, same style as 6B):

- An amendment can be inserted only for a **COMPLETED** session, and only with
  `sequence = last sequence + 1` (the session row is locked during the check).
- `ScreeningAmendment`: no DELETE. UPDATE allowed **only once**, and only of the review fields,
  from PENDING to REVIEWED. `ScreeningAmendmentChange`: no UPDATE, no DELETE.
- A change must point at a question of the area's protocol version, an area of the same session,
  or a measurement of the same session.
- CHECKs: reason not empty; `reviewStatus = PENDING` when `clinicallySignificant`, unless already
  reviewed; review fields complete when REVIEWED.
- Runtime account: no DELETE or TRUNCATE on the three tables.
- **Unchanged:** every existing table, column and trigger (including the completed-session lock).
  No existing row is touched.

## 5. API (proposed)

| Endpoint | Who | Notes |
|---|---|---|
| `POST /screenings/:id/amendments` `{ clientOperationId, expectedSequence, reason, changes[] }` | Conductor within 7 days, or medical officer in scope | One transaction: session row locked → permission and window → `expectedSequence` equals the current one (else 409 `AMENDMENT_CONFLICT`) → each change validated as a normal answer/measurement → old values captured from the current version → amendment + changes + referral flags + audit |
| `GET /screenings/:id` | As today | Adds `currentVersion`, `amendments[]` (old → new, who, when, reason, review status), `canAmend`, `amendableUntil`; answers and measurements show the **current** values, marked "amended" |
| `POST /screenings/:id/amendments/:amendmentId/review` `{ notes? }` | Medical officer in scope | Marks a PENDING amendment REVIEWED (acknowledged). Disagreement = a new amendment, never a rollback |
| `GET /screening-amendments?reviewStatus=PENDING` | Medical officer | Review queue, scoped to their areas, paginated |

Permission failures follow the existing rules: outside the area = 404 (as if it did not exist,
audited); in the area but not allowed (e.g. after 7 days) = 403 `AMENDMENT_NOT_ALLOWED` (audited).

## 6. App (proposed)

- Summary screen: "Amend" (only when allowed, showing "you can amend until …"). Choose what to
  change (an answer, a measurement, area notes) → new value → reason (required) → confirm.
- The summary shows current values with an **Amended** badge, and an **Amendment history** list:
  version, what changed (old → new), who, when, why, and "Waiting for medical officer review" /
  "Reviewed by … on …".
- Medical officer: a review list and a "Mark as reviewed" action with optional notes.

## 7. Decisions needed (recommended defaults)

| # | Decision | Recommendation |
|---|---|---|
| G1 | Versioning model | Append-only overlay (section 2); original rows untouched |
| G2 | What is amendable | Section 3 |
| G3 | The 7 days | Exactly 7 × 24 hours from the completion time, server clock (not "until the end of the 7th day") |
| G4 | Who is "supervisor / medical officer" | Holder of `screening.review` (today: RBSK MHT medical officer) whose area scope covers the child's **current** area; no time limit. The `SUPERVISOR` role does not hold it today; give it `screening.review` only if the programme wants supervisors to amend |
| G5 | "Clinically significant" | Any change to an answer's state or value, or a measurement's value, unit, source, reliability or date. Notes-only and reason-only changes are not significant. (Later, the programme may mark questions as significant in the protocol to narrow this) |
| G6 | Who reviews | Significant amendments are PENDING for any `screening.review` holder in scope. If a medical officer made the amendment, it is still PENDING, and they may confirm it themselves; the summary then says "self-reviewed" |
| G7 | Review action | Acknowledge with optional notes; no reject or rollback (a correction is a further amendment) |
| G8 | Consent withdrawn after completion | Amendments are still allowed (they correct the accuracy of an existing record and add no new screening), and are audited |
| G9 | Referral flags | Every referral linked to the session (any status) gets a PENDING reassessment flag; the referral row itself is not changed. The flags are shown in Step 7, when referrals are built |
| G10 | Concurrency and retries | `expectedSequence` + unique (session, sequence) + session row lock: a second simultaneous amendment gets 409 and must reload. `clientOperationId` makes a retry return the first result |
| G11 | Encryption | Reasons, review notes and the free-text parts of old/new values are encrypted, as in 6F |
| G12 | Delivery | **6G-1:** migration (after approval) + API + tests. **6G-2:** app screens + tests + docs. Stop for review after each |

## 8. Automated tests planned

- **Permissions:**
  - the conductor within 7 days succeeds;
  - after 7 days the conductor gets 403;
  - a medical officer in scope succeeds at any time;
  - another worker in the same area gets 403;
  - a supervisor without `screening.review` gets 403;
  - another district gets 404;
  - a screening still in progress or cancelled gets 409;
  - a forged session, question or measurement id gets 404 or 422.
- **7-day limit:** just before / exactly at / just after 7 × 24 h (test clock).
- **Versioning:**
  - the original rows are byte-for-byte unchanged after amendments;
  - the sequence is 1, 2, 3;
  - the current values are correct;
  - old values match the previous version, including the chain of two amendments to the same item;
  - DB triggers refuse UPDATE/DELETE of amendments, changes and completed rows.
- **Concurrency:**
  - two simultaneous amendments → exactly one succeeds, the other gets 409;
  - a retry with the same `clientOperationId` returns the first amendment;
  - a stale `expectedSequence` gets 409.
- **Audit:** one audit row per amendment, review and denial; no health values in the audit.
- **Review flags:**
  - significant changes are PENDING;
  - notes-only changes are NOT_REQUIRED;
  - a review marks REVIEWED once;
  - a second review → 409.
- **Referral flags:** a referral linked to the session gets a PENDING reassessment flag; the
  referral row is unchanged.
- **Encryption:** the reason and text values are stored as `enc1:` only.

## 9. Implementation notes (6G-1)

- The proposed unique key on `ScreeningAmendmentChange` was **not** created: PostgreSQL treats
  NULL columns as distinct, so it would not prevent duplicates. "One change per item per amendment"
  is enforced by the service (422 `DUPLICATE_CHANGE`, tested).
- Two rules beyond the proposal: changes and referral flags can only be inserted in the same
  transaction as their amendment, and an amendment can never be inserted as REVIEWED.
- The 7-day limit is exclusive: at exactly 7 × 24 h after completion the conductor is refused
  (tested 1 second before and at the limit).
- Amending a measurement that has an in-session correction is refused: amend the latest value.
- The "current version" is computed by one function (`amendmentOverlay.ts`), used both to show
  values and to capture old values, so the two can never disagree.
