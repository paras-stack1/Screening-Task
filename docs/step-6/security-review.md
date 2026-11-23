# Step 6 Security Review - Four-D Screening

> Date: 2026-11-22/23. Scope: screening database rules, protocol and session API, worker-app
> screens. Method: code review against the Step 6 brief (section 15), plus automated tests and
> mutation checks; every claim below cites a test. **Not done:** external penetration test, load
> test, device testing.

## 1. Controls

| Area | Control | Evidence (test) |
|---|---|---|
| Authentication | Every screening route requires a valid access token (Step 3 middleware); invalid, forged, `alg:none` and expired tokens give 401 | `tests/apiSecurity.test.ts` route inventory (16 screening routes, S6-004); app: silent refresh on expiry (`screening.test.tsx` "session expiry") |
| Role permission | Writes need `screening.conduct`, reads `child.read`; protocols need either. District/state admins have neither. Denials are audited (`authz.denied`) | `screeningSessions.test.ts` "enforces permission and area", "lets other authorised users read…" |
| Area scope (BOLA / IDOR) | Every session, category, measurement and history request is resolved through the child's **current** area; outside scope = 404, the same as non-existent, audited `screeningSession.access_denied` / `child.access_denied` | "hides sessions outside the caller area (404, audited) for every route" (8 routes); mutation M4 (scope check removed → caught) |
| Nested resource ownership | A measurement id must belong to the session in the path; question ids to the category's protocol version; category rows to the same session (service + trigger) | "refuses a measurement id from another session"; "rejects answers to a question of another protocol version or another session" |
| Object ownership | Only the conducting worker may change a session (403 `NOT_SESSION_OWNER`, audited) | "only the conducting worker write"; mutation M1 |
| Consent | SCREENING consent asserted at start **and** inside every write transaction; refused, withdrawn or invalid consent → 403, audited; DB trigger requires a granted SCREENING consent of the same child on every session | "blocks screening without consent…", "cancels … consent withdrawn mid-session"; DB "requires a granted, not withdrawn SCREENING consent of the same child"; mutation M3. No media is collected in Step 6 |
| Mass assignment | Strict schemas: worker, age, area, consent id, status, timestamps, recorder, completion are never accepted | `screeningSessionRules.test.ts` mass-assignment cases; DB "rejects client-supplied server fields"; app sends only `childId` + submission id (`screening.test.tsx`) |
| Concurrency and duplicates | Row lock + optimistic `version` (409); one open session per child (partial unique index); idempotent start (`clientOperationId`) and completion | "two saves with the same version…", "two completions at once…", "two starts for one child…"; mutation M2, M5 |
| Data integrity | Triggers and CHECKs: frozen approved content, lifecycle order, demo never approvable, one ACTIVE protocol per age band, final sessions immutable, no deletes, answer state = value rules, insert-only measurements, measurement child = session child | `screeningFoundation.test.ts` (21 integrity tests, run as the DB owner) |
| Database account | Runtime account: no TRUNCATE on any screening table; no DELETE on sessions, categories, measurements | Verified read-only with `has_table_privilege` on the dev DB (6B) |
| Input validation | Zod on params, query and body; decimal strings for measurements (no NaN/Infinity/exponent); per-question type checks; 1 MB body limit; allow-listed filters, no dynamic sorting | `screeningSessionRules.test.ts`; DB "rejects invalid numbers…", "validates values against the question…" |
| Error handling | Stable error codes, no SQL or stack traces; trigger violations → 409 `INTEGRITY_RULE_VIOLATION` (S6-002) | `errors.test.ts` "maps a database integrity-rule violation…" |
| Audit | started, category_started, responses_saved (counts), category_completed/reopened/notes_updated, measurement_added/corrected, completed, cancelled, write_denied, access_denied, consent.check_denied, protocol status changes. Same transaction as the change; append-only table | "audits saves with counts only - never values or notes" (asserts no answer text or child name in any audit row) |
| Logging | Request log has method, path, status and duration only; no bodies, no query strings; protocol integrity failures log the id only | `requestLogger.ts` (Step 3), unchanged |
| Rate limiting | Screening routes share the per-user child-data read/write limiter | "applies the shared per-user child-data write limit to screening writes" |
| App | No screening data stored on the device (memory-only query cache, cleared on sign-out); unsaved-answer guard; double-submit guards; API decides eligibility | `screening.test.tsx`, `screeningComplete.test.tsx`; mutations F1-F4 |
| Clinical safety | No diagnosis/classification/recommendation anywhere; `screeningRulesApplied: false`; unknown/not assessed never stored or shown as "No"; demo content flagged on every screen; workflow states not shown in green | app "never says diagnosed/healthy" assertion; `answerDraft.test.ts`; DB "keeps answer state and value consistent" |

## 2. Audit findings from Phase 1 (initial-audit.md section 5)

| # | Finding | Status |
|---|---|---|
| W1 | Measurement child could differ from session child | **Fixed** (trigger; test) |
| W2 | Answer could reference another protocol's question | **Fixed** (service + trigger; tests) |
| W3 | Approved protocols editable in place | **Fixed** (triggers; tests) |
| W4 | Shared ApprovalStatus enum | **Fixed** (separate `ProtocolStatus`) |
| W5 | Wording outside versioning | **Fixed** (wording + hash in DB; hash re-checked before use) |
| W6 | No concurrency / duplicate-session guard | **Fixed** (version, row lock, partial unique index) |
| W7 | Supervisors can read answers | **Accepted** per decision M (`child.read`); revisit with the programme |
| W8 | Health data not encrypted at application level | **Open** - relies on database/disk encryption (infrastructure decision) |
| W9 | In-memory rate limits per process | **Open** (known since Step 5) |
| W10 | Audit details must contain no health values | **Controlled** by code review + test |

## 3. Residual risks (not hidden)

1. **No approved clinical content.** Only demonstration protocols exist; production has nothing
   usable until the programme approves content (by design).
2. **Approver role is an assumption** (`screening.review` holder). The script records the
   approver; it cannot verify their clinical authority.
3. **Free-text notes** (answers, category notes, cancel reasons) could contain personal data; the
   UI warns, the API cannot detect it. They are never logged or audited.
4. **Measurement time** is the time of entry (no date picker for older recorded values).
5. **W8/W9** above; no load or state-scale performance test.
6. **Hindi text** is an engineering draft.
7. **Amendments** of completed screenings are not possible (no approved workflow).
8. Dependencies: `npm audit --omit=dev` = 24 advisories (4 high), all pre-existing (Prisma CLI
   config loader); Step 6 added no dependency. The suggested fix changes the Prisma major version,
   which is not allowed.

No Critical or High security defect is known to be open.
