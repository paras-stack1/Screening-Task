# Step 8 - Parent Portal: final report (stages 1-7)

> Written for: the BalSwasthya team (developers, reviewers and the programme lead) and anyone
> deploying or reviewing the Parent Portal. Date: 2026-11-26. Synthetic data only in all tests.
>
> Design and decisions: [parent-portal-plan.md](parent-portal-plan.md) (PP1-PP18, approved).
> API reference: [../api/parent-portal.md](../api/parent-portal.md). App:
> [../../apps/parent-app/README.md](../../apps/parent-app/README.md).

## 1. What was built

Parents and guardians get their own account in a separate Parent Portal (Android + web). The
journey from the brief is implemented end to end:

worker registers child -> guardian recorded -> **worker invites** (only for a child in their area,
after confirming the guardian agreed and which children to share) -> **SMS with a secure link** ->
parent opens the link -> **code sent to the guardian's number** -> parent enters the code ->
**parent creates their own password** and accepts the privacy notice and terms -> account activated
-> **sign in with mobile number + password** -> the parent sees only the children the worker shared.

Workers never create, see or reset a parent password. Activation grants no consent for any health
data use. No child health information appears in links, SMS, or anywhere before sign-in.

| Stage | Content | Branch / PR | Status |
|---|---|---|---|
| 1-2 | Architecture, decisions PP1-PP18, schema proposal | `958c85a` on main | Approved |
| 3 | Worker invitations, secure tokens, SMS adapter, worker card | `379b7b8` on main | Approved |
| 4 | Link check, one-time codes, activation | code on main (`271acc0`, `e6d7728`); docs PR #1 | Approved |
| 5 | Sign-in, sessions, logout, reset, number change | PR #2 | Approved |
| 6 | Shared-children API (IDOR-safe), Parent Portal app, worker sharing | PR #3 | Approved |
| 7 | End-to-end security tests, this report | PR #4 | For review |

PRs are stacked: merge #1, #2, #3, #4 in order. Nothing was pushed to `main` directly after the
branch + PR rule was set.

## 2. Files

**API (`services/api`)**
- `prisma/schema.prisma` + migration `20261125100000_step8_parent_portal_accounts` (tables, partial
  unique indexes, CHECKs, protection triggers).
- `src/modules/parent-portal/`: `invitations.{service,routes}.ts` (worker invite / status / revoke /
  share / stop sharing), `onboarding.{service,routes}.ts` (link check, codes, activation),
  `parentLegal.ts` (versioned privacy notice and terms - placeholder text), `parentAuth.{service,routes}.ts`,
  `parentSession.service.ts`, `parentAuthenticate.ts`, `parentChildren.{service,routes}.ts`.
- `src/integrations/sms/smsSender.ts` (SMS interface, "none" sender, development-only mock).
- Changed: `config/env.ts`, `config/security.ts`, `app.ts`, `routes/index.ts`,
  `modules/access-control/{permissions,roles}.ts` (`guardian.invite`),
  `modules/guardians/guardians.service.ts` (verified number locked; link end revokes access),
  `modules/audit/audit.service.ts` (`actorParentAccountId`), `.env.example`.
- Tests: `tests/db/parentInvitations.test.ts`, `parentOnboarding.test.ts`, `parentAuth.test.ts`,
  `parentChildren.test.ts`, `parentPortalSecurity.test.ts`, `tests/smsSender.test.ts`, additions to
  `tests/env.test.ts`, `tests/apiSecurity.test.ts`, `tests/db/authorization.test.ts`.

**Shared contracts** - `packages/shared-contracts/src/parentPortal.ts`.

**Parent Portal app (`apps/parent-app`, new)** - Expo SDK 58 / Expo Router: `app/` (invite, verify,
create-password, activated, login, forgot-password, `(portal)/` home, children, follow-ups,
assistance, care-plan, videos, settings, change-password, change-phone), `src/` (API client, session,
storage, i18n en/hi, UI components), `tests/`.

**Worker app** - `ParentPortalCard.tsx` on the guardian page (invite, status, cancel, share / stop
sharing), API calls, hooks, en/hi texts, tests.

**Database role** - `infrastructure/db/setup-app-role.sql`: no DELETE / TRUNCATE on the new tables.

**Docs** - `docs/step-8/initial-audit.md`, `parent-portal-plan.md`, this report,
`docs/api/parent-portal.md`, `apps/parent-app/README.md`.

## 3. Database schema

| Table | Purpose | Key rules |
|---|---|---|
| `ParentAccount` | One per guardian: verified phone hash, Argon2id password hash, status, lock, accepted notice/terms versions | One live account per verified number; no delete |
| `ParentInvitation` | SHA-256 of the token, status `PENDING/SENT/USED/REVOKED`, expiry, phone binding, creator | One open invitation per guardian; token hash, binding and expiry immutable; allowed status moves only; no delete |
| `OtpChallenge` | HMAC of the code, purpose `INVITATION/PASSWORD_RESET/PHONE_CHANGE`, expiry, attempts, single use | Attempts bounded and never decrease; consumed once; immutable code; no delete |
| `ParentRefreshSession` | Rotating refresh tokens (hash only), family, expiry, revocation | Same model as staff sessions |
| `GuardianChildAccess` | Which child a guardian may see, per guardian-child link | Must match an active link; `PENDING -> ACTIVE -> REVOKED`; one live row per link; history kept |
| `SmsMessage` | Outcome of each SMS (masked number, template, provider status) | Never the code, link or full number; no delete |
| `AuditLog` | + `actorParentAccountId` | Parent actions audited as the parent |

Permission `guardian.invite` (ASHA, Anganwadi worker, MHT medical officer).

## 4. APIs

| Area | Endpoints |
|---|---|
| Worker (staff token) | `GET/POST /guardians/:id/invitations`, `POST .../invitations/:invitationId/revoke`, `POST /guardians/:id/child-access`, `POST .../child-access/:childId/revoke` |
| Onboarding (public, token in body) | `GET /parent/legal`, `POST /parent/invitations/validate`, `send-otp`, `verify-otp`, `POST /parent/activate` |
| Parent sign-in | `POST /parent/auth/login`, `refresh`, `logout`, `forgot-password`, `reset-password`; browser `/parent/auth/web/{login,refresh,logout,change-password}` |
| Signed-in parent | `GET /parent/auth/me`, `POST logout-all`, `change-password`, `phone-change/start`, `phone-change/confirm`, `GET /parent/children`, `GET /parent/children/:childId` |

Full request/response and error codes: [../api/parent-portal.md](../api/parent-portal.md).

## 5. Authentication flow

1. **Invite** (worker, `guardian.invite`, child in area): 32 random bytes -> link
   `${PARENT_PORTAL_URL}/invite#<token>`; only SHA-256 stored; 24 h; newest revokes older; 3 per
   guardian per day, 30 per worker per hour. SMS through the configured sender after commit.
2. **Link check**: the token travels only in POST bodies; unknown / expired / used / replaced /
   cancelled links, a changed guardian number or an existing account give one `404`.
3. **Code**: 6 digits (`crypto.randomInt`), HMAC stored with `OTP_HMAC_KEY`, 5 minutes, 5 attempts
   counted atomically, resend after 60 s, 5 per phone per hour, 10 per invitation.
4. **Activation ticket**: a correct code returns a 15-minute HMAC-signed ticket bound to the
   invitation and the consumed code; the link alone never activates.
5. **Activation**: password policy (8-128, not common, not the mobile number), Argon2id; current
   privacy notice and terms accepted (placeholder wording refused in production); invitation used
   once; worker-confirmed children become visible; no consent granted; audited as the parent.
6. **Sign-in**: mobile number + password; separate token audience; role fixed `PARENT_GUARDIAN`;
   15-minute access token (memory only), rotating refresh token (Android SecureStore / browser
   httpOnly SameSite=Strict cookie), 30 days idle, 90 days absolute; replay ends the session family.
7. **Recovery and changes**: forgot/reset password by code (same answer for every number);
   password change ends other sessions; number change by password + code to the new number.

## 6. Security protections (brief requirement -> implementation)

| Requirement | Implementation |
|---|---|
| Parent controls own account; workers never create or know passwords | Password set only by the parent at activation/reset; no staff endpoint touches parent passwords |
| Only workers authorised for the child's area invite | `guardian.invite` + child in the caller's area; otherwise 404 + DENIED audit |
| Workers cannot change a verified number | `409 PHONE_VERIFIED_BY_PARENT`; parent-only change with a code to the new number |
| Secure single-use tokens, hash only, expiry, bound to guardian, older revoked, rate-limited, never logged | Section 5 steps 1-2; DB triggers make token fields immutable; tests prove no raw token in logs or tables |
| No child health information in URLs / SMS | Fixed SMS templates (link or code only); token in the fragment; tests check SMS text |
| No fake invitation URLs | Invitations refused (503) until `PARENT_PORTAL_URL` is configured; https in production |
| OTP: secure, short, single use, limited attempts, rate-limited, hash only, never returned or logged | Section 5 step 3; atomic attempt counting (parallel guesses tested) |
| Mock SMS only for development; no dev OTPs in production | `SMS_PROVIDER=mock` refused by the production config check; without a provider nothing is sent and nothing is claimed as sent |
| Strong passwords, Argon2id, never plaintext | Policy + Argon2id; tests check the stored hash format |
| No consent granted by activation | Activation creates no consent; the screen says so |
| Separate role; parent cannot choose a role | Separate audience; `role` fields rejected (400); staff and parent tokens refused on each other's routes |
| Multiple children per guardian, multiple guardians per child, verified relationships, revocation | `GuardianChildAccess` per link; worker share / stop sharing; ending a link revokes access |
| Never rely on a child id from the frontend (IDOR/BOLA) | Every parent query filtered by the account's own guardian and live access; same 404 for anything else; audited |
| Enumeration protection | Identical sign-in, forgot-password and reset failures; dummy Argon2 check for unknown numbers |
| Session expiry, refresh rotation, logout, protected routes | Section 5 step 6; portal screens mounted only with a session |
| Audit logging | Invitations, codes, activation, sign-in, reset, number change, child views and denials |
| No secrets in frontend env | Apps hold only the API address (`EXPO_PUBLIC_API_BASE_URL`) |

## 7. Tests required by the brief

| # | Brief test | Where (file > test) |
|---|---|---|
| 1 | Authorised worker invites | `parentInvitations` > "lets an authorized worker invite" |
| 2 | Unauthorised / out-of-area worker | `parentInvitations` > "denies a worker outside the guardian area", "refuses roles without guardian.invite" |
| 3 | Expired token | `parentOnboarding` > "gives one answer for unknown, revoked, replaced and expired links" |
| 4 | Reused token | `parentOnboarding` > "activates ... single use", "two parallel activations create exactly one account" |
| 5 | Wrong OTP | `parentOnboarding` > "wrong code counts attempts" |
| 6 | Expired OTP | `parentOnboarding` > "an expired code, a reused code and an older code are refused" |
| 7 | OTP brute force | `parentOnboarding` > "after 5 even the right code is refused", "parallel guesses never exceed the attempt limit"; `parentAuth` > "reset codes resist guessing" |
| 8 | Activation without verification | `parentOnboarding` > "is refused without a verified code" |
| 9 | Successful login | `parentAuth` > "signs in with mobile number + password" |
| 10 | Wrong password | `parentAuth` > "wrong password and unknown number give the same answer", "locks sign-in after 5 wrong passwords" |
| 11 | Multiple children | `parentChildren` > "lists every shared child of the guardian"; parent app > "lets a parent with several children choose one" |
| 12 | Cannot access another guardian's child | `parentChildren` > "cannot reach another family's child"; `parentPortalSecurity` > "ignores a guardian or child id smuggled into the query string" |
| 13 | Revoked access | `parentChildren` > "shares a sibling ... then stops sharing it", "ending the guardian-child link ends portal access" |
| 14 | Reset does not reveal the account | `parentAuth` > "forgot password answers the same for known and unknown numbers", "wrong code and unknown number look alike" |
| 15 | Logout invalidates the session | `parentAuth` > "logout invalidates the session immediately"; `parentPortalSecurity` > "after logout the same access token reaches nothing" |

Stage 7 also added `parentPortalSecurity`: no token, code, ticket or password in any log line or
stored row; no-store caching; staff and parent tokens refused on each other's routes; parent tokens
refused on worker invitation and sharing routes; extra account/guardian/role fields rejected.

## 8. Test results (actual, local run 2026-11-26)

| Suite | Result |
|---|---|
| API unit (`services/api`, vitest) | **507 / 507 passed** |
| API database (`npm run test:db`, PostgreSQL, run alone) | **488 / 488 passed** (19 files; Step 8 files: parentInvitations 15, parentOnboarding 18, parentAuth 18, parentChildren 6, parentPortalSecurity 13) |
| Parent Portal app (`apps/parent-app`, jest-expo) | **281 / 281 passed** (15 screen journeys + 266 translation/config checks). `expo export --platform web` builds (checked in stage 6). |
| Worker app (`apps/worker-app`, jest-expo) | **3385 passed, 20 skipped** (30 suites; 2 skipped suites unchanged by Step 8) |
| Admin portal (`apps/admin-portal`, vitest) | **397 passed, 5 skipped** (unchanged by Step 8) |
| Typecheck and lint | Clean: API, shared contracts, parent app, worker app |

Notes: database suites must run alone (shared database, slow Docker disk - S7-004). Earlier in
Step 8 two DB files once timed out in setup while a web build ran in parallel; alone they passed.
The worker-app tree also contained another session's uncommitted screening redesign during these
runs (not part of Step 8).

## 9. External dependencies - not production-ready until these exist

1. **SMS provider** with DLT-registered templates (India). Until then `SMS_PROVIDER=none`: nothing is
   sent and invitations stay "SMS not sent"; codes cannot be sent (`503`). **No production SMS
   functionality is claimed.**
2. **Approved privacy notice and terms** (DPDP Act review), in Hindi and English. The current text is
   a placeholder; production refuses activation until approved versions are added.
3. **Trusted Parent Portal domain with HTTPS** (`PARENT_PORTAL_URL`) and its origin in `CORS_ORIGINS`.
4. **Secrets** from a secret manager: `OTP_HMAC_KEY` (required in production), existing PII keys and
   JWT secret.
5. **Android App Links** for the production domain, if SMS links should open the Android app.
6. **Programme confirmation** of what parents may see (PP12) and of worker contact details (PP16).
7. **Hindi review** of all parent-facing text by a native-speaking programme reviewer.
8. **Shared rate-limit store** (e.g. Redis) when the API runs as more than one instance.

## 10. Run locally

```powershell
npm run db:up; npm run db:migrate; npm run db:setup-roles; npm run db:seed
# services/api/.env: PARENT_PORTAL_URL=http://localhost:8082, SMS_PROVIDER=mock,
# OTP_HMAC_KEY=<generated, see .env.example>, CORS_ORIGINS includes http://localhost:8082
npm run dev:api          # API on :4000
npm run dev:app          # worker app (invite a guardian from the guardian page)
npm run dev:parent-web   # Parent Portal on http://localhost:8082
# Invitation links and codes appear in services/api/.dev-sms/outbox.log (development only).

npm test --workspace @balswasthya/api          # API unit tests
npm run test:db                                # API database tests (run alone)
npm test --workspace @balswasthya/parent-app   # Parent Portal app
npm test --workspace @balswasthya/worker-app   # worker app
```
