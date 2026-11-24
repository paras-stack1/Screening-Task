# Facility management (Step 7)

> Status: database rules (7B), the selection API (7C) and the administration API with admin portal
> pages (7G) are implemented. Decision P in [architecture.md](architecture.md).

## 1. Rules

- A facility is never claimed to accept referrals or offer services unless it is **verified**, with
  who verified it, when and a verification reference (database CHECK).
- An inactive facility cannot accept referrals; deactivation keeps the row and all referral history
  (facilities can never be deleted).
- Official code is unique; name + type + area is unique (case-insensitive) to catch duplicates.
- Every change increases the facility version (database rule); history is kept in
  `FacilityHistory` (append-only).
- State, district and block come from the area tree (`areaId`), never from duplicated text.
- No capacity, specialist availability or "nearest is best" logic exists.

## 2. Choosing a facility for a referral

`GET /facilities?childId=<id>[&type=][&q=][&includeOutOfDistrict=true]` - for `referral.create`,
`referral.approve` and `referral.update` holders who may act on that child (else 404 + audit).

Each item has `placement` and `selectable`:

- `IN_DISTRICT`: inside the child's district or above it (state level).
  `OUT_OF_DISTRICT`: anything else - hidden unless asked for, and only a medical officer may choose
  it, with a reason. **Assumption**, to be confirmed by the programme.
- `selectable`: active, verified and accepting referrals. Others are listed but cannot be chosen
  (422 `FACILITY_NOT_AVAILABLE`).

Order: in-district first, then selectable, then by name.

`GET /facilities` without a child is the directory for `facility.manage` holders (their area
scope); field workers must name the child (400). `GET /facilities/:id` returns one facility.

## 3. Administration (stage 7G)

Admin portal: **Facilities** (list, search) -> **Add facility** -> facility page (details, change
history, edit with reason, record verification, remove verification, deactivate / reactivate with
reason). Only `facility.manage` holders (district / state administrators) whose area scope covers
the facility's area; others see it read-only, or get 404 (audited) when they try to change it.

| Route | Body | Rule |
|---|---|---|
| `POST /facilities` | name, nameHi?, officialCode?, type, areaId, address?, contactPhone? | Always UNVERIFIED and not accepting referrals; area must be in scope |
| `PATCH /facilities/:id` | expectedVersion, changed fields, reason | Descriptive fields only; old/new values in the history |
| `POST /facilities/:id/verify` | expectedVersion, verificationReference, services[], acceptsReferrals | Records who, when and the reference; an inactive facility cannot accept referrals |
| `POST /facilities/:id/unverify` | expectedVersion, reason | Clears services and acceptance |
| `POST /facilities/:id/deactivate`, `/reactivate` | expectedVersion, reason | Deactivation stops referrals and keeps all history; reactivation does **not** restore acceptance (a new verification is needed) |
| `GET /facilities/:id` | - | Details, history, `canManage` |

Duplicates (same official code, or same name and type in the area) -> 409 `FACILITY_DUPLICATE`.
Assumption: verification is recorded by a `facility.manage` holder.

## 4. Needed from the programme

The facility list with official codes and verified services; confirmation of the district rule;
who verifies facilities.
