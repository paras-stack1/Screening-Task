# Step 7 - Architecture and decisions (proposal)

> Phase 2 of Step 7. Status: **PROPOSED - waiting for approval of decisions A-X.**
> Builds on [initial-audit.md](initial-audit.md). Schema detail: [schema-change-proposal.md](schema-change-proposal.md).
> Nothing here is implemented yet.

## 1. Principles

1. **Four separate layers, never mixed** in data or on screen:
   1. *Recorded observation* - what the worker recorded (Step 6 rows, unchanged).
   2. *Automated screening interpretation* - output of an ACTIVE, approved rule set (or "not
      interpreted" when none exists).
   3. *Clinician-reviewed assessment* - a medical officer's review decision.
   4. *Confirmed diagnosis* - **not recorded anywhere in Step 7.** Screens say so explicitly.
2. **No invented medicine.** The software ships a rule *engine*; it ships no clinical rule,
   threshold, priority definition or escalation timer. Demonstration rule sets exist only outside
   production, are labelled, and can never be approved (same guard as Step 6 protocols).
3. **Missing is never reassuring.** Unanswered, `UNKNOWN`, `NOT_ASSESSED`, incomplete category or
   missing measurement can only lead to `INCOMPLETE` / `UNABLE_TO_DETERMINE` / `NOT_ASSESSED`,
   never to "no concern".
4. **History is append-only.** Results, review events, referral status events, follow-up events,
   facility history and rule-set events are never updated or deleted (database triggers).
5. **The server decides.** Actor, role, area scope, status, consent outcome, rule outcome and
   facility verification are derived on the server; the client sends intent only.
6. **Emergency care is never gated by the app.** Every referral screen shows a fixed notice to
   follow official emergency protocols.

## 2. Flow

```
Completed screening (Step 6, version n)
   │  same transaction as completion / amendment
   ▼
ScreeningResultRun (session level, version n)  ──►  ScreeningResult × 4 (one per Four-D category)
   │  rule set used per category (ACTIVE) or none -> NOT_INTERPRETED
   ▼
ClinicalReview (PENDING_REVIEW)  ── MO claims ──► UNDER_REVIEW ──► decision
   │                                   ├─ ACCEPT_RESULT ─────────────► REVIEWED
   │                                   ├─ REQUEST_ADDITIONAL_SCREENING ► ADDITIONAL_INFORMATION_REQUIRED (+ follow-up task)
   │                                   ├─ RECOMMEND_REFERRAL ─────────► REVIEWED (+ referral, APPROVED)
   │                                   ├─ ESCALATE_FOR_SPECIALIST_REVIEW ► ESCALATED
   │                                   └─ REJECT_WITH_REASON ──────────► REJECTED
   ▼
Referral ── PENDING_APPROVAL ─► APPROVED ─► ISSUED (consent + verified facility) ─► tracking ─► CLOSED
   │
   ▼
FollowUp tasks (assigned worker, due date, history)      Notifications (in-app, ids only)
```

## 3. Components (backend, `services/api/src/modules`)

| Module | Contents |
|---|---|
| `clinical-rules/` | Rule DSL schema (Zod), deterministic evaluator (pure functions), rule-set lifecycle, CLI `db:rule-set-import`, `db:rule-set-status`, demonstration rule sets, read API |
| `screening/results.*` | Result generation (called from `complete` and from amendments), result read API, backfill endpoint |
| `clinical-review/` | Review queue, claim, decision, history |
| `referrals/` | Referral create/approve/reject/issue/cancel, tracking updates, correction, history, state machine, consent check, amendment reassessment |
| `facilities/` | Directory read (for referral), admin create/update/verify/deactivate, history |
| `follow-ups/` | Create, assign/reassign, start, complete, reschedule, miss, cancel, history |
| `notifications/` | My notifications list, mark read; `notify()` helper used by other modules; reminder job script `jobs:reminders` |
| `reports/` | Scoped dashboard counts (worker app) and aggregate reports with suppression (admin portal) |

Evaluator design: `evaluate(ruleSet, input) -> { outcome, firedRules[], evidence[], limitations[] }`
is a pure function of (rule-set definition, current screening version, child age in days). Same
input gives the same output; covered by table tests. It refuses input it does not understand
(unknown question code, wrong unit, age outside the band) with `UNABLE_TO_DETERMINE` and a listed
limitation - it never guesses.

## 4. Frontend placement

| Area | App | Users |
|---|---|---|
| Results (per screening, Four-D view, history) | Worker app | child.read holders |
| Clinical review (queue, detail, decision, history) - extends the 6G-2 review queue | Worker app | MHT_MEDICAL_OFFICER |
| Referrals (dashboard, create, detail, approval, timeline, facility selection/detail) | Worker app | workers, MO, supervisor |
| Follow-ups (dashboard, detail, complete, reschedule, history) | Worker app | workers, MO, supervisor |
| Notifications tab (replaces the Step 4 placeholder) | Worker app | everyone |
| Facility administration (list, detail, add, edit, verify, deactivate) | **Admin portal** | DISTRICT_ADMIN, STATE_ADMIN |
| District / block aggregate reports | **Admin portal** | report.aggregate holders |

## 5. Decisions needed

Recommended option first. "Assumption" = engineering placeholder that the programme must confirm.

| # | Topic | Recommendation | Alternatives |
|---|---|---|---|
| **A** | Branch and 6G-2 | Review and commit 6G-2 first; start Step 7 on `feat/step-7-referrals` from it; commit these docs there | Build Step 7 on top of uncommitted 6G-2 (mixes reviews) |
| **B** | Rule representation | Versioned **rule sets as data**: a JSON rule definition validated by a Zod DSL, frozen by SHA-256 when it leaves DRAFT, lifecycle reuses `ProtocolStatus` (DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> RETIRED). Managed through CLI scripts (import + status change, with approver login and approval reference) like Step 6 protocols. **No in-app rule editor** in Step 7 | Rules as TypeScript code (needs a deploy per change, harder to audit); admin-portal editor (larger attack surface, later) |
| **C** | No approved rules exist | Ship the framework plus **demonstration** rule sets (`isDemonstration`, cannot be approved, usable only outside production, labelled on every screen). In production every result is `NOT_INTERPRETED` until an approved set is ACTIVE | No demo rules at all (engine untestable end-to-end in the app) |
| **D** | DSL scope | Conditions on answer codes/states of the protocol's questions, presence/quality of measurements, and comparisons of a measurement to a number written **in the rule set** (with its reference). No growth-standard / z-score tables until the clinical team supplies them | Build WHO growth-standard lookups now (would mean choosing tables ourselves) |
| **E** | Result outcomes | Per category: `NO_CONCERN_IN_COMPLETED_ITEMS`, `FURTHER_EVALUATION_RECOMMENDED`, `URGENT_EVALUATION_RECOMMENDED`, `INCOMPLETE`, `NOT_ASSESSED`, `UNABLE_TO_DETERMINE`, `NOT_INTERPRETED`. Session level = the most cautious category outcome. "Pending clinical review" is a **review status**, not an outcome. "No concern **in completed items**" wording kept (not "no concern identified") | Prompt's list verbatim (mixes outcome and review status) |
| **F** | When results are generated | Automatically, in the same transaction as screening completion and as each amendment (one result run per screening version). Plus an idempotent `POST /screenings/:id/generate-result` for sessions completed before Step 7 (2 in dev). A later rule-set change **does not** reinterpret old screenings | Manual generation only (completed screenings could lack results) |
| **G** | Which results need review | **Every** result run gets a review task until the programme defines a narrower policy (policy kept as configuration) | Only non-"no concern" results (would skip all `NOT_INTERPRETED` today anyway) |
| **H** | Review granularity and visibility | One review per result run (whole screening). An MO **claims** it (UNDER_REVIEW, one reviewer at a time, `version` for concurrency). Notes required for every decision except ACCEPT_RESULT; notes encrypted. Workers see the review status and decision label, **not** the notes | Per-category reviews (4× the work for MOs); notes visible to workers |
| **I** | Who reviews | `screening.review` holders (MHT_MEDICAL_OFFICER) whose scope covers the child's current area - the same rule as amendment review | New reviewer role |
| **J** | Referral statuses | `PENDING_APPROVAL, APPROVED, REJECTED, ISSUED, ACKNOWLEDGED, APPOINTMENT_SCHEDULED, VISITED, VISIT_NOT_COMPLETED, UNDER_TREATMENT, FOLLOW_UP_REQUIRED, CLOSED, CANCELLED` (matrix in section 6). No stored DRAFT (creation is online and immediate). Corrections: an MO or supervisor may revert **only the latest** tracking event, with a reason, recorded as a new correction event | Keep a DRAFT status; allow free backward moves |
| **K** | Origins and approval | Origins: `CLINICAL_REVIEW`, `RULE_RECOMMENDATION`, `WORKER_CONCERN`. A referral from an MO's RECOMMEND_REFERRAL decision starts **APPROVED** (the review is the approval). All others start PENDING_APPROVAL and need a holder of the new permission **`referral.approve`** (MHT_MEDICAL_OFFICER only). The creator may suggest a priority; the approver sets it. Priorities are labels only - no criteria or timers | Allow workers to issue without approval; give supervisors approval rights |
| **L** | Facility timing | Facility optional at creation, **required at ISSUE**; the approver may change it (logged). Only ACTIVE + VERIFIED facilities that accept referrals can be chosen | Facility required at creation (current schema) |
| **M** | Consent | `REFERRAL_DATA_SHARING` checked with `assertConsentPermits` at **ISSUE** (the moment data leaves the programme) and recorded on the referral (consent id, time). Missing/withdrawn -> 403 `CONSENT_REQUIRED`; the screen tells the worker to follow emergency protocols if urgent. No exceptions are implemented. Withdrawal **after** issue: the referral stays, is flagged "consent withdrawn", no further sharing; tracking information received may still be recorded (**flagged for legal review**) | Check at creation too (blocks internal review workflow); invent a programme exception (not allowed) |
| **N** | Duplicates | `clientOperationId` for retries **and** a partial unique index: one active (not REJECTED/CLOSED/CANCELLED) referral per child + screening + category (child + category when not from a screening). A second one returns 409 `REFERRAL_ALREADY_ACTIVE` with the existing id | Service check only (race-prone) |
| **O** | Facility staff | **No facility staff accounts in Step 7.** Tracking updates are entered by `referral.update` holders (MO, supervisor) with a required *source* (`FACILITY_PHONE_CALL`, `FACILITY_DOCUMENT_SEEN`, `GUARDIAN_REPORTED`, `APP_USER_DIRECT`) and verification status; unverified updates are labelled "reported, not verified" | Add a FACILITY_STAFF role + user-facility scope now (new access dimension, larger stage) |
| **P** | Facility directory | Fields in the schema proposal; official code unique; `acceptsReferrals` and `services` can be set only on a **verified** facility (with verification reference); deactivation keeps history. Managed in the **admin portal** by `facility.manage` holders whose scope covers the facility's area. New type `DESIGNATED_SPECIALIST_CENTRE`. Selection rule (assumption): facilities in the child's district or above it; outside it only by an approver with a reason | Free-text address hierarchy instead of area link; any facility anywhere |
| **Q** | Follow-ups | Statuses `PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, MISSED, CANCELLED`; rescheduling is an **event** with a reason and new due date (status stays active), not a status. New permission **`follow_up.update`** (workers, MO, supervisor). Workers update only tasks assigned to them; (re)assignment only by `referral.update` holders, only to users whose scope covers the child. "Overdue" is computed (due date passed, still active); MISSED is a human decision with a reason. One active task per child + referral + reason | RESCHEDULED as a status; automatic MISSED by the job |
| **R** | Referral closure | CLOSED only by `referral.update`/`referral.approve` holders, with a reason, from VISITED, UNDER_TREATMENT, FOLLOW_UP_REQUIRED or VISIT_NOT_COMPLETED, and only when no follow-up of the referral is still active. Completing a follow-up **never** changes the referral | Auto-close when the follow-up is completed (forbidden by the brief) |
| **S** | Notifications and reminders | In-app only: no push, SMS or e-mail (no approved provider). Payload = ids + type; the app shows generic text ("A referral was updated") - no names or health details. Unique `dedupeKey` prevents duplicates. Reminders (follow-up due soon, follow-up overdue, review overdue) come from an idempotent script `npm run jobs:reminders`, run by the server's scheduler (cron / Task Scheduler), not an in-process timer. Review-overdue threshold is configuration with **no default (off)**; "due soon" = due today or tomorrow (assumption) | In-process timer (runs once per API instance -> duplicates) |
| **T** | Dashboards and reports | Worker app: counts over records the user may already read (scope + permission). Admin portal: aggregate-only reports for `report.aggregate` holders by district/block, with small-cell suppression: counts 1-4 shown as "fewer than 5" (**assumption**, configurable). Every metric defined in `api-documentation.md` (issued ≠ acknowledged ≠ visited ≠ closed) | No suppression |
| **U** | Placement of facility admin and district reports | Admin portal, not the worker app (admins do not use the worker app and must not read child data, D3). Conflicts with the brief's section 21E - **needs your confirmation** | Build screens 24-27 in the worker app as listed |
| **V** | Free text | All new notes (review notes, referral reason note, status note, follow-up notes, rule change notes) encrypted with `enc1:`; never logged; never in notifications | Plain text |
| **W** | Emergency notice | Fixed bilingual notice on referral screens, draft wording marked "for programme approval" | No notice |
| **X** | Sub-stages (each stops for review) | **7B** migration, permissions, rule engine, rule CLIs, demo rule sets, result generation + read API, tests. **7C** clinical review + referral create/approve/reject/issue/cancel/history + facility read API, tests. **7D** tracking (ack, appointment, visit, manual source, correction), follow-ups, notifications + reminder job, dashboard/report APIs, tests. **7E** worker app: results, review, notifications. **7F** worker app: referrals, follow-ups, dashboards. **7G** admin portal: facilities + reports; security and regression testing; all 13 `docs/step-7` documents; final report | Fewer, larger stages |

## 6. Referral state machine (decision J)

| From \ to | APPROVED | REJECTED | ISSUED | ACKNOWLEDGED | APPOINTMENT_SCHEDULED | VISITED | VISIT_NOT_COMPLETED | UNDER_TREATMENT | FOLLOW_UP_REQUIRED | CLOSED | CANCELLED |
|---|---|---|---|---|---|---|---|---|---|---|---|
| *(create)* | MO via review | | | | | | | | | | |
| PENDING_APPROVAL | approve | reason | | | | | | | | | reason |
| APPROVED | | | issue* | | | | | | | | reason |
| ISSUED | | | | ✓ | ✓ | ✓ | ✓ | | | | reason |
| ACKNOWLEDGED | | | | | ✓ | ✓ | ✓ | | | | reason |
| APPOINTMENT_SCHEDULED | | | | | ✓ (reschedule) | ✓ | ✓ | | | | reason |
| VISIT_NOT_COMPLETED | | | | | ✓ | ✓ | | | ✓ | reason | |
| VISITED | | | | | | | | ✓ | ✓ | reason | |
| UNDER_TREATMENT | | | | | | | | | ✓ | reason | |
| FOLLOW_UP_REQUIRED | | | | | ✓ | ✓ | | ✓ | | reason | |

\* issue = consent verified + facility active, verified and accepting referrals.
REJECTED, CLOSED and CANCELLED are final. Every transition writes a status event (actor, role,
time, source, verification, reason/note) and an audit row in the same transaction; `version`
must match (409 otherwise). The same matrix is enforced by a database trigger.

Who may do what: create - `referral.create`; approve/reject - `referral.approve`; issue - the
creator, or `referral.update`/`referral.approve`; tracking and closure - `referral.update` (or
`referral.approve`); cancel - creator before ISSUED, otherwise `referral.update`. All only within
area scope of the child's current area.

## 7. Proposed role matrix after Step 7

| Permission | ASHA | AWW | MHT_MO | SUPERVISOR | DISTRICT_ADMIN | STATE_ADMIN |
|---|---|---|---|---|---|---|
| child.read (results, referrals, follow-ups of children in scope) | ✓ | ✓ | ✓ | ✓ | | |
| screening.review (clinical review) | | | ✓ | | | |
| referral.create | ✓ | ✓ | ✓ | | | |
| referral.approve **(new)** | | | ✓ | | | |
| referral.update | | | ✓ | ✓ | | |
| follow_up.update **(new)** | ✓ (own tasks) | ✓ (own tasks) | ✓ | ✓ | | |
| facility.manage | | | | | ✓ | ✓ |
| report.aggregate | | | | ✓ | ✓ | ✓ |

Facility directory *read* (name, type, area, contact) is available to `referral.create`,
`referral.update`, `referral.approve` and `facility.manage` holders; it contains no child data.
