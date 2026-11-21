# Children, guardians and guardian links API (Step 5)

Base URL: `/api/v1`. All endpoints require `Authorization: Bearer <access token>` (401 otherwise),
an ACTIVE account without a pending password change, and the route permission below (403
`FORBIDDEN`, audited as `authz.denied`). The route permission is only the coarse gate: **every
record is checked again against the caller's area scope** (`docs/authorization.md`). A record
outside the scope answers **404**, exactly like a record that does not exist, and the denial is
audited (`<entity>.access_denied`).

Contracts (Zod schemas and types) live in `packages/shared-contracts/src/children.ts`,
`guardians.ts` and `people.ts`. All request bodies and query strings are **strict**: unknown fields
(`createdById`, `areaId` on update, `deletedAt`, `status`, timestamps, ...) are rejected with 400.

Data used in examples is synthetic.

## Error format

```json
{ "error": { "code": "POSSIBLE_DUPLICATE", "message": "...", "details": { }, "requestId": "..." } }
```

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` (details: `[{ path, message }]`), `INVALID_JSON` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` (route permission), `AREA_NOT_ALLOWED` (registration area), `PASSWORD_CHANGE_REQUIRED` |
| 404 | `NOT_FOUND` (missing **or** out of scope) |
| 409 | `POSSIBLE_DUPLICATE`, `POSSIBLE_DUPLICATE_GUARDIAN`, `GUARDIAN_ALREADY_LINKED`, `LAST_GUARDIAN`, `STALE_RECORD`, `IDEMPOTENCY_KEY_REUSED`, `OPERATION_IN_PROGRESS`, `CONFLICT`, `TRANSACTION_CONFLICT` |
| 422 | `INVALID_DATE_OF_BIRTH`, `DATE_OF_BIRTH_IN_FUTURE`, `CHILD_AGE_OUT_OF_RANGE`, `INVALID_DATE` |
| 429 | `TOO_MANY_REQUESTS` - per user: 600 reads and 150 writes per 15 minutes across all child-data routes |
| 503 | `PHONE_STORAGE_UNAVAILABLE` (encryption keys not configured), `SERVICE_UNAVAILABLE` (database) |

## Rules that apply everywhere

- **Server-owned fields.** Creator, registration time, link creator, end actor and all timestamps
  come from the authenticated session and the server clock.
- **Dates of birth** are calendar dates `YYYY-MM-DD`. "Today" is the date in India (IST). A date
  must exist (no 30 February), must not be in the future, and the child must be at most 18
  completed years old (**assumption - programme to confirm**). If the date is unknown, send
  `ageEstimate: { years, months }`; the server derives a date and sets `dobIsEstimated: true`.
  Clients must show "about N years" for estimated dates, never the derived date as if exact.
- **Phone numbers** (optional) must be Indian mobiles; `98765 43210`, `+91-9876543210` and
  `09876543210` are all stored as `+919876543210`, encrypted (AES-256-GCM, bound to the guardian)
  with an HMAC lookup hash. They appear **in full only** in `GET /guardians/:id` (audited);
  everywhere else as `phoneMasked: "+91 ••••••3210"`.
- **Optimistic concurrency.** Updates send `expectedUpdatedAt` (the `updatedAt` last read). If
  someone changed the record since, the answer is 409 `STALE_RECORD`; reload and retry.
- **Safe retries.** Create requests carry a client-generated `clientOperationId` (UUID, new per
  submission). Re-sending the same request returns the first result with header
  `Idempotent-Replay: true`; the same id with a different body is 409 `IDEMPOTENCY_KEY_REUSED`.
- **Duplicates are never merged.** Possible duplicates produce a 409 with in-scope candidates only;
  the worker either picks the existing record or re-sends with the confirmation flag (audited).

## Children

### `GET /children` - list / search (permission `child.read`)

Query: `search` (2-50 chars, name contains), `areaId` (narrows within scope), `registeredFrom`,
`registeredTo` (India calendar dates, inclusive), `page` (1-10000), `pageSize` (1-50, default 20),
`sort` (`fullName`, `-fullName`, `dateOfBirth`, `-dateOfBirth`, `createdAt`, `-createdAt`).

`total` counts only children in the caller's scope.

```json
{ "items": [ { "id": "…", "fullName": "Synthetic Child", "dateOfBirth": "2022-05-17",
  "dobIsEstimated": false, "sexAtBirth": "FEMALE", "areaId": "…", "areaName": "Village A",
  "areaNameHi": "गाँव ए", "registeredAt": "2026-11-21T09:00:00.000Z" } ],
  "page": 1, "pageSize": 20, "total": 1 }
```

### `GET /children/registration-areas` - where the caller may register (permission `child.create`)

Active areas whose level allows registration, inside the caller's `child.create` scope; at most
200 (`truncated: true` means narrow with `search`).

### `POST /children` - register (permission `child.create`) → 201

```json
{
  "clientOperationId": "7d0c5f2e-…",
  "fullName": "Synthetic Child",
  "dateOfBirth": "2022-05-17",
  "sexAtBirth": "FEMALE",
  "areaId": "…",
  "guardians": [
    { "newGuardian": { "fullName": "Synthetic Mother", "phone": "9876543210", "preferredLanguage": "hi" },
      "relationship": "MOTHER", "isPrimaryContact": true, "canGiveConsent": true },
    { "existingGuardianId": "…", "relationship": "FATHER", "canGiveConsent": false }
  ],
  "confirmNotDuplicate": false
}
```

- Exactly one of `dateOfBirth` / `ageEstimate`. `sexAtBirth` optional (stored `NOT_RECORDED`).
- 1-4 guardians; each is either `existingGuardianId` (must be linked to a child the caller may
  register in, e.g. a sibling) or `newGuardian`. `canGiveConsent` is **required** (no default):
  it records the worker's declaration and is **not** a legal verification.
- At most one `isPrimaryContact`.
- `areaId` outside scope, unknown, inactive or not a registration level → 403 `AREA_NOT_ALLOWED`
  (one answer for all, audited `child.registration_denied`).
- Registration is one transaction: child, new guardians, links and audit events all succeed or
  none is written. Registrations in the same area are serialised (advisory lock) so two
  simultaneous submissions of one child cannot both pass the duplicate check.

**Duplicate warning** (409 `POSSIBLE_DUPLICATE`, audited `child.duplicate_warning`):

```json
{ "candidates": [ { "id": "…", "fullName": "Synthetic Child", "dateOfBirth": "2022-05-14",
  "dobIsEstimated": false, "areaName": "Village A", "areaNameHi": null,
  "reasons": ["SIMILAR_NAME_AND_BIRTH"] } ] }
```

Only children the caller can already read are checked and listed - matches in other areas are
never revealed, not even as "a match exists". Reasons: `SIMILAR_NAME_AND_BIRTH` (same registration
area, similar name, date of birth within 31 days, or a year if either date is estimated);
`SHARED_GUARDIAN` (linked to a chosen existing guardian or a guardian with the same phone, born
within 31 days - a duplicate or a twin). To proceed, resend with `confirmNotDuplicate: true`
(audited on `child.registered` as `duplicateOverride` with the candidate ids).

**Guardian warning** (409 `POSSIBLE_DUPLICATE_GUARDIAN`): a new guardian's phone matches an
in-scope guardian. Details: `{ guardianIndex, candidates: [{ guardianId, fullName, phoneMasked }] }`.
Use `existingGuardianId`, or set `confirmNewGuardian: true` on that guardian.

Response: `{ "child": ChildDetail }` (see below).

### `GET /children/:childId` - profile (permission `child.read`)

Audited (`child.viewed`).

```json
{ "child": { "…summary fields…": "…", "updatedAt": "…", "registeredByName": "Synthetic ASHA",
  "guardians": [ { "relationshipId": "…", "guardianId": "…", "fullName": "Synthetic Mother",
    "relationship": "MOTHER", "isPrimaryContact": true, "canGiveConsent": true,
    "phoneMasked": "+91 ••••••3210", "preferredLanguage": "hi",
    "linkedAt": "…", "endedAt": null } ] } }
```

### `PATCH /children/:childId` - correct details (permission `child.update`)

Body: `expectedUpdatedAt` (required) and any of `fullName`, `dateOfBirth` | `ageEstimate`,
`sexAtBirth`. The **area cannot be changed** here (a transfer workflow is a later step).
Audited `child.updated` with field names only. Response: `{ "child": ChildDetail }`.

## Guardian links

### `GET /children/:childId/guardians?includeEnded=false` (permission `child.read`)

Current links; with `includeEnded=true` also ended ones (history), current first.

### `POST /children/:childId/guardians` (permission `child.update`) → 201

Same link object as in registration plus `clientOperationId`. The child **and** an existing
guardian are checked independently (a guardian linked only to another area's child → 404). A
guardian whose earlier link to this same child was ended may be linked again (new row; history
kept). Already linked → 409 `GUARDIAN_ALREADY_LINKED`. Choosing a new primary contact clears the
previous one (audited). Response: `{ "link": GuardianLink }`.

### `PATCH /children/:childId/guardians/:relationshipId` (permission `child.update`)

Any of `relationship`, `isPrimaryContact`, `canGiveConsent`. The link must belong to that child
and be current (a link id of another child → 404, audited `childGuardian.access_denied`).
Audited `child_guardian.updated` with before/after values.

### `DELETE /children/:childId/guardians/:relationshipId` (permission `child.update`)

Body: `{ "reason": "Recorded by mistake" }` (3-200 chars, must not contain personal data; it is not
copied into the audit log). The link is **ended, not deleted**. The last current guardian cannot
be removed (409 `LAST_GUARDIAN` - add the correct guardian first). Response: `{ "link": … }` with
`endedAt`.

## Guardians

There is **no guardian list, search or create endpoint** (decision E): guardians are created with
a child and reached only through children the caller may access.

### `GET /guardians/:guardianId` (permission `child.read`)

Visible if linked (currently) to a child the caller may read. Returns the **full phone number**
(audited `guardian.viewed` with `phoneRevealed`) and **only the caller's accessible children** of
this guardian - other children of the household are never listed or counted.

### `PATCH /guardians/:guardianId` (permission `child.update`)

Body: `expectedUpdatedAt` and any of `fullName`, `phone` (`null` removes it), `preferredLanguage`.
Audited `guardian.updated` with field names only. A guardian shared with a child in another area
is updated for both (it is one person).

## Audit events (all in the same transaction as the change)

| Action | Details (never names, phone numbers or free text) |
|---|---|
| `child.registered` | guardianCount, dobIsEstimated, duplicateOverride + candidateIds |
| `child.duplicate_warning` | candidateIds |
| `child.registration_denied` | reason, areaId |
| `child.viewed`, `child.updated` | -, fields |
| `guardian.created`, `guardian.viewed`, `guardian.updated` | childId, hasPhone / phoneRevealed / fields |
| `child_guardian.linked`, `.updated`, `.ended` | childId, guardianId, relationship, flags / changes |
| `child.access_denied`, `guardian.access_denied`, `childGuardian.access_denied` | permission, recordExists |

## Open points (require programme / legal decision)

- Maximum registration age (18 completed years assumed).
- Sex-at-birth and relationship option lists (schema lists are illustrative).
- Who may legally give consent: `canGiveConsent` is a worker declaration only.
- Moving a child to another area (transfer workflow) and deleting/archiving records (retention, D8).
