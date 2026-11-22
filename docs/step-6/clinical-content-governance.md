# Clinical Content Governance (Step 6)

> Status: Stage 6B (2026-11-22). **No clinically approved screening content exists yet.** The
> only protocols in the system are DEMONSTRATION placeholders, which cannot be approved.

## 1. Principle

Software and clinical content are separate. The application stores, versions, validates and
displays protocols; it never invents questions, age bands, milestones, thresholds, scores or
referral rules. A protocol is **data with provenance**: who approved it, when, under which
reference, against which guideline, with exactly which content (SHA-256).

## 2. What a protocol contains

One protocol version = one Four-D category + one age band (inclusive, in completed days) +
ordered questions. Per question: code, section, order, wording in Hindi and English, help text,
answer type (YES_NO, SINGLE_CHOICE, MULTI_CHOICE, NUMBER, TEXT), options with bilingual labels,
data-entry rules (number range/decimals/unit, text length) and a required flag. The protocol
also has a name and description in both languages, and a mandatory `sourceReference` (guideline
document, edition, section).

The definition format is `protocolDefinitionSchema` in
`packages/shared-contracts/src/screening.ts`. Invalid content (choice question without options,
missing Hindi, inverted band, duplicate codes, ...) is rejected when it is loaded and again
whenever it is served.

## 3. Lifecycle

```
DRAFT --> IN_REVIEW --> APPROVED --> ACTIVE --> RETIRED
  ^           |             \______________________^
  |___________|  (sent back for rework)
```

| Step | Who | What the system records / enforces |
|---|---|---|
| DRAFT | Content author (engineering loads the agreed content) | Editable only while no session has used it |
| -> IN_REVIEW | Content author | Content validated; SHA-256 fixed. From now on content and questions are frozen |
| -> APPROVED | Clinical approver (**ASSUMPTION:** must hold `screening.review`, e.g. RBSK MHT medical officer; the programme must confirm the approver role) | Approver, time, approval reference; content must still match the reviewed hash. Demonstration content is refused |
| -> ACTIVE | Programme administrator with the approver | `effectiveFrom`; refused if another ACTIVE protocol of the category overlaps the age band |
| -> RETIRED | Programme | `retiredAt`; never usable again; kept forever for historical sessions |

Every transition writes `screening_protocol.status_changed` to the audit log (code, version,
from, to, content hash, approval reference, `via: admin-script`). The database triggers enforce
the same rules for every account.

**Changing content = a new version** (same code, version + 1, starting as DRAFT). Old versions are
never edited or deleted; every screening category records the exact protocol version it used and
that version's status at the time.

## 4. How to run a transition

There is deliberately no API or screen for this. On the server, as the designated person:

```powershell
npm run db:protocol-status -- --code <CODE> --version 1 --to IN_REVIEW --actor <LOGIN-ID>
npm run db:protocol-status -- --code <CODE> --version 1 --to APPROVED --actor <APPROVER-LOGIN-ID> --reference "<committee minute / approval letter no.>"
npm run db:protocol-status -- --code <CODE> --version 1 --to ACTIVE --actor <LOGIN-ID> [--effective-from 2027-01-01T00:00:00+05:30]
npm run db:protocol-status -- --code <CODE> --version 1 --to RETIRED --actor <LOGIN-ID>
```

How approved content gets loaded as a DRAFT (format, file, review checklist) is **not yet
defined**. It is listed below as an open programme decision.

## 5. Where content is usable

| Status | Development / test | Production |
|---|---|---|
| ACTIVE (effective date reached) | Usable | Usable |
| DRAFT (incl. demonstration) | Usable, with a warning | **Never** usable, and not even readable through the API |
| IN_REVIEW, APPROVED (not yet active), RETIRED | Not usable (RETIRED readable for history) | Same |

The setting follows the environment (`allowDraftProtocols = !production`), the same rule as
draft consent notices.

Selection never guesses (`protocolSelection.ts`): ACTIVE wins; among drafts only the latest
version of a code counts; two different codes covering the same age → `AMBIGUOUS_PROTOCOL`; no
protocol for the age → `NO_PROTOCOL_FOR_AGE`, with no "nearest band" fallback.

## 6. Demonstration content

`DEMO_D1` to `DEMO_D4` (`services/api/src/modules/screening/demoProtocols.ts`, created by
`npm run db:seed`): numbered placeholder questions ("Demonstration question 1 (yes / no).
Placeholder - not a clinical question." / "प्रदर्शन प्रश्न 1 ..."), one band covering the whole
registration age range (0-6954 days, not a clinical band), `sourceReference` "NONE - ...".
`isDemonstration = true` is blocked from approval by a database CHECK. The app must show
"Demonstration content - not for clinical use" (stage 6D).

## 7. Pending clinical and programme approvals

1. The actual Four-D questions, Hindi/English wording, answer options, age bands and source
   guideline references.
2. The approver role and approval evidence (assumed: `screening.review` holder + reference).
3. The intake format and review checklist for loading approved content as DRAFT.
4. Data-quality ranges for measurements (stage 6C uses only "physically impossible" limits,
   marked as assumptions).
5. Scoring and referral rules, if any. None are implemented.
6. The age-band policy for estimated dates of birth.
7. The amendment workflow for completed screenings.
