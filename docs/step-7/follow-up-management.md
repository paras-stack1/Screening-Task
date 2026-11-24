# Follow-up management (Step 7)

> Status: backend implemented in stage 7D; screens follow in 7F. Decisions Q, R and S in
> [architecture.md](architecture.md).

## 1. When a follow-up exists

- A medical officer requests additional screening (review decision; created automatically).
- A worker, supervisor or medical officer creates one: referral not completed, facility asked for
  another visit, clinician-requested assessment, protocol reassessment
  (`FOLLOW_UP_REASON_CODES` - workflow labels, not clinical classifications).

One open task per child + referral + reason (database rule); a second one is refused (409
`FOLLOW_UP_ALREADY_ACTIVE`). Retries with the same `clientOperationId` return the first task.

## 2. States and who may act

`PENDING` (unassigned) -> `ASSIGNED` -> `IN_PROGRESS` -> `COMPLETED`; also `MISSED` and
`CANCELLED`. Rescheduling is an **event** with a reason and the old/new due date; a MISSED task
goes back to ASSIGNED when rescheduled.

| Action | Who (over the child's current area) |
|---|---|
| Create | `referral.create` (field worker: the task is assigned to themself) or `referral.update` |
| Assign / reassign | `referral.update` (supervisor, medical officer); assignee must hold `follow_up.update` over the child's area; reassigning needs a reason |
| Start | the assignee |
| Complete (outcome note required) | the assignee or `referral.update` |
| Reschedule, mark missed (reason required) | the assignee or `referral.update` |
| Cancel (reason required) | `referral.update` |

Denied actions: 403 `FOLLOW_UP_ACTION_NOT_ALLOWED`, audited. Wrong state: 409. Stale version: 409.

**Overdue** is computed (due date before today, India time, still open) - never stored. **Missed**
is a human decision with a reason. **Completing a follow-up never changes or closes a referral**;
closing a referral requires that none of its follow-ups is still open (including MISSED).

Due dates: from today up to one year ahead (assumption). Free text (reason, next action, outcome,
event reasons) is encrypted.

## 3. Reminders

In-app only (decision S). `npm run jobs:reminders` (schedule every ~30 minutes):
- `FOLLOW_UP_DUE_SOON` to the assignee for tasks due today or tomorrow;
- `FOLLOW_UP_OVERDUE` to the assignee for tasks past their due date;
- catch-up of `REVIEW_TASK_NEW` for pending reviews;
- `REVIEW_OVERDUE` only when `REVIEW_OVERDUE_HOURS` is set (off by default - no time limit has
  been agreed).

Each reminder has a dedupe key (task + due date), so repeated runs never duplicate.

## 4. API

`GET /follow-ups?assigned=mine|any|unassigned&status=&overdue=&childId=&referralId=`,
`POST /follow-ups`, `GET /follow-ups/:id` (with history and allowed actions),
`POST /follow-ups/:id/{assign,start,complete,reschedule,miss,cancel}`.
