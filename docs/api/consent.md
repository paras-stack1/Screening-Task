# Consent API (Step 5)

Base URL `/api/v1`. Authentication, error format, rate limits, safe retries (`clientOperationId`)
and the "404 for out-of-scope" rule are as in [children.md](children.md). Contracts:
`packages/shared-contracts/src/consent.ts`. Examples use synthetic data.

> **The notice wording is a PLACEHOLDER.** No approved legal/programme wording exists yet. Every
> notice is served with `isPlaceholder: true`, `approvalStatus: "DRAFT"` and a visible
> "[PLACEHOLDER - NOT APPROVED ...]" first line. **Production accepts only APPROVED notices**, so
> consent cannot be recorded in production until approved wording is added
> (`services/api/src/modules/consent/consentNotices.ts`, see its header for the procedure).

## Model

- **Purpose-specific.** Purposes: `SCREENING`, `PHOTO_CAPTURE`, `VIDEO_CAPTURE`, `AUDIO_CAPTURE`,
  `AI_PROCESSING`, `REFERRAL_DATA_SHARING`, `SMS_REMINDERS`. One record = one guardian's decision
  for one purpose. Nothing is bundled and no consent implies another.
- **Versioned.** Each record references the exact notice (purpose, version, language) shown; the
  database stores the SHA-256 of that wording, and the API refuses to serve or record against a
  notice whose text does not match its hash.
- **Append-only.** Records are never edited or deleted (database trigger). A withdrawal stamps
  `withdrawnAt`, `withdrawnBy`, `withdrawalMethod` (and an optional reason) on the granted record
  once. A new decision is a new record.
- **Status per purpose** (only `GRANTED` permits anything):

| Status | Meaning |
|---|---|
| `NOT_RECORDED` | No decision recorded. **Not permission.** |
| `GRANTED` | The latest decision is a grant that is still valid. |
| `REFUSED` | The latest decision is a refusal. |
| `WITHDRAWN` | The latest decision was a grant that has been withdrawn. |
| `NOT_VALID` | The latest grant no longer counts. `reason`: `GUARDIAN_NO_LONGER_LINKED`, `GUARDIAN_NOT_AUTHORISED` (consent authority removed), `NOTICE_RETIRED`, `NOTICE_NOT_APPROVED` (draft notice in production). |

  **Only the latest record counts** (by server `recordedAt`): a later refusal by any authorised
  guardian overrides an earlier grant, and a withdrawal never falls back to an older grant.
- **Who may decide.** The guardian must be currently linked to the child with
  `canGiveConsent: true`. That flag is the worker's declaration, **not** a legal verification of
  guardianship (open policy question). There is no "verified" status: the API never claims a
  consent is legally verified.

## `GET /consent-notices?language=hi[&purpose=PHOTO_CAPTURE]` (permission `consent.record`)

The current notice per purpose: the highest version that is APPROVED (or, outside production,
DRAFT) and not RETIRED.

```json
{ "items": [ { "templateId": "…", "purpose": "PHOTO_CAPTURE", "version": 1, "language": "hi",
  "title": "फ़ोटो", "body": "[अस्थायी पाठ - …]\n\n…", "optional": true,
  "isPlaceholder": true, "approvalStatus": "DRAFT" } ] }
```

`optional` is false only for `SCREENING` (programme participation). A purpose with no usable
notice is simply absent - the app must then not offer it.

## `GET /children/:childId/consents` (permission `child.read`)

Status for all seven purposes plus the full history (newest first, max 500). Audited
(`consent.history_viewed`). Supervisors with `child.read` may view; recording needs
`consent.record`.

```json
{ "statuses": [ { "purpose": "PHOTO_CAPTURE", "status": "WITHDRAWN", "reason": null,
    "permitted": false, "consentId": "…", "guardianName": "Synthetic Mother",
    "recordedAt": "2026-11-21T09:00:01.000Z" } ],
  "history": [ { "id": "…", "purpose": "PHOTO_CAPTURE", "decision": "GRANTED",
    "method": "SIGNATURE", "noticeVersion": 1, "noticeLanguage": "hi", "noticeWasPlaceholder": true,
    "evidenceReference": "FORM-0001", "guardianId": "…", "guardianName": "Synthetic Mother",
    "recordedAt": "…", "recordedByName": "Synthetic ASHA", "withdrawnAt": "…",
    "withdrawnByName": "Synthetic ASHA", "withdrawalMethod": "VERBAL_WITNESSED",
    "withdrawalReason": null } ] }
```

## `POST /children/:childId/consents` (permission `consent.record`) → 201

```json
{ "clientOperationId": "…", "guardianId": "…", "purpose": "PHOTO_CAPTURE",
  "decision": "GRANTED", "method": "SIGNATURE", "templateId": "…",
  "evidenceReference": "FORM-0001" }
```

- `decision` is required (`GRANTED` or `REFUSED`) - there is no default.
- `method` from the illustrative list `VERBAL_WITNESSED`, `SIGNATURE`, `THUMB_IMPRESSION`,
  `DIGITAL_ACKNOWLEDGEMENT` (decision D7 open). Recording a method does **not** prove that it
  satisfies legal requirements.
- `evidenceReference`: optional paper-form number (max 64 chars, no personal data). No images,
  signatures or identity documents are stored.
- Time and actor come from the server. Decisions for one (child, purpose) are serialised.

Errors: 422 `GUARDIAN_NOT_LINKED` / `GUARDIAN_NOT_AUTHORISED` (audited `consent.record_denied`),
422 `NOTICE_MISMATCH` (notice of another purpose or unknown), 409 `NOTICE_OUTDATED` (a newer
version exists - show it again), 409 `NOTICE_NOT_APPROVED` (draft notice in production), 503
`CONSENT_NOTICE_UNAVAILABLE` (stored hash does not match the wording - investigate).

Response: `{ "consent": ConsentRecord, "status": ConsentPurposeStatus }`.

## `POST /children/:childId/consents/:consentId/withdraw` (permission `consent.record`)

```json
{ "guardianId": "…", "method": "VERBAL_WITNESSED", "reason": "optional, no personal data" }
```

- The consent must belong to this child (otherwise 404, audited `consent.access_denied`).
- Any currently linked guardian with consent authority may withdraw (decision N); both the
  requesting and the original guardian are in the audit event.
- Only the **current** grant of its purpose: 409 `NOT_CURRENT_CONSENT` (a newer decision exists),
  `NOT_WITHDRAWABLE` (a refusal), `ALREADY_WITHDRAWN` (also for a simultaneous second request).
- Other purposes are not affected. The reason text is stored on the record but never copied into
  the audit log.
- **Stored media** made under a withdrawn consent: handling follows the retention policy, which is
  not yet decided (D8). No media exists in Step 5.

## Backend enforcement for later steps

`assertConsentPermits(db, ctx, childId, activity, permission, policy)` in
`services/api/src/modules/consent/consentPolicy.ts` is the only place that decides whether an
activity may happen. It checks child access with the activity's permission, then every required
purpose, and throws 403 `CONSENT_REQUIRED` (audited `consent.check_denied`) with the blocking
purposes. It returns the authorising consent ids (to store on media / AI records).

| Activity | Required purposes (**assumption - programme/legal confirmation needed**) |
|---|---|
| `SCREENING` | SCREENING |
| `PHOTO_CAPTURE` / `VIDEO_CAPTURE` / `AUDIO_CAPTURE` | SCREENING + that capture purpose |
| `AI_IMAGE_ANALYSIS` / `AI_VIDEO_ANALYSIS` / `AI_AUDIO_ANALYSIS` | SCREENING + the capture purpose + AI_PROCESSING |
| `REFERRAL_SHARING` | REFERRAL_DATA_SHARING |
| `SMS_REMINDER` | SMS_REMINDERS |

Future screening, media and AI endpoints must call it **at the point of use, inside their
transaction** - never rely on a check made earlier by the app.

## Audit events

`consent.granted`, `consent.refused`, `consent.withdrawn`, `consent.record_denied`,
`consent.withdraw_denied`, `consent.check_denied`, `consent.history_viewed`,
`consent.access_denied`. Details hold ids, purpose, method and notice version only.

## Open decisions (legal / programme)

1. Approved notice wording in Hindi and English, and who approves it (currently placeholders).
2. Accepted consent methods and the evidence each needs (D7).
3. Who may legally give consent, and how guardianship authority is verified.
4. Whether screening participation is a prerequisite for media capture (assumed yes).
5. Whether notice changes require renewed consent (currently: only if the old version is RETIRED).
6. Consent expiry (not modelled; no `EXPIRED` status).
7. Handling of stored media after withdrawal (retention, D8).
8. How two guardians' conflicting decisions are resolved (currently: the latest decision wins).
