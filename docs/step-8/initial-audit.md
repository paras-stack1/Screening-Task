# Step 8 - Parent Care module: audit, design and decisions (proposal)

> Stage 8A, 2026-11-24. Read-only audit: no code, schema or database was changed.
> Status: **APPROVED 2026-11-24 ("approve all") - except C3, superseded by the Parent Portal
> (parents get their own accounts; see [parent-portal-plan.md](parent-portal-plan.md)).**
> Scope agreed with the project owner: **parent activity plans** as a "Parent Care" module with
> (1) educational videos, (2) daily home activities, (3) follow-up reminders. AI model integration
> and image / voice / video **analysis** are out of scope (another team member integrates them later).
> Branch: `feat/step-8-parent-care` (from Step 7, commit `79eab94`).

## 1. What exists today

| Need | Existing piece | Fit |
|---|---|---|
| Who the parent is | `Guardian` (name, encrypted phone + lookup hash, preferred language) linked to children through `ChildGuardian` (relationship, primary contact, may give consent) | Good - reuse |
| Consent for messages | Consent purpose `SMS_REMINDERS` and activity `SMS_REMINDER` (Step 5); dev notices are DRAFT placeholders | Good - reuse; approved wording needed |
| Versioned, approved content | Step 6 protocol lifecycle and Step 7 rule sets: DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> RETIRED, content hash, demonstration content never approvable, CLI-only changes | Pattern to reuse for care content |
| Doctor decisions to hang a plan on | Step 7 clinical review decisions, referrals, follow-ups | Good - plans can link to them |
| Dates to remind about | `Referral.appointmentAt` (from tracking), `FollowUp.dueDate` | Good for appointments and follow-up visits |
| Reminders | In-app `Notification` for **staff users** only + `npm run jobs:reminders` (dedupe keys) | Staff only - no channel to parents |
| Media storage | `MediaMetadata` (child photos / videos / audio with consent) - unused, no storage service | Not suitable for a shared video library |
| Worker app | Online-only, Hindi-first, TanStack Query; no video player, no notifications, no printing / sharing libraries installed | New dependencies would be needed (decision C9) |
| Parents using the system | None: parents have no accounts and no app | Parent access would be a large new security surface (decision C3) |

Not present: care content, plans, activities, check-ins, parent reminders, SMS provider, video
hosting, "next scheduled check-up", medication records of any kind.

## 2. Safety boundaries (from the Step 7 brief and the platform's purpose)

1. **No invented health guidance.** Every video and activity is content from an approved source
   (programme / clinical team), versioned and approved like screening protocols. The software ships
   only clearly labelled demonstration placeholders.
2. **Support, not treatment.** Home activities support a child's development and care; they never
   replace a referral, therapy or a doctor. Where a result or review recommends a further or urgent
   check, the referral comes first and the plan says so.
3. **No medicine recommendations.** The app must not recommend medicines (Step 7 rule 13).
   Medication reminders would mean storing prescriptions - see decision C14 (recommended: not now).
4. **"Doctor-recommended" means recorded by a doctor.** Only a medical officer may put
   doctor-recommended activities or a nutrition plan on a child's plan; a worker may add only
   general, age-appropriate content (decision C6).
5. **No sensitive details outside the app.** Any message to a parent (SMS) contains no diagnosis,
   no screening result and no child health detail - only "visit reminder" style text.
6. **Area scope, consent and audit** exactly as for every other child record.

## 3. Proposed design

### 3.1 Care content library (videos and activities)

Versioned content items, approved like protocols, changed only through CLI scripts
(`db:care-content-import`, `db:care-content-status`):

| Field | Notes |
|---|---|
| code, version, kind | `VIDEO`, `ACTIVITY` (a home task with steps) |
| topic | `DEVELOPMENT_MOTOR`, `DEVELOPMENT_SPEECH_LANGUAGE`, `DEVELOPMENT_SOCIAL_PLAY`, `DEVELOPMENT_COGNITIVE`, `NUTRITION_FEEDING`, `HYGIENE`, `DAILY_CARE` (list to be confirmed) |
| age band (days), Four-D category (optional) | Content is offered only for matching ages |
| title, short description, steps (hi / en) | Steps for activities; plain language, Hindi first |
| suggested frequency | e.g. "daily", "3 times a week" - **from the source**, never computed |
| video: hosted URL or file reference, duration, size, language, captions | See decision C8 |
| `requiresDoctor` | Doctor-recommended items: only a medical officer may assign them |
| source reference, licence / permission to use | Required (who made it, may we show it) |
| lifecycle, approval, content hash, `isDemonstration` | Same rules as rule sets (CHECKs + triggers) |

### 3.2 Care plans (daily home activities)

A child's care plan = a set of content items given to the family, with history:

- created by a medical officer (from a review decision, referral or follow-up) or by a worker
  (general content only, decision C6); linked to the review / referral / follow-up it came from;
- items reference the **exact content version**; frequency = the source's suggestion, or a medical
  officer's adjustment with a note;
- statuses `ACTIVE`, `COMPLETED`, `STOPPED` (reason); one active plan per child; append-only events;
- **check-ins** at visits: per item "done most days / sometimes / not done / unknown", always
  recorded as *reported by the family* (never verified), plus an encrypted note;
- a plan is reviewed at the next follow-up; completing a plan never closes a referral.

### 3.3 Educational videos

- The worker shows approved videos to the family during a visit (worker app video player).
- Videos are listed by the child's age and plan topics; "watched with family" is recorded per plan
  item (no tracking of parents).
- Delivery option (decision C8): approved hosted URLs (e.g. official programme channels) as the
  first stage; files in private object storage later. Data cost and size shown before playing.

### 3.4 Follow-up reminders

| Reminder | Date source | Who is reminded (stage 1) |
|---|---|---|
| Next doctor appointment | `Referral.appointmentAt` | Worker (in-app, existing notifications); parent via SMS only after C11 |
| Follow-up visit / check-up | `FollowUp.dueDate`; plan review date | Worker; parent via SMS only after C11 |
| Scheduled screening | new "next screening due" date on the plan or follow-up (C13) | Worker |
| Medication | **Not in this step** (C14) | - |

Parent reminders by SMS are designed as an **outbox**: messages are queued with a fixed,
non-sensitive template, consent (`SMS_REMINDERS`) is checked at send time, and a sender job delivers
them through an approved provider. Until a provider is approved, the outbox stays disabled and
the worker reminds the family in person (the worker app shows "remind the family" items).

### 3.5 Hand-out for the family

A printable / shareable one-page plan in Hindi (activities, frequencies, next visit date) that the
worker can show or share (decision C10). No screening results or diagnoses on it.

### 3.6 Reports

Counts only (plans active / completed, check-ins, reminders sent or failed), small counts hidden,
same as Step 7 reports.

## 4. Decisions needed

Recommended option first.

| # | Topic | Recommendation | Alternatives |
|---|---|---|---|
| **C1** | Branch | Work on `feat/step-8-parent-care` (created from Step 7) | - |
| **C2** | Content source | Approved, versioned content only (programme / clinical team: e.g. RBSK / DEIC material, MCP card, WHO-UNICEF Care for Child Development, Poshan material); demonstration placeholders until then; CLI import + approval like rule sets | Free text written by workers (not safe) |
| **C3** | Parent access | **No parent accounts or parent app in this step.** The worker delivers the plan, shows videos and reminds in person; SMS later (C11) | Parent app / login (large: OTP, guardian identity, separate consent, security review) |
| **C4** | Content approver | A `screening.review` holder records approval with a reference (assumption, as for protocols and rules) | A new clinical-content role |
| **C5** | Topics and ages | Topics in 3.1; age bands from the content itself | Fixed bands |
| **C6** | Who creates plans | Medical officers: any content incl. "doctor-recommended" items and frequency changes. Field workers: general, age-appropriate items only, from the approved library, for children in their area | Workers only after a doctor's review; doctors only |
| **C7** | Nutrition plans | Only as approved nutrition content assigned by a medical officer; the app never computes diets, quantities or supplements | Worker-entered nutrition advice |
| **C8** | Video delivery | Stage 1: approved hosted links (official channels) with duration and size shown; streaming only, no download. Private file storage later | Self-hosted files now (storage service, costs, CDN) |
| **C9** | New app dependencies | Add `expo-video` (playback) and `expo-print` + `expo-sharing` (family hand-out) - each justified, Expo SDK-matched versions | No video playback (open links in the browser) |
| **C10** | Family hand-out | One-page printable / shareable plan in Hindi, no results or diagnoses | No hand-out |
| **C11** | SMS to parents | Build the reminder outbox and templates now, **disabled** until an SMS provider and DLT-registered templates are approved; consent checked at send time | No parent SMS at all; build the provider integration now |
| **C12** | SMS content | Fixed templates without the child's name or any health detail, e.g. "BalSwasthya reminder: health visit on {date}" / "appointment on {date} at {facility}" | Templates that include the child's first name |
| **C13** | Check-up dates | Add "next visit / next screening due" date to plans; reminders for workers | Separate scheduling module |
| **C14** | Medication reminders | **Not in this step.** Storing prescriptions is a medication-record feature with its own clinical and legal review; the app must not recommend medicines | Minimal prescription entry by medical officers with reminders |
| **C15** | Check-ins | Recorded at visits as "reported by the family", unverified, with optional encrypted note | Parent self-reporting (needs C3) |
| **C16** | Plan rules | One active plan per child; append-only history; version guard; completing or stopping a plan never changes referrals or follow-ups | Several parallel plans |
| **C17** | Reports | Counts only, small counts hidden (as Step 7) | No reports |
| **C18** | Sub-stages (each stops for review) | **8B** schema migration + content library (DSL, lifecycle CLIs, demonstration content) + read API; **8C** care plans, items, check-ins, plan API, worker reminders; **8D** parent reminder outbox (disabled sender), hand-out data, reports API; **8E** worker app: content library, video player, plan screens, check-ins, hand-out, reminders; **8F** security / regression tests, docs, final report | Fewer stages |

## 5. Schema change proposal (summary - needs approval)

New tables only; nothing existing is reshaped:

| Table | Purpose |
|---|---|
| `CareContent` + `CareContentEvent` | Versioned approved videos and activities (lifecycle, approval, content hash, demonstration flag); history |
| `CarePlan` + `CarePlanEvent` | A child's plan (origin, links to review / referral / follow-up, status, next visit date, version); history |
| `CarePlanItem` | Content version on a plan, frequency, assigned by, start / end |
| `CarePlanCheckIn` | Family-reported progress per item at a visit (unverified), encrypted note |
| `ParentReminder` | Reminder outbox: guardian, type (appointment / follow-up visit / check-up), date, template, channel, status (scheduled / sent / failed / cancelled / blocked by consent), dedupe key |

New permission (proposal): `care_plan.manage` for workers and medical officers (or reuse
`referral.create` / `referral.update` - to decide in 8B). Database rules as in Step 7: append-only
histories, one active plan per child, version guards, no deletes, content frozen after approval.

## 6. Needed from the programme / clinical team

1. Approved videos and activities (with source and permission to use), in Hindi and English.
2. Who approves care content.
3. Whether nutrition content is included and from which source.
4. SMS provider and approved message templates (and whether a child's first name may appear).
5. Approved `SMS_REMINDERS` consent wording.
6. Confirmation that medication reminders are out of scope for now.

## 7. Baseline

Last full results at the end of Step 7 (2026-11-24): API unit 482, worker app 3182 passed / 20
skipped, admin portal 396 passed / 5 skipped, database 413/418 in the last full run (5 timeouts from
slow disk sync; each file passes alone). Re-run at the start of 8B.
