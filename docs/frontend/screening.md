# Worker App - Screening (Step 6)

> Status: Step 6 complete (6D + 6E, 2026-11-23). All question content in development is
> **demonstration content** (not clinically approved).

## Screens and routes

| Route | Screen | Notes |
|---|---|---|
| `/screening` | Home | The worker's own real counts (`GET /screenings/summary`), unfinished screenings to continue, "Start a new screening". Roles without `screening.conduct` see "not part of your role" and make no screening calls |
| `/screening/select-child` | Choose child | Same in-scope search as the children list; choosing only opens the check, nothing is created |
| `/screening/start/:childId` | Before screening | Age with uncertainty, SCREENING consent status, blockers, per-category availability, demonstration warning. Start is disabled unless the API says `canStart`. Missing consent → link to the Step 5 consent capture; no bypass |
| `/screening/:sessionId` | Session hub | Child, age, who started it; four category cards with **workflow** state; measurements count. Read-only for anyone but the conducting worker or once closed |
| `/screening/:sessionId/category/:category` | Questions | One section at a time, see below |
| `/screening/:sessionId/measurements` | Measurements | Add and correct; history with "Corrected" |
| `/screening/:sessionId/review` | Review and complete (6E) | Observations-only summary, incomplete-area warning, Complete disabled until one area is finished, confirmation dialog, one request on double tap; then the summary |
| `/screening/:sessionId/summary` | Summary / details (6E) | Who, when, status (cancel reason), per-area answers with source and notes, incomplete and not-assessed areas, current measurements, number of corrections, and "no approved rules, so no result or recommendation" |
| `/screening/history/:childId` | History (6E) | Newest first, 20 per page; completed and cancelled open the summary, the worker's own unfinished ones open the session |
| `/screening/:sessionId/amend` | Amend a completed screening (6G-2) | Change answers (also answer a question left unanswered), measurements and area observations; a reason (3-500 characters) and a confirmation; everything is sent as ONE amendment = one new version. Leave warning while unsaved |
| `/screening/review-queue` | Amendments to review (6G-2) | Medical officers (`screening.review`) only: pending amendments in their areas; each opens the summary |

The hub also has **Review and complete**, **Cancel this screening** (a reason of 3+ characters and a
confirmation; the record is kept as CANCELLED), and **View summary** once closed. The child profile
has **Screening history**.

Entry points: the dashboard "Start screening" card (needs `screening.conduct`) and "Start or
continue screening" on the child profile. Screening is a stack inside the signed-in tabs with
no tab button (`tabBarButton: () => null`; see bug S6-003 for why not `href: null`).

## Clinical-safety rules in the UI

- **Workflow state, not health state.** Category badges are *Not started*, *In progress*,
  *Questions finished* and *Not available*. "Finished" uses the info tone, never green: green would
  read as "healthy". No screen shows a result, classification or recommendation.
- Every screening screen shows "Screening observations only. This is not a diagnosis. Follow the
  approved referral protocol when needed."
- Demonstration or unapproved content shows a warning banner first on every screening screen.
- An estimated date of birth is always shown as "About … (date of birth estimated)", never as an
  exact age, with a note that the screening will be marked for review.

## Answers (decision G)

- Nothing is preselected. YES_NO questions offer *Yes, No, Unknown, Not assessed, Could not
  assess*; other types first choose *Give an answer / Unknown / Not assessed / Could not assess*.
- *Who gave this information?* (observed / told by parent or guardian) is required for every
  answer state.
- An untouched question stays unanswered (no record). *Clear answer* returns it to unanswered and
  is sent as `cleared`; it is never turned into "No".
- Answers live in memory (`answerDraft.ts`), never on the device. Only changed answers are sent,
  with the session `expectedVersion`.
- *Save and continue* saves the current section. *Save answers* saves everything changed.
  *Finish this area* saves, checks that every required question has a state, then asks the API to
  finish (the API checks again).
- **Version conflict** (another device saved): the message says so, the session is reloaded, and
  the worker's typed answers stay on screen so they can save again. Untouched questions show the
  server's newer values.
- **Network failure:** the error is shown, the answers stay, and success is never shown.
- **Leaving with unsaved answers** asks *Leave without saving?* (Stay / Leave), using
  `usePreventRemove`.
- Double submission is blocked (in-flight guard plus loading buttons).

## Measurements (decisions I, J)

- The type, then the units allowed for it (kg/g, cm/mm), the value as typed (decimal keyboard),
  source, reliability, optional device. Precision is checked before sending (kg 2, g 0, cm 1, mm 0);
  plausibility is decided only by the API and shown in plain language.
- A saved value shows exactly as entered, plus the server's explicit conversion: "3250 g (= 3.25 kg)".
- A correction keeps the original visible as *Corrected* and requires a reason.
- **Measurement date (6F):** a value *measured now* uses the time of entry. A value *copied from a
  card* or *told by a guardian* asks "When was it measured?" (day / month / year boxes, as in
  registration). It must be a real date, not in the future (India date) and not before the date of
  birth, and is sent as the start of that day in India, because the time of day is not known and is
  not invented. Logic: `src/features/screening/measurementDate.ts`.

## Offline (decision Q)

Screening is online-only. Requests pause while offline, and the offline banner explains why. No
screening data is written to device storage (TanStack Query cache in memory only, cleared on
sign-out). Server drafts let the worker resume later from the screening home.

## Amendments of completed screenings (Step 6G-2)

Design and rules: [../step-6/amendment-design.md](../step-6/amendment-design.md). The API decides who
may amend (`canAmend`, `amendBasis`, `amendableUntil`); the app only explains it.

- **Summary:** "Amend this screening" when allowed, with "you can correct it until DD/MM/YYYY HH:MM"
  (India time) for the conducting worker or "as a medical officer you can correct it at any
  time". The conducting worker whose 7 days have ended is told to ask a medical officer. After a
  save, "saved as version N".
- **Current values** carry an **Amended** badge (answers, area observations, measurements). The
  **Amendment history** lists every version, newest first: who, when, basis, reason, each change
  as "old -> new" ("not answered" / "none" stay visible), and the review status: "No medical
  review needed (observations only)", "Waiting for medical officer review", or "Reviewed by ...
  on ..." with notes and "self-reviewed".
- **Amend screen:** every question of the areas that were started (an area that was never started
  needs a new screening), the current measurements and the area observations, each with
  "Change" / "Undo". An answer cannot be removed (use Unknown / Not assessed). A measurement keeps
  its original time unless its source changes to a card or the guardian (then the date is
  required, India day start). Edits stay in memory only.
- **Saving:** one request with a `clientOperationId` (kept for identical content, so a retry after
  a lost response is safe) and `expectedSequence`. If someone else amended meanwhile (409
  `AMENDMENT_CONFLICT`), the screen explains it, reloads, keeps the edits, and the next save uses
  the new sequence.
- **Medical officer:** "Amendments to review" on the screening home, and "Mark as reviewed" (optional
  notes, explicit confirm) on pending amendments in the summary.

## Tests

- `tests/screening/answerDraft.test.ts`: answer logic. Unknown never carries a value; only changes
  are sent; validation.
- `tests/screens/screening.test.tsx` (21 tests): home counts and resume, role restriction, Hindi,
  child choice, consent blocking with no bypass, double-tap start, server-derived fields only,
  estimated age, hub states, read-only for another worker, section save payload, Unknown ≠ No,
  source required, finishing rules, version conflict keeps answers, network failure, leave
  warning, accessible radios and checkboxes, measurement precision, plausibility message,
  correction history, expired token refresh.
- `tests/screens/amendments.test.tsx` (16, Step 6G-2): who may amend (conductor window, closed
  window, other worker, medical officer, direct URL refused), exact amendment request, version and
  Amended badge, old -> new history, answering an unanswered question, notes-only = no review,
  measurement change, card date required, no change / no reason refused, conflict reload and
  resave with a new operation id, leave warning, medical officer queue and review, queue hidden
  from workers, empty queue.
- `tests/screening/amendDraft.test.ts` (9): change building, removing an answer refused,
  measurement time and card date, precision, future / before-birth dates, notes removal, reason
  length, India date-time.
- Fake API: `tests/support/fakeScreening.ts`, validated with the real shared contracts (6G-2: its
  ids are now valid RFC 4122 UUIDs - the old `c000` variant was rejected by the strict amendment
  contract).
- Mutation checks (2026-11-22): removing the source rule, the leave guard, the consent gate on
  Start, or sending a value with Unknown each made a test fail.

## Translation review

All new Hindi strings (`screening.*`) are engineering drafts and need review by a qualified
translator and the programme, as for Steps 4 and 5.
