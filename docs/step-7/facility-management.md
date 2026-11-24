# Facility management (Step 7)

> Status: database rules (7B) and the read API for choosing a referral destination (7C) are
> implemented. Creating, editing, verifying and deactivating facilities comes with the admin portal
> in stage 7G. Decision P in [architecture.md](architecture.md).

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

## 3. Needed from the programme

The facility list with official codes and verified services; confirmation of the district rule;
who verifies facilities.
