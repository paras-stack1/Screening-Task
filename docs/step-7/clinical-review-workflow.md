# Clinical review workflow (Step 7)

> Status: backend implemented in stage 7C; screens follow in 7E. Decisions G, H, I and K in
> [architecture.md](architecture.md).

## 1. Who

Only `screening.review` holders (MHT medical officers) whose area scope covers the child's
**current** area. Everyone else gets 403 (no permission) or 404 + a DENIED audit record (outside
scope; the same answer as "does not exist"). The reviewer is always the signed-in user; the API
refuses any reviewer id in the request (strict bodies, 400).

A medical officer may review a screening they conducted themself; the detail shows
`conductedByReviewer: true` (allowed, visible - no separate rule was agreed).

## 2. States

```
PENDING_REVIEW --claim--> UNDER_REVIEW --decide--> REVIEWED | REJECTED   (final)
      ^                       |                 \-> ESCALATED | ADDITIONAL_INFORMATION_REQUIRED
      +-------release---------+                          |
                                                         +--claim--> UNDER_REVIEW (decision cleared,
                                                                      kept in history)
```

| Decision | Resulting state | Also |
|---|---|---|
| `ACCEPT_RESULT` | REVIEWED | Notes optional |
| `RECOMMEND_REFERRAL` | REVIEWED | Creates an **APPROVED** referral (origin CLINICAL_REVIEW; the review is the approval). Needs `referral.approve` too, plus category and priority; facility optional (out-of-district needs a reason) |
| `REQUEST_ADDITIONAL_SCREENING` | ADDITIONAL_INFORMATION_REQUIRED | Creates a follow-up task (ADDITIONAL_SCREENING, due date today to one year ahead) |
| `ESCALATE_FOR_SPECIALIST_REVIEW` | ESCALATED | Another reviewer may claim it again |
| `REJECT_WITH_REASON` | REJECTED | The automated result is rejected (not the child) |

Notes are required for every decision except ACCEPT_RESULT, stored encrypted, shown only to
reviewers, and never written to audit records or notifications.

## 3. Safety rules

- One reviewer at a time: a review must be claimed before a decision; a claimed review answers
  409 `REVIEW_CLAIMED` to others; only the claimer may release or decide (409 `NOT_YOUR_REVIEW`).
- Every change carries `expectedVersion`; a stale write gets 409 `VERSION_CONFLICT` (the database
  also requires the version to increase by exactly one).
- The review of a screening version that was later amended cannot be claimed or decided
  (409 `RESULT_SUPERSEDED`); the queue shows reviews of current versions only.
- Decisions, created referrals and follow-ups, history events and audit records are written in
  one transaction. A duplicate active referral or follow-up rolls the whole decision back (409).
- The database enforces the state machine and that a decision matches its state.

## 4. API

| Route | Notes |
|---|---|
| `GET /clinical-reviews?status=&includeSuperseded=&page=&pageSize=` | Queue in scope, oldest first; default = open states |
| `GET /clinical-reviews/:id` | Review, full result (all four categories, rules, evidence), history with notes, linked referral and follow-up ids, `canClaim` / `canRelease` / `canDecide` |
| `POST /clinical-reviews/:id/claim` `{ expectedVersion }` | |
| `POST /clinical-reviews/:id/release` `{ expectedVersion }` | |
| `POST /clinical-reviews/:id/decision` `{ expectedVersion, decision, notes?, referral?, followUp? }` | |

The reviewer reads observations and measurements through the existing `GET /screenings/:id`.

## 5. Open points for the programme

- Which results need review (currently all - decision G) and a review time limit (none set).
- Whether a medical officer may review their own screening.
