# Referral workflow (Step 7)

> Status: creation, approval, facility assignment, issue, cancellation, history and amendment
> reassessment implemented in stage 7C; tracking after issue (acknowledgement, appointment, visit,
> closure, corrections) follows in 7D; screens in 7F. Decisions J-N in [architecture.md](architecture.md).

**Emergencies:** the app never stands between a child and emergency care. Referral screens show
a fixed notice to follow official emergency protocols (wording pending programme approval).

## 1. Where referrals come from

| Origin | Created by | Starts as |
|---|---|---|
| `CLINICAL_REVIEW` | Medical officer's RECOMMEND_REFERRAL decision | APPROVED |
| `RULE_RECOMMENDATION` | Worker, only when the **current** result of that screening and category recommends a referral | PENDING_APPROVAL |
| `WORKER_CONCERN` | Worker (observed or guardian-reported concern, or other with a note) | PENDING_APPROVAL |

Never from an AI output (no AI is involved in Step 7). The screening, if given, must be a
COMPLETED screening of the same child. Priority (`ROUTINE` / `PRIORITY` / `URGENT`) is a label
only: the worker suggests it, the approver sets it; no timers or criteria are invented.

## 2. Lifecycle (7C part)

`PENDING_APPROVAL -> APPROVED -> ISSUED`, with `REJECTED` and `CANCELLED`. The full state machine
(also enforced by a database trigger) is in architecture.md section 6.

| Action | Who (over the child's current area) | Rules |
|---|---|---|
| Create `POST /referrals` | `referral.create` | Retry-safe (`clientOperationId`); one active referral per child + screening + category (409 `REFERRAL_ALREADY_ACTIVE` with the existing id) |
| Approve `POST /:id/approve` | `referral.approve` | Sets the priority; may set the facility |
| Reject `POST /:id/reject` | `referral.approve` | Reason required; final |
| Facility `PATCH /:id/facility` | creator or approver while pending; approver once approved | Logged as a history event and audit `referral.facility_assigned` |
| Issue `POST /:id/issue` | creator, `referral.update` or `referral.approve` | Facility required and still active, verified and accepting; **REFERRAL_DATA_SHARING consent verified now** and recorded |
| Cancel `POST /:id/cancel` | before issue: creator or MO/supervisor; after issue: MO/supervisor only | Reason required |
| Reassess `POST /:id/reassessments/:impactId` | `referral.approve` or `screening.review` | Confirms a referral after its screening was amended (Step 6G flags); once |

Every action: 404 + audit outside scope; 403 + audit `referral.action_denied` when not allowed;
409 `INVALID_REFERRAL_STATE` in the wrong state; 409 `VERSION_CONFLICT` on a stale
`expectedVersion`. Status event, referral update and audit are one transaction.

The API answers `actions: { approve, reject, changeFacility, issue, cancel, reassess }` with each
referral, decided by the server; the app shows only those.

## 2a. Tracking after issue (stage 7D)

No facility staff accounts exist (decision O). Medical officers and supervisors enter what they
learn, with its source:

| Source | Recorded as |
|---|---|
| `FACILITY_PHONE_CALL`, `FACILITY_DOCUMENT_SEEN` | VERIFIED (information from the facility) |
| `GUARDIAN_REPORTED` | UNVERIFIED - shown as "reported by the family, not verified" |

The server decides the verification from the source; the client cannot send it.
`POST /referrals/:id/tracking` `{ expectedVersion, toStatus, source, effectiveAt?, appointmentAt?, note? }`
moves along the state machine only (ACKNOWLEDGED; APPOINTMENT_SCHEDULED with the appointment time,
repeatable to reschedule; VISITED; VISIT_NOT_COMPLETED; UNDER_TREATMENT; FOLLOW_UP_REQUIRED).
`effectiveAt` = when it happened per the source; not in the future, not before the issue. A
recorded visit never implies treatment.

**Close** (`POST /:id/close`, reason required): only from VISITED, UNDER_TREATMENT,
FOLLOW_UP_REQUIRED or VISIT_NOT_COMPLETED, and only when no follow-up of the referral is open
(409 `OPEN_FOLLOW_UPS`). Completing a follow-up never closes a referral.

**Correction** (`POST /:id/corrections` `{ expectedVersion, eventId, reason }`): reverts only the
latest tracking update after issue; the mistaken event stays in the history and the new correction
event points to it; a correction cannot be corrected. Corrected events are not counted in
dashboards. Limitation: the appointment time is not reverted by a correction.

## 3. Consent and data sharing (decision M)

At issue, `assertConsentPermits(..., 'REFERRAL_SHARING')` requires a granted, not withdrawn
`REFERRAL_DATA_SHARING` consent of the child. Missing or withdrawn: 403 `CONSENT_REQUIRED` with the
blocking purpose, audited as `consent.check_denied`. On success the consent id and time are stored
on the referral and in the audit record (`consentVerified: true`). Screening consent is **not**
treated as sharing consent. No exception is implemented. If the consent is withdrawn after issue,
the referral shows `consentWithdrawnAfterIssue: true` (flagged for legal review: what may still be
recorded afterwards).

## 4. What a referral stores

References, not copies: child, screening, category result, review, facility, consent. Free text
(reason note, out-of-district reason, event reasons and notes) is encrypted and bound to its record.
History events record actor, role, time, source (`APP_USER_DIRECT` in 7C), verification status,
facility, reason and note.
