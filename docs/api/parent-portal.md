# Parent Portal API (Step 8)

Base URL `/api/v1`. Authentication, error format, rate limits and the "404 for out-of-scope" rule
are as in [children.md](children.md). Contracts: `packages/shared-contracts/src/parentPortal.ts`.
Design and decisions: [../step-8/parent-portal-plan.md](../step-8/parent-portal-plan.md) (PP1-PP18).
Examples use synthetic data.

> **Stages 3-6.** Workers invite (stage 3); parents check the link, verify their number with a
> code and activate an account (stage 4); parents sign in, manage sessions, reset their password
> and change their number (stage 5); parents see the children shared with them and workers control
> sharing; the Parent Portal app (`apps/parent-app`) uses all of it (stage 6). **No real SMS provider is configured**: in production nothing is sent and invitations stay
> `INVITATION_PENDING` with SMS status `NOT_CONFIGURED`.

## Worker invitation endpoints (staff access token)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/guardians/:guardianId/invitations` | `child.read` | Portal status of a guardian |
| POST | `/guardians/:guardianId/invitations` | `guardian.invite` | Create (and send) an invitation |
| POST | `/guardians/:guardianId/invitations/:invitationId/revoke` | `guardian.invite` | Cancel an open invitation |

`guardian.invite` is held by ASHA, Anganwadi worker and MHT medical officer (PP4). The permission is
not enough by itself: the guardian must have an **active link to a child inside the caller's
assigned areas** (for that permission), otherwise the answer is `404` and a `DENIED` audit record
is written. An unknown guardian id gives the same `404`.

### Create

```json
POST /guardians/7b0d.../invitations
{ "guardianAgreed": true, "childIds": ["3f1e..."] }
```

- `guardianAgreed` must be `true`: the worker confirms the guardian asked for or agreed to the SMS.
- `childIds` (1-20): the children this guardian will see after activating (PP11). Each must be an
  active link of this guardian with the child in the caller's area (`422 CHILD_NOT_LINKED`).
- Any other field is rejected (`400`). The worker cannot set a phone number, token or password.

What happens:

1. Checks: phone recorded (`422 GUARDIAN_PHONE_MISSING`), no active parent account
   (`409 ALREADY_ACTIVATED`), portal address configured (`503 PARENT_PORTAL_NOT_CONFIGURED`),
   limits - 3 invitations per guardian per 24 h, 30 per worker per hour (`429 INVITATION_LIMIT`).
2. In one transaction: the guardian's older open invitation is revoked ("Replaced by a new
   invitation"), earlier not-yet-activated child choices are revoked, new `PENDING` child access
   rows are created, the invitation is stored with **only the SHA-256 of the token**, the expiry
   (`PARENT_INVITE_TTL_HOURS`, default 24) and the guardian's phone lookup hash; audit
   `parent_invitation.created` (ids, masked number, no token).
3. After commit the SMS is sent through the configured sender: link
   `${PARENT_PORTAL_URL}/invite#<token>` (token after `#`, so it never reaches server logs). An
   `SmsMessage` row records the outcome with the masked number only. `SENT` moves the invitation to
   `SENT`; `FAILED` / `NOT_CONFIGURED` leave it `PENDING`. Audit `parent_invitation.sms`.

`201 { "portal": ParentPortalStatus }`. **The token is never returned, logged or audited.**

SMS text (fixed template, no child name or health information):

```
BalSwasthya: aapko Parent Portal ka nimantran mila hai / you are invited to the Parent Portal. Link (valid 24 h): https://<portal>/invite#<token>
```

### Status

`200 { "portal": ParentPortalStatus }`:

| Field | Meaning |
|---|---|
| `status` | `NOT_INVITED`, `INVITATION_PENDING` (created, SMS not sent), `INVITATION_SENT`, `ACTIVATED`, `EXPIRED`, `REVOKED` |
| `maskedPhone` | e.g. `********3210`, or `null` |
| `latestInvitation` | id, created / expires / sent times, creator name, `smsStatus`, revoke reason |
| `children` | the guardian's children **in the caller's areas** with access `NONE / PENDING / ACTIVE / REVOKED` |
| `canInvite`, `blockedReason` | decided by the API: `NOT_ALLOWED` (no `guardian.invite` in this area), `NO_PHONE`, `ALREADY_ACTIVATED` |

### Revoke

`POST .../invitations/:invitationId/revoke { "reason": "Wrong number" }` (3-300 characters). Only an
open (`PENDING` / `SENT`) invitation; otherwise `409 INVITATION_NOT_OPEN`. Pending child access is
revoked with it. Audit `parent_invitation.revoked`.

## Parent onboarding endpoints (PUBLIC, stage 4)

No access token. Each call is authorised by the invitation token from the link fragment (always
in a POST body, never in a URL) and, for activation, by the ticket from a verified code. Every
route is limited per IP (per 15 minutes: validate 60, send-otp 10, verify-otp 30, activate 10).
Responses never contain the guardian's or children's names, health information, the code or the
token. Parent screens come in stage 6; these endpoints are server side only.

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/parent/legal?language=hi\|en` | - | Current privacy notice + terms (`version`, `text`, `isPlaceholder`) |
| POST | `/parent/invitations/validate` | `{ token }` | `{ valid, maskedPhone, expiresAt, phoneVerified }` |
| POST | `/parent/invitations/send-otp` | `{ token }` | `{ sent, maskedPhone, expiresAt, resendAfter }` |
| POST | `/parent/invitations/verify-otp` | `{ token, code }` | `{ verified, activationTicket, ticketExpiresAt }` |
| POST | `/parent/activate` | see below | `201 { activated, maskedPhone }` |

**Invitation check.** Unknown, expired, used, replaced or cancelled links, a guardian whose mobile
number changed after the invitation, or a guardian who already has an account all give the same
`404 INVITATION_INVALID` ("ask your health worker for a new one"). Malformed input is `400`.

**Codes (PP6).** 6 digits (`crypto.randomInt`). Only `HMAC-SHA256(OTP_HMAC_KEY, purpose:invitation:code)`
is stored; the code is never returned, logged or audited. Valid `PARENT_OTP_TTL_MINUTES` (5).
At most 5 attempts per code, counted atomically before comparing (parallel guesses cannot exceed
it); after that even the right code is refused. Only the newest code counts. Resend after 60 s
(`429 OTP_RESEND_TOO_SOON`); at most 5 codes per phone per hour and 10 per invitation
(`429 OTP_LIMIT`). Wrong code: `400 OTP_INVALID` with `details.attemptsLeft`; used, expired or
exhausted: `400 OTP_EXPIRED`. Without an SMS provider: `503 SMS_NOT_CONFIGURED` and no code is
created; without `OTP_HMAC_KEY`: `503 OTP_NOT_CONFIGURED`.

**Activation ticket.** A correct code returns a ticket valid 15 minutes, HMAC-signed and bound to
the invitation and the consumed code. Holding the link alone is never enough to activate.

**Activation (PP8, PP13).**

```json
{ "token": "...", "activationTicket": "...", "password": "...", "confirmPassword": "...",
  "privacyNoticeVersion": "draft-1", "termsVersion": "draft-1",
  "acceptPrivacyNotice": true, "acceptTerms": true }
```

- No ticket, a forged one, another invitation's or an expired one: `403 PHONE_NOT_VERIFIED`.
- Password: 8-128 characters, not common, must not contain the mobile number
  (`422 WEAK_PASSWORD`); confirmation must match (`400`). Stored as Argon2id only.
- The accepted versions must be the current ones (`409 LEGAL_VERSION_CHANGED`). The wording is a
  **placeholder**: production refuses activation (`503 LEGAL_TEXT_NOT_APPROVED`) until approved
  text is added (`services/api/src/modules/parent-portal/parentLegal.ts`).
- In one transaction: the invitation becomes `USED` (single use: a parallel second activation gets
  `404`), the `ParentAccount` is created, the worker-confirmed children become `ACTIVE` (a link
  ended meanwhile is revoked instead), audit `parent_account.activated` with
  `actorParentAccountId`. Another live account on the same verified number: `409 ACCOUNT_EXISTS`.
- **Activation grants no consent** for any health-data use; consent stays purpose-specific.
- The parent is not signed in automatically; login is stage 5.

## Parent sign-in and account (stage 5)

Base `/api/v1/parent/auth`. Parent access tokens use their own audience (`PARENT_JWT_AUDIENCE`,
default `balswasthya-parent-portal`): **staff routes reject parent tokens and parent routes reject
staff tokens**. The role is always `PARENT_GUARDIAN`; no endpoint accepts or changes a role.
Access tokens 15 minutes; refresh tokens rotate on every use, 30 days idle / 90 days absolute.
Every authenticated request re-checks that the account is ACTIVE and the session is live.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/login` | - | `{ phone, password, deviceLabel? }` -> tokens + account |
| POST | `/refresh` | - | `{ refreshToken }` -> new tokens (rotation) |
| POST | `/logout` | - | `{ refreshToken }` -> always `204` |
| POST | `/forgot-password` | - | `{ phone }` -> always `202` with the same message |
| POST | `/reset-password` | - | `{ phone, code, newPassword, confirmPassword }` |
| GET | `/me` | parent | account (role, guardian name, masked number, versions, shared child count) |
| POST | `/logout-all` | parent | ends every session of the account |
| POST | `/change-password` | parent | `{ currentPassword, newPassword, confirmPassword }` -> new tokens |
| POST | `/phone-change/start` | parent | `{ newPhone, currentPassword }` -> code to the NEW number |
| POST | `/phone-change/confirm` | parent | `{ newPhone, code }` -> account |
| POST | `/web/login`, `/web/refresh`, `/web/logout`, `/web/change-password` | browser | as above, refresh token in a cookie |

**Native vs browser.** The Android app gets the refresh token in the JSON body and keeps it in
SecureStore. The browser variant `/web/*` never puts it in JSON: it is an httpOnly,
SameSite=Strict cookie `bs_parent_rt` scoped to `/api/v1/parent/auth/web` (Secure in production);
those routes require a listed Origin (`CORS_ORIGINS`) and `x-balswasthya-client: parent-portal`.

**Sign-in (PP10).** Unknown number, wrong password, temporary lock and disabled account all give
the same `401 INVALID_CREDENTIALS`; an unknown number runs a dummy Argon2 check so timing does not
reveal it. 5 wrong passwords lock sign-in for 1 minute, doubling up to 15 minutes (not revealed).
Logout, logout-all, password change, reset and disabling end sessions immediately. Replaying a
rotated refresh token (outside the 30 s lost-response grace) ends the whole session family and is
audited (`parent_auth.refresh_reuse_detected`).

**Password change.** Needs the current password (a wrong one counts towards the lock and gives
`422 CURRENT_PASSWORD_WRONG`); the new password follows the activation rules and must differ; all
other sessions end and a new one is returned.

**Forgot / reset password.** `forgot-password` answers `202` with the same message whether or not
the number has an account; a code is sent only to a real account (1 per minute, 3 per hour -
extra requests are silently skipped). Without an SMS provider or OTP key everyone gets the same
`503`. `reset-password` checks the new password first (`422 WEAK_PASSWORD`), then the code with
the same rules as activation codes (5 attempts counted atomically, 5 minutes, single use); a wrong
code and an unknown number give the same `400 RESET_INVALID`. Success sets the new password,
clears a sign-in lock and ends every session; the parent then signs in.

**Mobile number change (PP14).** Workers can no longer change or remove a number the parent
verified: `PATCH /guardians/:id` with a phone change answers `409 PHONE_VERIFIED_BY_PARENT` while
the guardian has a live parent account (other details stay editable). The parent changes it:
`start` needs the current password and sends a code to the **new** number (60 s resend, 3 per
hour); `confirm` with that number and code updates the account and the guardian record together,
ends the account's other sessions, and is audited. A number already used by another live parent
account: `409 PHONE_IN_USE`.

## Children shared with a parent (stage 6)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/parent/children` | parent | children shared with this parent |
| GET | `/parent/children/:childId` | parent | one child, with upcoming check-ups and appointments |
| POST | `/guardians/:guardianId/child-access` | staff, `guardian.invite` | `{ childIds }` share more children with an ACTIVATED parent |
| POST | `/guardians/:guardianId/child-access/:childId/revoke` | staff, `guardian.invite` | `{ reason }` stop sharing one child |

**Access rule (IDOR/BOLA).** Every parent query is filtered by: child not deleted, an ACTIVE
`GuardianChildAccess` row for the guardian of the signed-in account (taken from the account in the
database - never from the request), and a guardian-child link that is still active. Another family's
child, an unshared sibling, a revoked or ended link and an unknown id all give the same `404`, and
the attempt is audited (`parent_child.access_denied`). Reads are limited per account (300 per 15 min).

**What a parent sees (PP12, PP16).** Name, age (years and months; marked when the birth date is
estimated), centre / village (English and Hindi), the name of the ASHA or Anganwadi worker for the
child's area, the next and upcoming health check-up dates (open follow-ups) and doctor appointments
(referrals with a scheduled appointment, with the facility name). Never: screening results, risk
levels, notes, referral reasons, diagnoses or phone numbers.

**Worker controls (PP11).** Before activation, children are chosen in the invitation. After
activation the worker can share another linked child in their area (`409 NOT_ACTIVATED` before
activation, `422 CHILD_NOT_LINKED` for a child not linked to the guardian) or stop sharing one
(`409 NOT_SHARED` if it is not shared). Ending a guardian-child link (`DELETE
/children/:childId/guardians/:linkId`) revokes the parent's access to that child in the same
transaction. Out-of-area workers get `404`.

## Database rules (migration `20261125100000_step8_parent_portal_accounts`)

- One open invitation per guardian; one non-revoked access row per guardian-child link; one live
  account per verified phone (partial unique indexes).
- Invitation token hash, guardian, phone binding, creator and expiry are immutable; status moves
  only `PENDING -> SENT / USED / REVOKED`, `SENT -> USED / REVOKED`; no delete (triggers).
- Access rows must match an active `ChildGuardian` link when created; `PENDING -> ACTIVE / REVOKED`,
  `ACTIVE -> REVOKED`; history kept.
- The runtime database role has no DELETE / TRUNCATE on the new tables.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PARENT_PORTAL_URL` | empty | Trusted portal address used in links. Empty = invitations refused (503). Must be `https://` in production. |
| `PARENT_INVITE_TTL_HOURS` | 24 | 1-168 |
| `OTP_HMAC_KEY` | empty | Base64, 32+ bytes, different from the PII keys. Required in production; empty = no codes (503). |
| `PARENT_OTP_TTL_MINUTES` | 5 | 1-10 |
| `PARENT_JWT_AUDIENCE` | `balswasthya-parent-portal` | Must differ from `JWT_AUDIENCE`. |
| `SMS_PROVIDER` | `mock` in development, otherwise `none` | `none`: nothing sent (`NOT_CONFIGURED`). `mock`: **development only**, refused in production; writes messages to the git-ignored `services/api/.dev-sms/outbox.log`, never to the application log. |

Local development: set `PARENT_PORTAL_URL=http://localhost:8082` (any address; the parent app
comes in stage 6), generate an `OTP_HMAC_KEY` (see `.env.example`), and read invitation links
and codes from `services/api/.dev-sms/outbox.log`.
