# Clinical rule governance (Step 7)

> Status: implemented in stage 7B. Decisions B, C and D in [architecture.md](architecture.md).

## 1. What the software does and does not do

The software contains a rule **engine** and a rule **format**. It contains **no clinical rule**:
no threshold, malnutrition or anaemia cut-off, milestone age, diagnostic criterion, priority
definition or escalation time. Every number a rule uses is written in the rule set by the
clinical team, next to its clinical reference.

Until an approved rule set is ACTIVE, every result is `NOT_INTERPRETED`: the recorded observations
are shown, and nothing is interpreted.

## 2. Rule sets are versioned data

A rule set covers one Four-D category, one protocol code (with the protocol versions it was
checked against) and one age band (completed days). It holds one or more rules. Each rule has:

| Field | Meaning |
|---|---|
| `ruleId` | Stable code, unique in the set |
| `name` | Hindi and English |
| `clinicalReference` | Guideline, edition and section that justify this rule and its numbers (required) |
| `ageMinDays` / `ageMaxDays` | Optional narrower band inside the set's band |
| `when` | The condition (below) |
| `outcome` | `FURTHER_EVALUATION_RECOMMENDED` or `URGENT_EVALUATION_RECOMMENDED` when met |
| `referralRecommended`, `suggestedPriority` | Whether a referral is recommended, and the suggested priority label |

The rule's **input requirements** (questions and measurements it reads) are derived from the
condition and shown in the rule-set API.

### Conditions (rule DSL v1)

| Condition | Meaning |
|---|---|
| `{ "all": [...] }`, `{ "any": [...] }` | Combine conditions (up to 20 branches, 6 levels deep) |
| `{ "answerIs": { "question", "value": true/false } }` | Yes/no answer equals the value |
| `{ "answerIn": { "question", "codes": [...] } }` | Single choice is one of the codes; multiple choice contains one |
| `{ "answerNumber": { "question", "op", "value": "12.5" } }` | Number answer compared with an exact decimal |
| `{ "measurement": { "type", "op", "value": "11.5", "unit": "kg"/"cm" } }` | Current reliable measurement compared with an exact decimal (g and mm are converted exactly) |

There is **no "not"**: missing data can never become "not met" through negation.

### How evaluation stays safe

- Every condition is MET, NOT_MET or UNKNOWN. A missing answer, `UNKNOWN`, `NOT_ASSESSED`,
  `UNABLE_TO_ASSESS`, a measurement that is missing, not RELIABLE or has two different current
  values, and any input the engine does not understand are all **UNKNOWN**, with the reason recorded.
- `all`: any NOT_MET makes it NOT_MET, otherwise any UNKNOWN makes it UNKNOWN.
  `any`: any MET makes it MET, otherwise any UNKNOWN makes it UNKNOWN.
- `NO_CONCERN_IN_COMPLETED_ITEMS` is given only when the category was **finished** and **every**
  applicable rule is NOT_MET. A MET rule is always reported, even in an unfinished category.
- The evaluator is a pure function: the same screening version and rule set always give the same
  result (rules are evaluated in rule-id order). It is covered by 38 unit tests and mutation checks.

## 3. Lifecycle

`DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> RETIRED` (and `IN_REVIEW -> DRAFT` for rework), the
same lifecycle as screening protocols. There is **no HTTP endpoint** that changes rule sets.

| Step | Command | Checks |
|---|---|---|
| Validate a file | `npm run db:rule-set-import -- --file <set.json> --check` | Format; every question exists in every listed protocol version with a compatible answer type; choice codes exist; measurement units match; a real set does not use demonstration questions. Writes nothing |
| Import | `npm run db:rule-set-import -- --file <set.json> --actor <LOGIN-ID>` | As above; creates a DRAFT; same code + version with different content is refused |
| Submit for review | `npm run db:rule-set-status -- --code <C> --version <N> --to IN_REVIEW --actor <ID>` | Re-validated; SHA-256 of the content is fixed |
| Approve | `... --to APPROVED --actor <ID> --reference "<approval document>"` | Approver must hold `screening.review` (**assumption**: the programme must name the approver role); reference required; content must still match the reviewed hash |
| Activate | `... --to ACTIVE --actor <ID> [--effective-from <ISO time>]` | No overlapping ACTIVE set for the same category, protocol code and ages (database constraint) |
| Retire | `... --to RETIRED --actor <ID>` | Kept for ever; results that used it keep pointing to it |

Every change writes a `ClinicalRuleSetEvent` (who, when, from/to, reference, content hash) and an
audit record. Database triggers enforce the lifecycle for every account: content is frozen once
the set leaves DRAFT **or** any result used it; the approval record is immutable; demonstration
sets can never be APPROVED, ACTIVE or RETIRED; nothing is deleted.

## 4. Which rule set a result uses

For each started category: rule sets of that category whose protocol code and version match the
protocol the category used, and whose age band covers the child's age at the start of screening.

1. An ACTIVE set whose effective time has passed is used.
2. Otherwise, **only outside production**, the latest DRAFT version of one code (demonstration sets
   are DRAFT). Two DRAFT codes = `AMBIGUOUS_RULE_SET` (a configuration error, never guessed).
3. A set whose stored content no longer matches its reviewed hash is never used (logged).
4. Nothing found = `NOT_INTERPRETED`.

A result stores the exact rule set (and so its version and hash) it used. A later rule change never
changes an existing result (decision F).

## 5. Demonstration rule sets

`DEMO_RULES_D1` ... `D4` (seeded in development) use only the numbered placeholder questions of the
demonstration protocols. They contain **no measurement threshold**, so no real-looking clinical
number exists in the code base. They are DRAFT, can never be approved, are never used in
production, and every result made with them shows "not approved" limitations and
`isOperational: false`.

## 6. Needed from the clinical team

1. Approved rule sets per category and age band, with references for every threshold.
2. The approver role for rules (assumed: a `screening.review` holder).
3. Growth-standard tables, if z-score rules are wanted (not supported by DSL v1 - decision D).
4. Approved, non-demonstration protocols for the rules to refer to.
