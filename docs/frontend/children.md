# Worker App - Children, guardians and registration (Step 5)

Screens built on the API in [../api/children.md](../api/children.md). Code:
`apps/worker-app/app/(app)/children/` (routes) and `apps/worker-app/src/features/children/`.

## Screens

| Route | Screen | Shown to (from `/auth/me`; the API checks again) |
|---|---|---|
| `/children` (tab "Children") | List and name search, 20 per page, "Show more" | `child.read`; others see "Not available for your role" and **no request is made** |
| `/children/register[?siblingOf=id]` | Registration: form -> review -> confirm | `child.create` (button and dashboard card) |
| `/children/:childId` | Profile: child, guardians (masked phone), registration, screening placeholder | `child.read` |
| `/children/:childId/edit` | Correct name, date of birth, sex | `child.update` |
| `/children/:childId/add-guardian` | Add a guardian | `child.update` |
| `/children/:childId/link/:relationshipId` | Change relationship / consent authority / primary contact; remove link | `child.update` |
| `/children/guardian/:guardianId` | Guardian details (full phone), edit | `child.read` / `child.update` |

Hidden buttons are a convenience only: every request is authorised by the API. URLs contain only
opaque ids, never names or phone numbers (`src/features/children/routes.ts`).

## Registration flow

1. **Form** in short sections: child, area (preselected when the worker has only one), guardian
   and relationship. Required fields are marked `*`.
   - Date of birth: either the exact date (three number boxes DD / MM / YYYY - no date-picker
     dependency, works with screen readers) or **"No, give approximate age"** (years + months).
     An approximate age is sent as `ageEstimate`; the app never invents a date.
   - "Is the exact date known?" and "Can this person give consent?" have **no default** answer.
   - Sex at birth is optional (not answered = "Not recorded").
2. **Review**: everything the worker entered, to read back to the family.
3. **Confirm**: one request. Success is shown only after the API confirmed it.

Duplicate handling (API decides; the app only shows what the API returns, always in-scope only):
- `POSSIBLE_DUPLICATE`: the matching children are listed with "Open this record". "This is a
  different child" asks for confirmation, then re-sends with `confirmNotDuplicate`.
- `POSSIBLE_DUPLICATE_GUARDIAN`: shows the guardian with a masked number. "Use this guardian"
  switches to the existing guardian (no duplicate person); "This is a different person" re-sends
  with `confirmNewGuardian`.

Safe retries: each submission carries a `clientOperationId`. The same content keeps the same id,
so pressing Confirm again after a network failure cannot create a second child; changed content
gets a new id. Buttons are blocked while a request is in flight (double taps send one request).
Form values stay in memory while the screen is open (also after errors) and are **never saved on
the phone**.

## Other rules

- **Estimated dates** are shown only as "About N years M months old (date of birth not known)",
  never as a date. Exact dates are shown as DD/MM/YYYY with the calendar age.
- **Phone numbers** are masked (`+91 ••••••3210`) everywhere except the guardian screen, which the
  API audits. The guardian query is never cached (`gcTime: 0`).
- **Edits** send the version the worker started from (`expectedUpdatedAt`). If someone else saved
  the record meanwhile, the app says so and offers "Reload" - nothing is overwritten.
- **Consent authority changes** and **removing a guardian** ask for confirmation; removal needs a
  short reason (the screen asks not to write names or numbers). The last guardian cannot be
  removed (the API refuses; the app explains).
- **Caching**: child data lives only in the in-memory TanStack Query cache, keyed by the user id,
  cleared at sign-out, refetched after every change.
- **Screening**: the profile says screening is not available yet. No results are shown or invented.

## Hindi review

All new strings (`children.*`, `common.yes/no`, `nav.children`) were drafted in Hindi by the
engineering team and **need review by a qualified translator / programme staff** before field
use, like the Step 4 strings (see [localization.md](localization.md) section 4).

## Tests

- `tests/screens/children.test.tsx` (27 tests): list, search, role without access, every
  registration validation, success, estimated age, network retry with the same id, double tap,
  duplicate child and guardian flows, no areas, Hindi, profile masking, read-only role, route
  links, not found, stale edit, last-guardian refusal, consent-authority confirmation, guardian page.
- `tests/children/childValidation.test.ts` (18 tests): date boxes, India "today", age limits,
  request building, display, submission ids, URL encoding.
- `tests/support/fakeChildren.ts`: in-memory children API that validates requests with the real
  shared contracts (it caught a non-UUID test fixture).
