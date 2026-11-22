# Worker App - Screening (Step 6, stage 6D)

> Status: 2026-11-22. Implemented: screening home, choose child, eligibility and consent check,
> session hub with the four Four-D categories, category questions, measurements. Review and
> completion, the completion summary, history and cancellation follow in stage 6E. All
> question content in development is **demonstration content** (not clinically approved).

## Screens and routes

| Route | Screen | Notes |
|---|---|---|
| `/screening` | Home | The worker's own real counts (`GET /screenings/summary`), unfinished screenings to continue, "Start a new screening". Roles without `screening.conduct` see "not part of your role" and make no screening calls |
| `/screening/select-child` | Choose child | Same in-scope search as the children list; choosing only opens the check, nothing is created |
| `/screening/start/:childId` | Before screening | Age with uncertainty, SCREENING consent status, blockers, per-category availability, demonstration warning. Start is disabled unless the API says `canStart`. Missing consent → link to the Step 5 consent capture; no bypass |
| `/screening/:sessionId` | Session hub | Child, age, who started it; four category cards with **workflow** state; measurements count. Read-only for anyone but the conducting worker or once closed |
| `/screening/:sessionId/category/:category` | Questions | One section at a time, see below |
| `/screening/:sessionId/measurements` | Measurements | Add and correct; history with "Corrected" |

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
- **Limitation:** `measuredAt` is the time of entry. There is no picker yet for values copied from a
  card or told by a guardian about an earlier date.

## Offline (decision Q)

Screening is online-only. Requests pause while offline, and the offline banner explains why. No
screening data is written to device storage (TanStack Query cache in memory only, cleared on
sign-out). Server drafts let the worker resume later from the screening home.

## Tests

- `tests/screening/answerDraft.test.ts`: answer logic. Unknown never carries a value; only changes
  are sent; validation.
- `tests/screens/screening.test.tsx` (21 tests): home counts and resume, role restriction, Hindi,
  child choice, consent blocking with no bypass, double-tap start, server-derived fields only,
  estimated age, hub states, read-only for another worker, section save payload, Unknown ≠ No,
  source required, finishing rules, version conflict keeps answers, network failure, leave
  warning, accessible radios and checkboxes, measurement precision, plausibility message,
  correction history, expired token refresh.
- Fake API: `tests/support/fakeScreening.ts`, validated with the real shared contracts.
- Mutation checks (2026-11-22): removing the source rule, the leave guard, the consent gate on
  Start, or sending a value with Unknown each made a test fail.

## Translation review

All new Hindi strings (`screening.*`) are engineering drafts and need review by a qualified
translator and the programme, as for Steps 4 and 5.
