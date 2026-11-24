# Step 8 - Parent Portal: architecture, plan and schema proposal

> Stages 1-2 of the Parent Portal brief (2026-11-24). Status: **APPROVED 2026-11-24** ("approve all
> recommendations": PP1-PP18 and the schema in section 5).
>
> Progress: stage 3 approved (2026-11-24). Stage 4 (invitation check, codes, activation; server side)
> implemented - sections 7-8 and [../api/parent-portal.md](../api/parent-portal.md). Stages 5-7 not started.
>
> Context: the Parent Care decisions C1-C18 in [initial-audit.md](initial-audit.md) were approved on
> 2026-11-24 ("approve all"), **except C3 (no parent accounts), which this brief replaces**: parents get
> their own accounts in a separate Parent Portal. The Parent Care content (care plans, videos,
> reminders) is shown inside this portal once built (stages 8B-8F).

## 1. Stage 1 - what exists and what it means for parent accounts

| Area | Today | Consequence |
|---|---|---|
| Staff authentication | `User` + `loginId`; Argon2id; access JWT (`typ at+jwt`, issuer, audience, 15 min) + rotating refresh tokens with family reuse detection (`RefreshSession`); web variant with httpOnly SameSite=Strict cookie (admin portal) | Reuse the **design and code patterns**, but not the same tables or audience: a parent must never be able to use a staff token, and a staff token must never open parent routes |
| RBAC | Roles and permissions only through `WorkerAreaAssignment` (area scope) | Parents have no area: their access comes from **guardian-child links**, not areas |
| Guardians | `Guardian` (name, AES-GCM encrypted phone, HMAC lookup hash, language); `ChildGuardian` link periods (relationship, primary contact, `canGiveConsent` = worker declaration, ended links kept) | Reuse: a parent account belongs to one guardian; access follows active links |
| Consent | Purpose-specific, append-only (Step 5) | Account activation is **not** consent; kept separate |
| Password policy | 8-128 characters, small common-password list, no composition rules | Reuse; also reject passwords containing the phone number |
| Rate limiting | express-rate-limit per process | Reuse; add per-phone and per-invitation limits (in the database, so they also hold across processes) |
| SMS | Not integrated; `SMS_REMINDERS` consent purpose exists | New SMS adapter interface; development mock only (section 3.4) |
| Apps | Worker app (Expo), admin portal (React + Vite) | A third client for parents (PP1) |
| Child photos | Not stored (photo capture not built) | The mock-up's child photo cannot be shown; initials avatar (PP15) |
| Staff phone numbers | Not stored | "Contact assigned worker" can show the worker's name and centre, not a phone (PP16) |

## 2. Journey (as requested)

```
Worker registers child + guardian (exists)
  -> worker opens the guardian, checks the masked mobile, confirms the guardian wants an invitation
     and confirms which children this guardian may see (each active link)        [Stage 3]
  -> invitation created (single-use token, 24 h), SMS with link sent           [Stage 3]
  -> parent opens link -> token checked -> masked mobile shown -> OTP sent       [Stage 4]
  -> OTP verified -> create password + privacy notice + terms -> account active  [Stage 4]
  -> login: mobile + password; refresh rotation; logout; forgot password (OTP)   [Stage 5]
  -> Parent Portal: only children with ACTIVE access on an ACTIVE link           [Stage 6]
```

Workers never see or set a parent password. A worker cannot change a verified mobile number
(section 3.6).

## 3. Proposed design

### 3.1 Separate parent identity

`ParentAccount` (one per guardian) with its own refresh sessions. Parent access tokens use a
**different audience** (`balswasthya-parent-portal`) and carry `role: PARENT_GUARDIAN`; the staff
`authenticate` middleware rejects them by audience, and the new `authenticateParent` middleware
rejects staff tokens. The role is fixed by the server - there is no API that sets or changes it.

### 3.2 Invitations

- 32 random bytes (`crypto.randomBytes`), base64url; only the SHA-256 hash is stored.
- Expiry configurable (`PARENT_INVITE_TTL_HOURS`, default 24); single use; a new invitation revokes
  older open ones for the same guardian.
- Link: `${PARENT_PORTAL_URL}/invite#<token>` - the token is in the URL **fragment**, so it never
  reaches server or proxy logs; the portal sends it in a POST body (`/parent/invitations/validate`
  is therefore POST instead of the suggested GET). `PARENT_PORTAL_URL` must be HTTPS in production.
- Bound to guardian (and its verified phone at send time). Rate limit: 3 invitations per guardian
  per day, 30 per worker per hour (assumptions, configurable).
- SMS text: "BalSwasthya: you are invited to the parent portal. Link valid 24 hours: <link>" - no
  child name, no health information.

Statuses: `NOT_INVITED` (no invitation), `INVITATION_PENDING` (created, SMS not delivered or no
provider), `INVITATION_SENT`, `ACTIVATED`, `EXPIRED` (computed from the expiry), `REVOKED`.

### 3.3 OTP

- 6 digits from `crypto.randomInt`; stored as HMAC-SHA256 with a server key (never plain, never
  returned, never logged); expiry `PARENT_OTP_TTL_MINUTES` (default 5); single use.
- 5 wrong attempts -> the challenge is dead; a new code after 60 s; at most 5 codes per phone per
  hour and 20 per IP per hour (assumptions). Responses never reveal whether a number is registered.
- Purposes: invitation, password reset, phone change.

### 3.4 SMS adapter

`SmsSender` interface with `send(to, templateId, params)`. Adapters:
- `mock` - **development and tests only**: writes the message to the API log as
  `[DEV SMS to +91******1234] ...` only when `NODE_ENV !== 'production'`; the API refuses to start
  in production with `SMS_PROVIDER=mock`.
- real provider - **not built** until the programme chooses one (DLT-registered templates are
  required in India). Without it, production invitations stay `INVITATION_PENDING` with a clear
  "SMS not configured" message; nothing is reported as sent.

Every SMS is recorded in an `SmsMessage` outbox row (template, masked number, status, provider id) -
never the OTP or the token.

### 3.5 Passwords, sessions, reset

- Argon2id and the existing policy; also reject passwords that contain the phone number.
- Login: mobile + password; generic "mobile number or password is incorrect"; dummy hash on unknown
  numbers (same timing); account lock after repeated failures (as for staff).
- Access token 15 min; refresh token rotation with reuse detection (copy of the staff design) in
  `ParentRefreshSession`; logout revokes the session; password reset and phone change revoke all.
- App storage: SecureStore on Android / iOS; on the web build, refresh token in an httpOnly,
  SameSite=Strict, Secure cookie (as the admin portal).
- Forgot password: always "if this number has an account, we sent a code"; OTP -> new password.

### 3.6 Phone number protection

Once a guardian has a pending invitation or an active account, the guardian's phone **cannot** be
edited through the normal guardian edit (409). Change only through a "change mobile number" flow:
worker starts it, an OTP goes to the **new** number, the parent enters it (in person), the account is
re-bound, all sessions end, everything audited.

### 3.7 Guardian-child access

`GuardianChildAccess` per `ChildGuardian` link: `PENDING` (worker confirmed at invitation) ->
`ACTIVE` (account activated) -> `REVOKED` (worker / supervisor with reason, or automatically when the
link ends). A parent sees a child only if: their account is active **and** the access row is ACTIVE
**and** the link is still active (not ended) **and** the child is not deleted. Every parent API
derives the guardian from the token and checks this per request - never from a client child id alone
(404 for anything else, audited). One guardian may see several children; one child may have several
guardians, each with their own access.

### 3.8 What a parent may see (stage 6)

Child name, age, the worker's name and centre, follow-up and appointment **dates** (with facility
name), and - once Parent Care exists - the child's care plan and approved videos. **Not** shown in
this step: screening answers or results, review notes, referral reasons, other guardians' details
(PP12).

### 3.9 Privacy and consent

Activation shows a versioned privacy notice and terms (placeholder wording - legal review needed under
the DPDP Act and rules in force); acceptance version and time are stored. Activation grants **no**
health-data consent; consents stay as recorded in Step 5.

## 4. Decisions needed

Recommended option first.

| # | Topic | Recommendation | Alternatives |
|---|---|---|---|
| **PP1** | Parent client | New Expo app `apps/parent-app` (Android first, plus Expo **web** build so the SMS link opens in any browser) | Parent mode inside the worker app; web-only portal |
| **PP2** | Identity | Separate `ParentAccount` + `ParentRefreshSession`; separate token audience; role `PARENT_GUARDIAN` fixed by the server | Parent rows in the staff `User` table |
| **PP3** | Binding | One account per guardian; verified phone unique among active accounts | Several accounts per guardian |
| **PP4** | Who invites | New permission `guardian.invite` (fieldwork) for ASHA, Anganwadi worker, medical officer; only for children in their area; guardian must have an active link and a phone | Reuse `child.update` |
| **PP5** | Invitation token | Section 3.2 (fragment link, POST validation, 24 h, single use, newest wins) | Token in the query string (gets logged) |
| **PP6** | OTP limits | Section 3.3 (6 digits, 5 min, 5 attempts, 60 s resend, 5 per hour per phone) | Other values |
| **PP7** | SMS | Adapter interface + development mock only; production stays "SMS not configured" until a provider and DLT templates are approved | Build a specific provider now |
| **PP8** | Passwords | Existing policy + "no phone number in password" | Stricter rules |
| **PP9** | Sessions | Section 3.5 | Long-lived tokens |
| **PP10** | Enumeration | Generic answers for login, reset, OTP; dummy hashing; per-phone and per-IP limits | - |
| **PP11** | Children a parent sees | Section 3.7: the worker confirms each child link at invitation (and later per new child); access ends with the link or by revocation | All children of the guardian automatically |
| **PP12** | Data shown | Section 3.8 (no results or clinical notes in this step) | Show screening results with an explanation |
| **PP13** | Privacy / terms | Versioned notice + terms accepted at activation; placeholders flagged for legal review; no consent granted | Combine with consent |
| **PP14** | Phone change | Section 3.6 (locked; OTP to the new number) | Allow worker edits (unsafe) |
| **PP15** | Child photo (mock-up) | Initials avatar - photos are not stored | Build photo capture now (consent + storage) |
| **PP16** | "Get assistance" | Worker's name and centre / village; no personal numbers | Add official work phones to staff accounts |
| **PP17** | Audit | All account events audited with ids and masked phone; new nullable `AuditLog.actorParentAccountId` | Put the parent id in details only |
| **PP18** | Stages | As in the brief: **3** invitations (API + worker app action), **4** OTP + activation, **5** login / sessions / reset / phone change, **6** access control + Parent Portal app screens, **7** security and integration tests + docs. Each stops for review. Parent Care content (8B-8F) follows and plugs into the portal | Different order |

## 5. Stage 2 - schema change proposal

One additive migration; no existing table is reshaped. Prisma 6.

| Table | Fields (main) | Rules |
|---|---|---|
| `ParentAccount` | id, guardianId (unique FK), phoneLookupHash (verified number), passwordHash, status `ACTIVE / LOCKED / DISABLED`, failedLoginCount, lockedUntil, passwordChangedAt, privacyNoticeVersion, termsVersion, acceptedAt, activatedAt, lastLoginAt, timestamps | Partial unique: one active account per phone hash; no delete |
| `ParentInvitation` | id, guardianId, tokenHash (unique), status `PENDING / SENT / USED / REVOKED`, expiresAt, createdById (worker), sentAt, phoneVerifiedAt, usedAt, revokedAt, revokedReason, timestamps | One open invitation per guardian (partial unique); token hash only; no delete |
| `OtpChallenge` | id, purpose `INVITATION / PASSWORD_RESET / PHONE_CHANGE`, invitationId?, parentAccountId?, phoneLookupHash, codeHash, expiresAt, attempts, maxAttempts, consumedAt, createdAt | Code hash only; consumed once |
| `ParentRefreshSession` | as `RefreshSession`, with parentAccountId | Rotation + reuse detection |
| `GuardianChildAccess` | id, childGuardianId (FK), guardianId, childId, status `PENDING / ACTIVE / REVOKED`, grantedById, grantedAt, activatedAt, revokedById, revokedAt, revokeReason | One non-revoked row per link (partial unique); history kept |
| `SmsMessage` | id, guardianId?, purpose `INVITATION / OTP / REMINDER`, templateId, maskedTo, status `QUEUED / SENT / FAILED / NOT_CONFIGURED`, provider, providerMessageId, error, timestamps | Never stores the OTP or token; also used later by Parent Care reminders (C11) |
| `AuditLog` | + nullable `actorParentAccountId` | Still insert-only |

Grants: no DELETE / TRUNCATE for the runtime account on the new tables (as Step 7). New permission
`guardian.invite` seeded for ASHA, ANGANWADI_WORKER, MHT_MEDICAL_OFFICER. New configuration:
`PARENT_PORTAL_URL`, `PARENT_JWT_AUDIENCE`, `PARENT_INVITE_TTL_HOURS`, `PARENT_OTP_TTL_MINUTES`,
`OTP_HMAC_KEY`, `SMS_PROVIDER` (secrets only in the server environment, never in an app).

## 6. External dependencies

SMS provider and DLT-registered templates; approved privacy notice and terms (DPDP); the trusted
parent-portal domain with HTTPS; Hindi review of all parent-facing text; programme confirmation of
what parents may see (PP12); decision on official worker contact numbers (PP16).

## 7. Stage 3 - worker invitations (approved 2026-11-24)

- Migration `20261125100000_step8_parent_portal_accounts`: all section 5 tables, partial unique indexes,
  CHECKs and protection triggers; runtime role has no DELETE / TRUNCATE on them.
- Permission `guardian.invite` (ASHA, AWW, MO). API: `GET/POST /guardians/:id/invitations`,
  `POST /guardians/:id/invitations/:invitationId/revoke` ([API](../api/parent-portal.md)).
- Token: 32 random bytes (base64url), SHA-256 stored, link fragment, 24 h, newest revokes older,
  limits 3 / guardian / day and 30 / worker / hour. Never returned, logged or audited.
- SMS: `SmsSender` interface; `none` (production default, `NOT_CONFIGURED`, nothing claimed as sent)
  and a development-only `mock` (local outbox file; refused by the production configuration check).
- Worker app: Parent Portal card on the guardian page (status, masked number, child choice,
  guardian agreement, send, cancel), English and Hindi.
- Not yet: public invitation validation, OTP, activation, parent login (stages 4-5); the parent app
  (stage 6). `OTP_HMAC_KEY`, `PARENT_OTP_TTL_MINUTES` and `PARENT_JWT_AUDIENCE` arrive with stages 4-5.

## 8. Stage 4 - invitation check, codes and activation (implemented, waiting for review)

- Public routes under `/api/v1/parent`: `legal`, `invitations/validate`, `invitations/send-otp`,
  `invitations/verify-otp`, `activate` ([API](../api/parent-portal.md)). Per-IP limits on each.
- Codes per PP6 (HMAC only, 5 min, 5 attempts counted atomically, 60 s resend, 5 per phone per hour,
  10 per invitation); `OTP_HMAC_KEY` and `PARENT_OTP_TTL_MINUTES` added (key required in production).
- 15-minute activation ticket (HMAC-signed, bound to invitation + consumed code) instead of a new
  table; the link alone never activates.
- Activation: password policy + "not the mobile number", Argon2id; current privacy notice and terms
  (placeholder text, refused in production); single-use invitation; worker-confirmed children become
  ACTIVE; audit as the parent (`AuditLog.actorParentAccountId`); no consent granted; no auto sign-in.
- Known limits: a DISABLED account cannot be re-activated yet (`409 ACCOUNT_EXISTS`, stage 5/6); when a
  link ended before activation, the access row is revoked in the name of the worker who granted it
  (no system user exists; reason text says why). Per-IP counters are per API process (as staff login).
