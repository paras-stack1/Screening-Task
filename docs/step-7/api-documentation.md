# Step 7 API (results, review, referrals, follow-ups, notifications, dashboards)

> All routes are under `/api/v1`, need a valid access token (401 otherwise), and follow the
> existing conventions: strict Zod bodies (unknown fields -> 400), `{ error: { code, message } }`,
> 404 + DENIED audit for records outside the caller's area scope, 409 for stale `expectedVersion`
> and wrong states, fixed sort orders (no client-supplied sort field), page size <= 50.
> Request/response shapes: `packages/shared-contracts/src/{clinicalRules,results,referrals,followUps}.ts`.

## Routes

| Route | Permission (route filter) | Stage | Doc |
|---|---|---|---|
| `GET /screenings/:id/results` | child.read | 7B | result-generation-architecture.md |
| `POST /screenings/:id/generate-result` | screening.conduct or screening.review | 7B | " |
| `GET /screening-results`, `/:id` | child.read | 7B | " |
| `GET /clinical-rule-sets`, `/:id` | screening.review | 7B | clinical-rule-governance.md |
| `GET /clinical-reviews`, `/:id`; `POST /:id/{claim,release,decision}` | screening.review | 7C | clinical-review-workflow.md |
| `GET /referrals`, `POST /referrals`, `GET /:id`, `GET /:id/history` | child.read / referral.create | 7C | referral-workflow.md |
| `POST /referrals/:id/{approve,reject}` | referral.approve | 7C | " |
| `PATCH /referrals/:id/facility`; `POST /:id/{issue,cancel}` | referral.create/approve/update | 7C | " |
| `POST /referrals/:id/reassessments/:impactId` | referral.approve or screening.review | 7C | " |
| `POST /referrals/:id/{tracking,close,corrections}` | referral.update or referral.approve | 7D | " |
| `GET /facilities?childId=`, `GET /facilities/:id` | referral.* or facility.manage | 7C | facility-management.md |
| `POST /facilities`, `PATCH /facilities/:id`, `POST /facilities/:id/{verify,unverify,deactivate,reactivate}` | facility.manage | 7G | facility-management.md |
| `GET /follow-ups`, `POST /follow-ups`, `GET /:id`, `POST /:id/{assign,start,complete,reschedule,miss,cancel}` | see follow-up-management.md | 7D | follow-up-management.md |
| `GET /notifications`, `POST /notifications/:id/read` | own notifications only | 7D | below |
| `GET /dashboards/referrals`, `GET /dashboards/results` | child.read | 7D | below |
| `GET /reports/aggregate?areaId=&from=&to=` | report.aggregate | 7D | below |

Route names differ slightly from the brief's suggestions (e.g. one `/tracking` action instead of
separate `/acknowledge` and `/visits`; `/dashboards/*` instead of `/referral-dashboard/*`) to follow
the existing action-route convention; the behaviour is the same.

## Notifications

`{ id, type, entityType, entityId, createdAt, readAt }` - no names, no health details. The app
shows generic translated text per type and loads details through the normal checked API.
Sent after the change commits (a failure never undoes the change; the reminder job catches up).

| Type | To |
|---|---|
| `REVIEW_TASK_NEW` | medical officers over the child's area, when a result run is created |
| `ADDITIONAL_ASSESSMENT_REQUESTED` | the worker who conducted the screening |
| `REFERRAL_APPROVED` / `REJECTED` / `ISSUED` / `ACKNOWLEDGED` / `APPOINTMENT_SCHEDULED` / `STATUS_CHANGED` | the referral's creator (never the person who made the change) |
| `FOLLOW_UP_ASSIGNED` | the new assignee (not when assigning oneself) |
| `FOLLOW_UP_DUE_SOON` / `OVERDUE`, `REVIEW_OVERDUE` | reminder job (follow-up-management.md) |

## Metric definitions

Dashboards (`/dashboards/*`) count only records the caller may already read (child.read over the
child's current area). Reports (`/reports/aggregate`) count children of an area inside the
caller's report.aggregate scope and list no child.

| Metric | Definition |
|---|---|
| Referrals total | Referrals of children in scope, any status |
| Pending approval | Status PENDING_APPROVAL now |
| Issued | Referrals with an issue time (issued at least once, whatever happened next) |
| Acknowledged | Referrals with an ACKNOWLEDGED event that was not later corrected |
| Visit recorded | Referrals with a VISITED event that was not later corrected (verified or family-reported) |
| Closed | Status CLOSED now |
| Awaiting reassessment | Referrals with a pending amendment reassessment flag |
| Follow-ups open / overdue / missed | Open = PENDING, ASSIGNED, IN_PROGRESS; overdue = open and due before today (India); missed = status MISSED |
| Reviews open | Open reviews of current results (screening.review holders only; null for others) |
| Completed screenings | Screening sessions with status COMPLETED |
| Awaiting review / further / urgent / incomplete-or-undetermined / not interpreted | Current result runs by review status or overall outcome |
| Report counts (from-to, India dates) | Screenings completed, referrals created, issued, acknowledged (event in range), visits recorded (event in range), closed in range; overdue follow-ups = now |

Issued, acknowledged, visited and closed are never added together. **Small-cell suppression**
(reports only): counts 1-4 are returned as `{ value: null, suppressed: true }` (threshold 5 -
assumption pending the programme's privacy policy). Dashboards are not suppressed: they cover
records the caller can already open.
