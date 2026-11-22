# Screening API (Step 6)

> Status: Stage 6B (2026-11-22). Only the read-only protocol endpoints and eligibility exist.
> Session, category, response and measurement endpoints arrive in stage 6C and are **not**
> implemented yet. Contracts: `packages/shared-contracts/src/screening.ts`.

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
