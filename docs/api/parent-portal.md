# Parent Portal API (Step 8)

Base URL `/api/v1`. Authentication, error format, rate limits and the "404 for out-of-scope" rule
are as in [children.md](children.md). Contracts: `packages/shared-contracts/src/parentPortal.ts`.
Design and decisions: [../step-8/parent-portal-plan.md](../step-8/parent-portal-plan.md) (PP1-PP18).
Examples use synthetic data.

> **Stages 3-4.** Workers invite (stage 3); parents can check the link, verify their number
> with a code and activate an account (stage 4, server side). Login, sessions and password reset
> arrive in stage 5, the parent screens in stage 6. **No real SMS provider is configured**: in production nothing is sent and invitations stay
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
| `SMS_PROVIDER` | `mock` in development, otherwise `none` | `none`: nothing sent (`NOT_CONFIGURED`). `mock`: **development only**, refused in production; writes messages to the git-ignored `services/api/.dev-sms/outbox.log`, never to the application log. |

Local development: set `PARENT_PORTAL_URL=http://localhost:8082` (any address; the parent app
comes in stage 6), generate an `OTP_HMAC_KEY` (see `.env.example`), and read invitation links
and codes from `services/api/.dev-sms/outbox.log`.
