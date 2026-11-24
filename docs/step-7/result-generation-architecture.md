# Screening result generation (Step 7)

> Status: implemented in stage 7B. Decisions E, F and G in [architecture.md](architecture.md).
> Rules: [clinical-rule-governance.md](clinical-rule-governance.md).

## 1. Four layers, kept apart

| Layer | Where it lives | Step |
|---|---|---|
| Recorded observation | `ScreeningObservation`, `Measurement`, amendment changes | 6 |
| Automated screening interpretation | `ScreeningResultRun` + `ScreeningResult` (this document) | 7B |
| Clinician-reviewed assessment | `ClinicalReview` (task created here; actions in 7C) | 7C |
| Confirmed diagnosis | **Not recorded anywhere** | - |

A result is a workflow label produced by a versioned rule set. It is never a diagnosis.

## 2. When results are generated

| Trigger | Version | Transaction |
|---|---|---|
| Screening completed (`POST /screenings/:id/complete`) | 1 | Same transaction as the completion |
| Amendment saved (`POST /screenings/:id/amendments`) | sequence + 1 | Same transaction as the amendment; the previous run gets `supersededAt` |
| `POST /screenings/:id/generate-result` | current | For screenings completed before Step 7; idempotent (`replayed: true` when it exists) |

Draft and cancelled screenings never get a result (409 `SCREENING_NOT_COMPLETED`; the database
also refuses at commit). One run per screening version (unique index); a later rule-set change
never re-interprets an old screening.

## 3. What a run contains

**Session level** (`ScreeningResultRun`): screening version, overall outcome, whether any
unapproved content or rules were used, evaluator version (`rule-engine/1`), generated at / by
(null = automatic), superseded at.

**Per category** (`ScreeningResult`, always four rows): outcome; the session category, protocol
version and rule set used; for every rule: MET / NOT_MET / UNKNOWN / NOT_APPLICABLE with
**references** to the observations, measurements or amendment changes it read (never copied
values); limitations; referral recommendation and suggested priority (only from a rule).

### Outcomes

| Outcome | When |
|---|---|
| `NOT_ASSESSED` | Category never started |
| `NOT_INTERPRETED` | No usable rule set (observations shown without interpretation) |
| `URGENT_EVALUATION_RECOMMENDED` / `FURTHER_EVALUATION_RECOMMENDED` | At least one rule MET (most severe wins), even in an unfinished category |
| `INCOMPLETE` | Category started but not finished, and no rule met |
| `UNABLE_TO_DETERMINE` | Finished, but a rule could not be evaluated (missing / unknown / unreliable / conflicting / unsupported input), or no rule applies to this age |
| `NO_CONCERN_IN_COMPLETED_ITEMS` | Finished and every applicable rule NOT_MET |

Session outcome = the most cautious category outcome (order: urgent, further, unable to
determine, incomplete, not interpreted, not assessed, no concern).

Limitation codes: `CATEGORY_NOT_STARTED`, `CATEGORY_INCOMPLETE`, `NO_USABLE_RULE_SET`,
`AMBIGUOUS_RULE_SET`, `RULE_SET_NOT_APPROVED`, `PROTOCOL_NOT_APPROVED`, `ANSWER_MISSING`,
`ANSWER_UNKNOWN`, `ANSWER_NOT_ASSESSED`, `ANSWER_UNABLE_TO_ASSESS`, `MEASUREMENT_MISSING`,
`MEASUREMENT_NOT_RELIABLE`, `MEASUREMENT_CONFLICT`, `UNSUPPORTED_INPUT`.

## 4. Review task

Every run gets a `ClinicalReview` in `PENDING_REVIEW` (decision G) with a first history event and
the child's area at that time (reporting only; access follows the child). The review of a
superseded run stays as it was; the 7C queue shows reviews of current runs.

## 5. API

| Route | Permission | Notes |
|---|---|---|
| `GET /screenings/:id/results` | `child.read` | `{ current, history }`, newest version first |
| `POST /screenings/:id/generate-result` | `screening.conduct` or `screening.review` | Body `{}`; 201 created, 200 + `Idempotent-Replay: true` when it existed |
| `GET /screening-results` | `child.read` | Current runs in scope; filters `outcome`, `reviewStatus`, `childId`; fixed order (newest first); page size ≤ 50 |
| `GET /screening-results/:id` | `child.read` | One run |
| `GET /clinical-rule-sets`, `/:id` | `screening.review` | Read-only catalogue with rules, input requirements and history |

Out-of-scope and missing records both return 404 with a DENIED audit record. The audit record of
a generation holds outcome labels and identifiers only - no answers, values or notes.

## 6. Database rules

Results are insert-only; a run changes only once (supersede); runs need their results and a
COMPLETED screening at commit; `NOT_ASSESSED` / `NOT_INTERPRETED` exactly when no rule set is
linked; concern outcomes and referral recommendations need a rule set; the rule set must be ACTIVE
(or DRAFT, outside production) and match the category, protocol version and child's age.
