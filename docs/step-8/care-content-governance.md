# Parent Care content library - governance and API (Step 8, stage 8B)

> Written for: the programme / clinical content owners who supply and approve care content, and the
> developers and operators who import it. Date: 2026-11-26.
> Decisions: C2, C4, C5, C7, C8 in [initial-audit.md](initial-audit.md) (approved 2026-11-24).

## 1. What the library is

The library holds the **educational videos** and **home activities** that workers will later put
on a child's care plan (stage 8C) and show to families (stage 8E). Every item is content from an
approved source. The software adds none: it never writes an activity, picks a frequency, or
suggests a food, a quantity or a medicine.

Each item is **versioned and approved** the same way as screening protocols and clinical rule sets.
After approval nobody can change an item, not even a database administrator through the
application account. A change means a new version.

## 2. What an item contains

| Field | Rule |
|---|---|
| `code`, `version` | Upper-case code; a new version for every change |
| `kind` | `VIDEO` or `ACTIVITY` |
| `topic` | `DEVELOPMENT_MOTOR`, `DEVELOPMENT_SPEECH_LANGUAGE`, `DEVELOPMENT_SOCIAL_PLAY`, `DEVELOPMENT_COGNITIVE`, `NUTRITION_FEEDING`, `HYGIENE`, `DAILY_CARE` (list to be confirmed by the programme) |
| `category` | Optional Four-D category the item supports, or `null` |
| `title`, `summary` | Hindi and English |
| `ageMinDays`, `ageMaxDays` | The item is offered only to children of this age (in completed days) |
| `steps` | **Activities only.** 1-20 steps, Hindi and English, in order |
| `suggestedFrequency` | **Activities: required.** Text copied from the source, e.g. "daily". Never calculated |
| `video` | **Videos only.** `https://` link to the approved hosted video, length in seconds, approximate data size, spoken languages, captions yes/no |
| `requiresDoctor` | `true` = doctor-recommended: only a medical officer may put it on a plan |
| `sourceReference` | Required: document or channel, edition, section |
| `usagePermission` | Required: licence or permission-letter reference |
| `isDemonstration` | `false` for real content |

Nutrition items (topic `NUTRITION_FEEDING`) are allowed only as approved content and, from 8C, only a
medical officer may assign them (decision C7).

**Video links:** HTTPS only, a normal host name (no IP address, no user name or password). Real
content can't use reserved or example domains. Videos are streamed from the approved host and never
downloaded into the app. Length and data size are shown to the family before playing.

Example import files: [examples/care-content-activity.example.json](examples/care-content-activity.example.json),
[examples/care-content-video.example.json](examples/care-content-video.example.json).

## 3. Lifecycle

```
import -> DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> RETIRED
                      |                        ^
                      +-> DRAFT (rework)       +-- APPROVED -> RETIRED
```

| Step | Command (run in `services/api`) | Who |
|---|---|---|
| Check a file (writes nothing) | `npm run db:care-content-import -- --file item.json --check` | Anyone |
| Import as DRAFT | `npm run db:care-content-import -- --file item.json --actor <LOGIN-ID>` | Designated content operator |
| Send for review (fixes the content fingerprint) | `npm run db:care-content-status -- --code <CODE> --version <N> --to IN_REVIEW --actor <LOGIN-ID>` | Operator |
| Send back for rework | `... --to DRAFT --actor <LOGIN-ID>` | Operator |
| Approve | `... --to APPROVED --actor <LOGIN-ID> --reference "<approval minute / letter>"` | A user holding `screening.review` (assumption C4 - programme to confirm) |
| Make available | `... --to ACTIVE --actor <LOGIN-ID> [--effective-from 2027-01-01T00:00:00+05:30]` | Operator |
| Withdraw | `... --to RETIRED --actor <LOGIN-ID>` | Operator |

Every step writes a history event and an audit record. Re-importing identical content does nothing;
importing the same code and version with different content is refused.

## 4. Protections

The database enforces these rules for every account. The import and status tools check them as
well:

- Content (texts, steps, frequency, video, age band, source, permission) is **frozen** once the item
  leaves DRAFT. The approved SHA-256 fingerprint, approver, date and reference can't be changed.
- Only allowed status moves; nothing is ever deleted; history is append-only; `TRUNCATE` and
  `DELETE` are revoked for the application role.
- **One ACTIVE version per code.** Retire the old version before activating the new one.
- Approval needs an approver, a date, a reference and the fingerprint. **Demonstration items can
  never be approved.**
- A video row must carry a video and an activity row must carry steps.
- The read API re-validates each item and re-checks its fingerprint before serving it. Content that
  fails either check is not served and is logged as `care_content_definition_invalid` or
  `care_content_content_mismatch`.

## 5. Demonstration content

The development seed adds five placeholder items (`DEMO_CARE_A1`-`A3` activities, `DEMO_CARE_V1`-`V2`
videos). They exist only so plans, the video player and hand-outs can be built and tested:

- every title, summary and step says it is a placeholder and not guidance;
- the video links point to the reserved `.invalid` domain, so no real video can play;
- they are DRAFT, marked as demonstration, can never be approved, and are **never offered in
  production**;
- `DEMO_CARE_A3` is marked doctor-recommended for the stage 8C permission tests.

## 6. Read API

Both routes are read-only. Callers need `screening.conduct` or `child.read` (field workers, medical
officers, supervisors). Administrators without child access get `403`; requests without a token get
`401`. There is no route to create, change, approve or delete content.

| Route | Returns |
|---|---|
| `GET /api/v1/care-content?kind=&topic=&category=&ageDays=` | `{ items: CareContentSummary[] }`: content that may be offered **today**. Per code, the ACTIVE version once its effective date is reached. Outside production, if no version is ACTIVE, the highest DRAFT version is used instead. Summaries include the video length and data size, but not the link. |
| `GET /api/v1/care-content/:id` | `{ content: CareContentDetail }`: steps, frequency text, video link, usage permission and fingerprint. In production only APPROVED, ACTIVE or RETIRED versions are readable (retired versions stay readable for plan history); anything else gives `404`. |

`isClinicallyApproved` is `true` only for ACTIVE, approved, non-demonstration content. Apps must label
everything else "demonstration - not approved content". Schemas:
`packages/shared-contracts/src/careContent.ts`.

## 7. Needed from the programme

1. Approved videos and activities (Hindi and English) with source and permission to use.
2. Confirmation of the topic list and of who approves care content (currently `screening.review`).
3. Which video hosts are official (for example, a programme channel). The format accepts any
   ordinary HTTPS host today. An allow-list of hosts can be added once these are known.
4. Whether nutrition content is included, and from which source.
