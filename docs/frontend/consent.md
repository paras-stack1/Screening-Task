# Worker App - Consent screens (Step 5)

Built on [../api/consent.md](../api/consent.md). Code: `apps/worker-app/src/features/consent/` and
`apps/worker-app/app/(app)/children/[childId]/consent/`.

> The notice wording is a **placeholder** (not approved). The capture screen shows a prominent
> "PLACEHOLDER WORDING - NOT APPROVED" banner, and production refuses placeholder notices.

## Screens

| Route | Purpose | Shown to |
|---|---|---|
| Child profile, "Consent" section | Status of all 7 purposes from the API | `child.read` |
| `/children/:id/consent/record` | Record ONE decision for ONE purpose | `consent.record` |
| `/children/:id/consent` | Current status + full history (newest first) | `child.read` |
| `/children/:id/consent/withdraw/:consentId` | Record a withdrawal of the current grant | `consent.record` |

## Display rules

- Only **"Agreed"** is green. "Not recorded" is grey, "Did not agree" red, "Withdrawn" and "No
  longer valid" amber, always with an icon and text. Missing consent never looks like permission.
- "No longer valid" shows the API's reason (guardian unlinked, authority removed, notice retired /
  not approved).
- A warning appears on the profile when any consent was withdrawn or is no longer valid.
- The app **never decides** whether an activity is permitted; it shows the API's status. Future
  screening/media/AI screens must rely on the API's `CONSENT_REQUIRED` answer.

## Capture flow

1. Guardian: only guardians marked "can give consent" are offered (none -> explained, no form).
   No preselection.
2. Purpose: one of seven, never bundled. The notice is fetched only after a purpose is chosen, in
   the guardian's preferred language (switchable). Optional purposes say so; screening says it is
   about programme participation.
3. Decision: an unchecked "I have read and explained this notice" box, "Agreed / Did not agree"
   (no default), the method (no default; the hint says a method does not by itself make consent
   legally valid), optional paper-form number (no personal data).
4. Confirmation dialog summarising guardian, purpose and decision, then one request with the
   exact `templateId` shown. Time and worker are set by the API.
5. If the notice changed meanwhile (`NOTICE_OUTDATED`), the new wording is loaded, the
   "explained" box is cleared, and the worker must explain again. Nothing was recorded.

Retries reuse the same submission id for the same content; buttons block double submission.

## History and withdrawal

- Every decision is listed (decisions are never edited or deleted), with guardian, method, notice
  version and language, a "placeholder wording" note, evidence reference, date and worker, and the
  withdrawal line when withdrawn.
- "Record withdrawal" is offered only on the current, not-withdrawn grant of a purpose. The
  worker chooses which authorised guardian is withdrawing and how (no defaults), confirms, and
  other purposes are unchanged. Conflicts (already withdrawn, newer decision) are explained.

## Tests

`tests/screens/consent.test.tsx` (14): overview colours and "never agreed when missing",
withdrawal warning, read-only role, no preselection and required answers, full capture with
confirmation and the exact request body, authority filtering, outdated notice re-explanation,
missing notice, Hindi, history and withdraw-button rules, withdrawal flow, repeated withdrawal,
dashboard recent list for permitted and non-permitted roles.
