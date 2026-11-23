# Clinical Content Intake - How to Submit Screening Questions

> For: the programme's clinical content team and the engineer who loads the content.
> The app never writes or changes clinical content. This is the only way content gets in.

## 1. What to prepare (one protocol = one Four-D area + one age band)

1. **`protocol-metadata.json`**: copy `protocol-metadata.template.json` and replace every `<< >>`.
   - `code`: upper-case letters, digits and `_` (e.g. `RBSK_D4_0_6M`). Keep it the same for every
     later version of this protocol.
   - `version`: 1 for new content. **Every change, however small, is a new version number.**
     A version is never edited after it is loaded.
   - `category`: one of `DEFECTS_AT_BIRTH`, `DEFICIENCIES`, `DISEASES`, `DEVELOPMENTAL_DELAYS_DISABILITIES`.
   - `age_min_days` / `age_max_days`: inclusive, in completed days (day of birth = 0).
     Example: 0-6 months could be 0-182; the exact band is a clinical decision.
   - `source_reference`: the guideline document, edition and section the questions come from.
2. **`questions.csv`**: copy `questions.template.csv`, one row per question. Edit it in Excel or
   Google Sheets and save as **CSV UTF-8** (so Hindi is kept).

| Column | Meaning |
|---|---|
| `code` | Unique within the protocol, e.g. `Q1` |
| `section` | Questions with the same section are shown together on one screen part |
| `order` | Display order (numbers; gaps allowed, e.g. 10, 20, 30) |
| `answer_type` | `YES_NO`, `SINGLE_CHOICE`, `MULTI_CHOICE`, `NUMBER`, `TEXT` |
| `required` | `yes` or `no`. Required questions need an answer, Unknown or Not assessed before the area can be finished |
| `prompt_hi`, `prompt_en` | The approved question in Hindi and English (both required) |
| `help_hi`, `help_en` | Optional help text; both or neither |
| `options` | Choice questions only: `CODE=हिन्दी|English;CODE2=हिन्दी|English` (at least two) |
| `min`, `max`, `max_decimals`, `unit` | NUMBER questions only: data-entry limits (not clinical thresholds) |
| `max_length` | TEXT questions only |

Workers can always choose **Unknown**, **Not assessed** or **Could not assess** for any question;
do not add these as options.

## 2. Check, then load (engineer, on the server)

```powershell
npm run db:protocol-import -- --metadata protocol-metadata.json --questions questions.csv --check
```

`--check` writes nothing. It lists **every** problem with its CSV line (missing Hindi, an unknown
answer type, options on a yes/no question, min above max, template text left in, …). Fix the sheet
and check again until it says `Valid`.

```powershell
npm run db:protocol-import -- --metadata protocol-metadata.json --questions questions.csv --actor <LOGIN-ID>
```

This loads the content as a **DRAFT** (not usable in production) and records who imported it and
the content fingerprint (SHA-256) in the audit log. An existing code + version is refused.

## 3. Review, approve, activate

```powershell
npm run db:protocol-status -- --code <CODE> --version 1 --to IN_REVIEW --actor <LOGIN-ID>
# the clinical reviewers check the content in a non-production environment
npm run db:protocol-status -- --code <CODE> --version 1 --to APPROVED --actor <APPROVER> --reference "<approval no.>"
npm run db:protocol-status -- --code <CODE> --version 1 --to ACTIVE --actor <LOGIN-ID>
```

Rules enforced by the system: content is frozen from IN_REVIEW on; approval needs an approver
(assumed: a `screening.review` holder) and a reference; two ACTIVE protocols of one area must not
overlap in age; demonstration content can never be approved. Details:
[../clinical-content-governance.md](../clinical-content-governance.md).

## 4. Still to be decided by the programme

Who prepares the content, who is the clinical approver, and what counts as approval evidence.
