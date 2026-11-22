# Screening API (Step 6)

> Status: Stage 6C (2026-11-22). Protocol and eligibility endpoints (6B) and the screening
> session API (6C) are implemented and tested. Contracts: `packages/shared-contracts/src/screening.ts`.
> No endpoint produces a diagnosis, classification or referral recommendation.

All routes: access token required (401 otherwise), shared per-user child-data rate limit, `Cache-Control: no-store`, standard error envelope `{ error: { code, message, details?, requestId } }`.
Unknown query fields are rejected (400).

## GET /api/v1/screening-protocols

Protocols **usable today**: ACTIVE with a reached `effectiveFrom`; also DRAFT outside production.

- Permission: `screening.conduct` **or** `child.read` (403 otherwise, audited `authz.denied`).
- Query: `category` (optional, one of `DEFECTS_AT_BIRTH`, `DEFICIENCIES`, `DISEASES`,
  `DEVELOPMENTAL_DELAYS_DISABILITIES`).
- 200: `{ items: ScreeningProtocolSummary[] }`.

```json
{
  "items": [
    {
      "id": "5f0e…",
      "code": "DEMO_D2",
      "version": 1,
      "category": "DEFICIENCIES",
      "name": { "hi": "प्रदर्शन - कमियाँ (चिकित्सकीय रूप से स्वीकृत नहीं)", "en": "Demonstration - Deficiencies (not clinically approved)" },
      "description": { "hi": "…", "en": "Placeholder content for testing the app. Not for use with children." },
      "ageMinDays": 0,
      "ageMaxDays": 6954,
      "sourceReference": "NONE - engineering demonstration content; not based on any clinical guideline",
      "status": "DRAFT",
      "isDemonstration": true,
      "isClinicallyApproved": false,
      "approvalReference": null,
      "clinicalApprovedAt": null,
      "effectiveFrom": null,
      "retiredAt": null,
      "questionCount": 3
    }
  ]
}
```

`isClinicallyApproved` is true only for ACTIVE, non-demonstration content. The app must show a
warning whenever it is false.

## GET /api/v1/screening-protocols/:id

One protocol version with its validated questions (`{ protocol: ScreeningProtocolDetail }`), in
display order. Question fields: `id, code, sectionCode, sortOrder, prompt {hi,en}, help, answerType,
options [{code, label {hi,en}}] | null, validation {min,max,maxDecimals,unit,maxLength} | null,
isRequired`. `contentSha256` is null for drafts.

- Visible: any status outside production. In production, only APPROVED / ACTIVE / RETIRED (retired
  versions stay readable for history); drafts → 404.
- 400 for a malformed id, 404 for unknown or hidden ids.

## GET /api/v1/screening-protocols/:id/versions

All visible versions of the same protocol `code`, newest first: `{ items: ScreeningProtocolSummary[] }`.

## GET /api/v1/children/:childId/screening-eligibility

Whether a screening can start for this child today, and with which protocols. Everything is
computed by the server; the app only displays it.

- Permission: `screening.conduct` (403). The child must be in the caller's area scope;
  otherwise 404, the same as a non-existent child, audited `child.access_denied`.
- 200:

```json
{
  "childId": "…",
  "screeningDate": "2026-11-21",
  "dateOfBirth": "2016-03-10",
  "dobIsEstimated": false,
  "ageInDays": 3908,
  "age": { "years": 10, "months": 8 },
  "consent": { "purpose": "SCREENING", "status": "GRANTED", "permitted": true, "reason": null, "consentId": "…", "guardianName": "…", "recordedAt": "…" },
  "openSessionId": null,
  "categories": [
    { "category": "DEFECTS_AT_BIRTH", "available": true, "reason": null, "protocol": { "code": "DEMO_D1", "…": "…" } },
    { "category": "DEFICIENCIES", "available": false, "reason": "AMBIGUOUS_PROTOCOL", "protocol": null }
  ],
  "canStart": true,
  "blockers": [],
  "usesUnapprovedContent": true
}
```

| Blocker | Meaning | What the app should offer |
|---|---|---|
| `CONSENT_NOT_PERMITTED` | SCREENING consent missing, refused, withdrawn or no longer valid (see `consent.status`/`reason`) | The Step 5 consent screen |
| `AGE_NOT_DETERMINABLE` | Date of birth after today (India date) | Correct the child record |
| `NO_CATEGORY_AVAILABLE` | No usable protocol covers the age in any category | Nothing; content is not configured |
| `OPEN_SESSION_EXISTS` | A DRAFT / IN_PROGRESS session exists (`openSessionId`) | Resume that session |

Category `reason`: `NO_PROTOCOL_FOR_AGE` (nothing covers the age; there is no fallback) or
`AMBIGUOUS_PROTOCOL` (two different draft codes cover the age: a configuration error).

Eligibility is **advisory**: stage 6C re-checks consent, scope, age and the protocol inside the
transaction that starts the session.

---

# Screening sessions (stage 6C)

## Rules common to every session write

| Rule | Response when broken |
|---|---|
| Permission `screening.conduct` (route) | 403 `FORBIDDEN` (audited `authz.denied`) |
| Session's child in the caller's area scope | 404 `NOT_FOUND`, the same as non-existent (audited `screeningSession.access_denied`) |
| Only the worker who started the session may change it (decision L) | 403 `NOT_SESSION_OWNER` (audited `screening.write_denied`) |
| The session is still DRAFT / IN_PROGRESS | 409 `SESSION_FINAL` |
| `expectedVersion` equals the current `version` | 409 `VERSION_CONFLICT`, `details.currentVersion`: reload, never overwrite |
| SCREENING consent still permits screening (re-checked at every write; not for cancel) | 403 `CONSENT_REQUIRED` (audited `consent.check_denied`) |
| Request body strict: unknown fields (e.g. `conductedById`, `status`, `ageInDaysAtStart`, `recordedById`, `completedAt`) | 400 `VALIDATION_ERROR` |
| A database integrity rule the service did not catch | 409 `INTEGRITY_RULE_VIOLATION` (backstop) |

Each successful write runs in one transaction with the session row locked, bumps `version` by
one, writes audit rows with identifiers and counts only (never answers, values or notes), and
returns the full session (`{ session: ScreeningSessionDetail }`). A DRAFT session becomes
IN_PROGRESS with its first content.

Reads (`GET`) need `child.read` and the same area scope (decision M: supervisors can read
screening records; district/state administrators cannot).

## Endpoints

| Method and path | Purpose | Success |
|---|---|---|
| `POST /screenings` `{ clientOperationId, childId }` | Start a session (DRAFT). Server derives worker, area, age (India date), DOB snapshot and the consent relied on. Idempotent on `clientOperationId` (repeat = 200 + `Idempotent-Replay: true`) | 201 |
| `GET /screenings?status&childId&mine=true&page&pageSize` | Sessions in scope, newest change first, max 50 per page | 200 `{ items, page, pageSize, total }` |
| `GET /screenings/summary` | The caller's own counts: `completedToday` (India date), `inProgress`, `drafts` | 200 |
| `GET /screenings/:id` | Full session: categories with protocol version, completeness and answers; measurements with correction history; categories not assessed | 200 |
| `POST /screenings/:id/categories` `{ expectedVersion, category }` | Start one Four-D category with the protocol that covers the age **at session start** | 201 |
| `POST /screenings/:id/categories/:category/responses` `{ expectedVersion, responses[], cleared[] }` | Save one section: upsert answers; `cleared` returns questions to "not answered" | 200 |
| `PATCH /screenings/:id/categories/:category` `{ expectedVersion, status?, notes? }` | Finish (`COMPLETED`) or reopen (`IN_PROGRESS`) a category; category notes | 200 |
| `POST /screenings/:id/measurements` `{ expectedVersion, type, value, unit, source, quality, measuredAt, method?, deviceMake?, deviceModel?, deviceSerial?, notes? }` | Add a measurement | 201 |
| `POST /screenings/:id/measurements/:measurementId/corrections` `{ ...same without type, correctionReason }` | Correct a measurement: a new row supersedes the old one | 201 |
| `POST /screenings/:id/complete` `{ expectedVersion }` | Complete. Idempotent: repeating returns the original `completedAt` (200 + `Idempotent-Replay`) | 200 |
| `POST /screenings/:id/cancel` `{ expectedVersion, reason }` | Cancel with a reason (no personal data). Allowed even after consent withdrawal | 200 |
| `GET /children/:childId/screenings?page&pageSize` | A child's history, newest first, including cancelled and completed sessions | 200 |

The session detail replaces the separate `GET .../categories`, `.../measurements` and
`.../observations` endpoints suggested in the brief: one request on slow networks, and no second
access path to secure.

## Starting

| Error | Meaning |
|---|---|
| 409 `OPEN_SESSION_EXISTS` (`details.sessionId`) | Resume that session; also the answer when two devices start at the same moment |
| 409 `IDEMPOTENCY_KEY_REUSED` | The same `clientOperationId` was used for a different request |
| 422 `AGE_NOT_DETERMINABLE` | Date of birth after today |
| 422 `NO_CATEGORY_AVAILABLE` | No usable protocol covers the child's age |

## Categories and answers

- `CATEGORY_ALREADY_STARTED` (409), `CATEGORY_NOT_STARTED` (409), `CATEGORY_NOT_AVAILABLE` (422,
  `details.reason` `NO_PROTOCOL_FOR_AGE` / `AMBIGUOUS_PROTOCOL`), `PROTOCOL_INTEGRITY_ERROR` (409:
  approved content no longer matches its reviewed hash; logged).
- Answer: `{ questionId, status, source, value?, notAssessedReason?, notes? }`.
  - `status`: `ANSWERED` (value required) | `UNKNOWN` | `NOT_ASSESSED` | `UNABLE_TO_ASSESS` (no value).
  - `source`: `WORKER_OBSERVED` | `GUARDIAN_REPORTED`.
  - `value` by answer type: YES_NO boolean; NUMBER finite number within the protocol's
    min/max/decimals; TEXT non-empty string within `maxLength` (default 1000); SINGLE_CHOICE an
    option code; MULTI_CHOICE unique option codes.
  - A wrong value is 422 `INVALID_RESPONSE` (`details.questionCode`); a question from another
    protocol version is 422 `QUESTION_NOT_IN_PROTOCOL`. A refused save stores nothing.
- An unanswered question has no record and is reported in `completeness.notAnswered`. It is never
  counted as "No".
- `COMPLETED` needs every required question in an explicit state, else 422
  `REQUIRED_QUESTIONS_MISSING` (`details.questionCodes`). Answers of a completed category are
  locked (409 `CATEGORY_COMPLETED`) until it is reopened.

## Measurements (decisions I, J)

- Types: `WEIGHT` (`kg`, `g`), `HEIGHT`, `LENGTH`, `MUAC`, `HEAD_CIRCUMFERENCE` (`cm`, `mm`).
  `HAEMOGLOBIN` is not offered.
- `value` is a decimal **string** (`"24.35"`): no sign, exponent, `NaN`, `Infinity` or JSON
  number (400). Stored exactly as entered with its unit. `converted` (kg / cm) is computed for
  display with exact decimal arithmetic.
- 422 codes:
  - `INVALID_UNIT`
  - `TOO_MANY_DECIMALS`: kg 2, g 0, cm 1, mm 0; never silently rounded
  - `IMPLAUSIBLE_VALUE`: outside physically possible limits (weight 0.2-250 kg, height/length
    20-250 cm, MUAC 3-60 cm, head 15-80 cm)
  - `MEASURED_IN_FUTURE`: more than 5 minutes ahead
  - `MEASURED_BEFORE_BIRTH`

  **ASSUMPTION - pending programme approval** (`MEASUREMENT_DATA_QUALITY_V1`). These are
  data-quality limits, **not** clinical thresholds; no classification is made.
- Corrections keep the original (`isCurrent: false`) and add a superseding row with a reason. A
  superseded row cannot be corrected again (409 `MEASUREMENT_ALREADY_CORRECTED`). A measurement id
  from another session is 404.

## Completion (decision N)

- Needs at least one COMPLETED category (else 422 `NO_COMPLETED_CATEGORY`). This also covers an
  empty session.
- Categories started but not finished stay `IN_PROGRESS` (shown as incomplete).
- Categories never started are listed in `categoriesNotAssessed`.
- `screeningRulesApplied` is always `false`: there are no approved rules, so no outcome or
  referral recommendation exists.
- Two simultaneous completions both get 200 with one completion time and one audit row.
