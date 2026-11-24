# Worker app - screening results, clinical review, notifications (Step 7E)

Code: `src/features/results/` (api, hooks, routes, `components/ResultView.tsx`) and the screens
below. Every response is validated against `@balswasthya/shared-contracts`; URLs carry opaque ids
only; the API decides permissions, scope, review claims and versions.

## Screens

| Route | Who | What |
|---|---|---|
| `/screening/[sessionId]/result` | `child.read` | Result of the current screening version, opened from the summary ("View screening result"). Earlier versions listed after amendments. |
| `/screening/results` | `child.read` | Real counts (`GET /dashboards/results`) and current results in the user's areas, with an outcome filter. |
| `/screening/reviews` | `screening.review` | Clinical review queue (oldest first). |
| `/screening/reviews/[reviewId]` | `screening.review` | Claim / release, decision form, result, review history. |
| `/notifications` (tab) | everyone | Own in-app notifications; replaces the Step 4 placeholder. |

Entry points: screening home ("Screening results"; "Clinical reviews" for medical officers) and the
summary of a completed screening.

## Safety rules on screen

- The result screen keeps four things apart: recorded answers (summary screen), the automatic
  result, the doctor's review status, and "This app does not record a diagnosis".
- Every result screen shows "screening result, not a diagnosis" plus the emergency instruction; a
  warning when demonstration / unapproved content was used; a warning on superseded versions.
- No outcome uses a "success" colour: "No concern in the completed items" is shown in blue and
  explained as not meaning the child has no health problem.
- Recommending a referral shows the emergency notice and needs the area and priority. Notes are
  required except for "Accept"; the app never sends a reviewer id.
- If another doctor changed or took the review, the API answers 409; the screen shows the message
  and reloads.
- Notifications show generic translated text per type only - no names or health details. Opening
  one marks it read; review notifications open the review. Referral and follow-up notifications
  open their screens from stage 7F.

## Tests

`tests/screens/results.test.tsx` (11) with the fake API in `tests/support/fakeResults.ts`; the
Step 4 notifications test now expects the new empty state.

Hindi text for these screens is drafted and needs translator review.
