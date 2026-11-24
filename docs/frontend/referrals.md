# Worker app - referrals, follow-ups, referral dashboard (Step 7F)

Code: `src/features/referrals/` (api, hooks, routes, labels, `components/ReferralParts.tsx`) and
`app/(app)/referrals/*` (own stack, no tab button - same pattern as screening). Every response is
validated against `@balswasthya/shared-contracts`; URLs carry opaque ids only; every change sends
the version the screen showed (409 = changed elsewhere, the screen reloads). Who may do what,
consent at issue and the verification of updates are decided by the API; the app only shows the
actions the API returns (`actions`) or that the user's role allows.

## Screens

| Route | What |
|---|---|
| `/referrals` | Real counts (`GET /dashboards/referrals`: all, waiting for approval, issued, visit recorded, open and overdue follow-ups - never added together) and the referral list with a status filter; medical officers start on "Waiting for my approval". |
| `/referrals/new?childId=&sessionId=&category=&recommended=1` | New referral. From a screening result the area is fixed and "screening rules recommend it" is offered only when the current result recommends a referral. Priority is a suggestion. Facility optional (required before issue). Emergency notice. One operation id per form (safe retries); a duplicate shows "open the existing referral". |
| `/referrals/[referralId]` | Status, priority, origin, facility, timeline (each outside update labelled with its source and "verified" / "not verified"), reassessment after screening corrections, and the allowed actions: approve (priority, facility incl. out-of-district with reason), reject, choose facility, issue (consent message if missing), record an update (what happened + who told you; appointment date/time), close, undo the last update, cancel - each needing a reason where the API requires one. Follow-ups of the referral and adding one. |
| `/referrals/follow-ups` | My tasks / overdue / all in my areas. |
| `/referrals/follow-ups/[followUpId]` | Task details, history and allowed actions: start, complete (outcome required; "does not close the referral"), change the date (reason), mark missed (reason), cancel (supervisor / medical officer). |

Entry points: dashboard ("Referrals"; "Manage follow-ups" now works for users with follow-up rights;
the pending follow-ups / referrals metrics are real), "Create referral" on a screening result, and
referral / follow-up notifications.

## Facility choice

Only facilities returned by `GET /facilities?childId=`: in-district first; inactive, unverified or
not-accepting facilities are counted but cannot be chosen. Details show only verified directory
information (type, area, address, phone, verified services). Nothing is pre-selected and there is
no "nearest" ranking. Approvers can show out-of-district facilities and must give a reason.

## Tests

`tests/screens/referrals.test.tsx` (13) with the fake API `tests/support/fakeReferrals.ts`. The
Step 4 dashboard tests now expect real counts and "not for your role" on follow-ups for a worker
without follow-up rights; the start-up network test includes `GET /dashboards/referrals`.

Dates and times are typed (YYYY-MM-DD, HH:MM); no date picker yet. Hindi text drafted, needs
translator review.
