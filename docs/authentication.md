# BalSwasthya AI - Authentication and Sessions

> **Status:** Step 3 complete (2026-11-21). Stage 2 (this document), Stage 3 authorization
> ([authorization.md](authorization.md)) and Stage 4 mobile-app integration (delivered in Step 4:
> [frontend/authentication.md](frontend/authentication.md); verified against the running API by
> `apps/worker-app/tests/live/liveApi.test.ts`, 10/10 passed).
> Decisions referenced as A-H were approved by the project lead on 2026-11-21.

Related: [database-design.md](database-design.md) (schema, access-control rules),
[architecture.md](architecture.md).

---

## 1. Overview

| Concern | Implementation |
|---|---|
| Who is calling | Short-lived JWT access token (`Authorization: Bearer ...`), verified on every request |
| Staying signed in | Opaque refresh token, rotated on every use, stored only as a SHA-256 hash |
| Ending access | Revoking the session family; checked on every request, so it takes effect immediately |
| Passwords | Argon2id, OWASP baseline parameters, never logged or returned |
| What they may do / where | **Not** in the token. Read from the database per request (Stage 3) |

Code: `services/api/src/modules/auth/` (service, sessions, routes),
`src/middleware/authenticate.ts`, `src/middleware/rateLimit.ts`, `src/utils/{jwt,password,token}.ts`,
`src/config/security.ts`. Contracts shared with the app: `packages/shared-contracts/src/auth.ts`.

**Packages added:** `argon2` 0.45.2, `jose` 6.2.15, `express-rate-limit` 8.7.3 (exact versions,
each released at least two weeks before installation). No schema change or migration was needed.

## 2. Threat model (summary)

| Threat | Control |
|---|---|
| Password guessing on one account | Temporary lock after 5 failures (1, 2, 4, 8, 15, 15... min), per IP+account rate limit |
| Password spraying across accounts | Per-IP rate limit; Argon2id cost |
| Account enumeration | One generic 401 for every failure; one Argon2 verification per attempt (dummy hash for unknown IDs) |
| Stolen database | Argon2id password hashes; refresh tokens stored as hashes only |
| Forged / altered access token | HS256 signature, explicit algorithm allowlist, `typ`, `iss`, `aud`, `exp`, `nbf`, required claims |
| Stolen access token | 15-minute lifetime; revoked immediately by logout / password change / suspension |
| Stolen refresh token | Rotation + reuse detection: replaying an old token revokes the whole session |
| Token from another environment | Issuer includes `NODE_ENV`; separate secret per environment |
| Lock-out abuse | Locks are temporary, capped at 15 min, and attempts during a lock do not extend it |
| Mass assignment | Strict request schemas reject unknown fields (`role`, `status`, `userId`...) |
| Leaking secrets | Logger redacts token/password fields; error handler never returns internals; responses `Cache-Control: no-store` |

**Assumptions:** HTTPS terminates in front of the API in every deployed environment; `JWT_SECRET`
comes from a secret manager; `TRUST_PROXY_HOPS` matches the deployment; only one API process until a
shared rate-limit store is added.

## 3. Login

`POST /api/v1/auth/login`

```json
{ "loginId": "EMP-0042", "password": "meri beti 2026", "deviceLabel": "Android phone" }
```

1. Rate limits: 100 attempts / 15 min per IP; 10 / 15 min per IP + login ID.
2. Strict validation (unknown fields -> 400). `deviceLabel` is optional, letters/digits/space/`._()-`, max 64.
3. Login ID normalised: Unicode NFKC, trimmed, upper-case (decision D6: employee code).
4. Exactly one Argon2id verification (real or dummy).
5. Refused, with the **same** 401 response, when: unknown ID, wrong password, account locked,
   account `SUSPENDED` or `DEACTIVATED`.
6. Success: failure counter reset, `lastLoginAt` set, new session family, audit row - in one transaction.
   An outdated password hash is upgraded transparently.

**200 response**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9...",
  "accessTokenExpiresAt": "2026-11-21T09:15:00.000Z",
  "refreshToken": "q5W1...43 characters...",
  "refreshTokenExpiresAt": "2026-12-05T09:00:00.000Z",
  "user": { "id": "4b0c...", "displayName": "Synthetic Worker", "preferredLanguage": "hi", "mustChangePassword": false }
}
```

**401 response (every failure reason)**

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid credentials or account unavailable.", "requestId": "..." } }
```

If `mustChangePassword` is true, the access token works only for `GET /auth/me`,
`POST /auth/change-password` and `POST /auth/logout-all`; other routes answer
`403 PASSWORD_CHANGE_REQUIRED`. New accounts start this way (replaces a `PENDING` status).

## 4. Password policy (decision D)

- 8 to 128 characters, counted as Unicode characters (Hindi text counts fairly). Never truncated.
- No composition rules (no "must contain a digit and a symbol").
- Refused: a short list of very common passwords, a single repeated character, plain digit or
  alphabet runs, and anything containing the user's login ID.
- Normalised with NFKC before hashing and verifying.
- Argon2id, memory 19 MiB, 2 iterations, parallelism 1 (OWASP baseline). Memory is kept modest so
  a login flood cannot exhaust the server; rate limits and lockout carry the rest.

## 5. Access tokens (decision C)

| Property | Value |
|---|---|
| Algorithm | HS256 only (allowlist; `none`, HS512, RS256 rejected) |
| Header `typ` | `at+jwt` (RFC 9068) |
| Lifetime | 15 min (`ACCESS_TOKEN_TTL_SECONDS`, 60-3600) |
| Claims | `iss`, `aud`, `sub` (user id), `sid` (session family id), `jti`, `iat`, `nbf`, `exp` - nothing else |
| Clock tolerance | 5 s |

**Validation on every request** (`authenticate` middleware):

1. `Authorization: Bearer <jwt>` present and well-formed.
2. Signature, algorithm, `typ`, issuer, audience, `exp`, `nbf`, required claims; `sub`/`sid` are UUIDs.
3. One database read: user exists and is `ACTIVE`, and the session family `sid` still has a current,
   unexpired refresh row.
4. `mustChangePassword` gate (above).

Any failure -> `401 UNAUTHENTICATED` with `WWW-Authenticate: Bearer error="invalid_token"`, whatever
the reason. JWT claims are never treated as authorization: roles and areas are checked against the
database per request (Stage 3).

**Revocation** needs no token blocklist: revoking a session family (step 3) makes every access token
carrying that `sid` fail immediately.

## 6. Refresh tokens and session lifecycle

- 256 bits from the OS CSPRNG, base64url (43 chars). Only the SHA-256 hash is stored
  (`RefreshSession.tokenHash`). Sent only in JSON bodies, never in URLs.
- A **session family** (`familyId`) = one sign-in on one device. Each refresh adds a row to the family.
- Idle expiry 14 days (each refresh extends it); absolute expiry 30 days from sign-in (decision C).

```text
login ──► row1 (current) ──refresh──► row1 ROTATED ─► row2 (current) ──refresh──► ...
                                         │
                         replay of row1 after 30 s, or after row2 was used
                                         ▼
                           whole family REUSE_DETECTED (all devices' tokens of this sign-in dead)
```

`POST /api/v1/auth/refresh` `{ "refreshToken": "..." }` -> same 200 shape as login.

Rotation (one transaction):

1. Find the row by token hash. Unknown -> 401 `SESSION_EXPIRED`.
2. Already revoked:
   - `ROTATED` less than 30 s ago and every later row was only `SUPERSEDED` (never used): the client
     lost the previous response. The current row is marked `SUPERSEDED` and a new token is issued
     (**decision B**).
   - `ROTATED` / `SUPERSEDED` otherwise: **reuse** - revoke the family, audit
     `auth.refresh_reuse_detected`, 401. The response does not mention reuse.
   - Any other reason (logout, password change...): 401.
3. Expired -> 401. User not `ACTIVE` -> revoke family (`ACCOUNT_INACTIVE`), audit, 401.
4. Claim the row with a conditional update (`WHERE revokedAt IS NULL`). PostgreSQL serialises
   concurrent claims on the row lock; the loser retries and goes through step 2.
5. Create the next row (expiry = min(now + idle, sign-in + absolute)) and link `replacedById`.

**Concurrent / duplicate requests:** however many identical refresh requests arrive together, the
family ends with exactly **one** current token and is not revoked; earlier responses' tokens are
superseded. The app must therefore run only one refresh at a time and keep the token from the last
successful response; the worker app does this with a single-flight refresh
([frontend/authentication.md](frontend/authentication.md) section 4). Presenting a superseded token
later is treated as reuse.

**Revocation reasons** (`RefreshSession.revokedReason`): `ROTATED`, `SUPERSEDED`, `REUSE_DETECTED`,
`LOGOUT`, `LOGOUT_ALL`, `SESSION_REVOKED`, `PASSWORD_CHANGED`, `ACCOUNT_INACTIVE`.

## 7. Logout, sessions, password change

| Endpoint | Auth | Effect |
|---|---|---|
| `POST /auth/logout` `{ refreshToken }` | none (works with an expired access token) | Revokes that token's family. Always `204`, also for unknown tokens (no oracle). |
| `POST /auth/logout-all` | access token | Revokes every family of the user. `204`. |
| `GET /auth/me` | access token | `{ user, access }` - `access` = effective permissions and assignments (`meResponseSchema`); for UI adaptation only |
| `GET /auth/sessions` | access token | Own active sessions: `sessionId`, `deviceLabel`, `lastActiveAt`, `expiresAt`, `current` |
| `DELETE /auth/sessions/:sessionId` | access token | Revokes one **own** session. Another user's id -> `404`. |
| `POST /auth/change-password` `{ currentPassword, newPassword }` | access token | See below |

**Password change:** current password verified (wrong -> `400 INVALID_CURRENT_PASSWORD`, audited);
new password checked against the policy and must differ (`400 PASSWORD_POLICY` with `details.rule`);
then, in one transaction: new hash, `passwordChangedAt`, `mustChangePassword = false`, **every**
session of the user revoked (all devices), a new session started for the calling device (same label),
audit. Returns new tokens. Limited to 10 per user per 15 min.

**Password reset:** no email/SMS service exists, so there is no self-service reset (decision approved
in Stage 1). An administrator sets a temporary password with `mustChangePassword = true`, which also
revokes all sessions (user-management API, Stage 3). No messages are sent or simulated.

## 8. Rate limits

| Limiter | Limit per 15 min | Key |
|---|---|---|
| Login, all attempts | 100 | client IP (IPv6 grouped by /56) |
| Login, one account | 10 | client IP + normalised login ID |
| Refresh and logout | 300 | client IP |
| Password change | 10 | user id |

Per-IP limits are generous because many workers may share one mobile-carrier IP (carrier-grade NAT).
Exceeding a limit -> `429 TOO_MANY_REQUESTS` with `RateLimit` headers.

## 9. Other API hardening in this stage

- `Cache-Control: no-store` on every API response.
- Bodies on POST/PUT/PATCH/DELETE must be `application/json` (else `415`); max 1 MB (`413`).
- Request schemas are strict (unknown fields -> `400 VALIDATION_ERROR`).
- `trust proxy` set only from `TRUST_PROXY_HOPS`.

## 10. Audit events

Written to the append-only `AuditLog`; `details` holds reason codes and ids only - never passwords,
tokens or the attempted login ID of an unknown account.

| `action` | Outcomes | `details` |
|---|---|---|
| `auth.login` | SUCCESS, FAILED, DENIED | `reason`: `OK`, `UNKNOWN_ACCOUNT`, `BAD_PASSWORD`, `BAD_PASSWORD_LOCKED`, `ACCOUNT_LOCKED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DEACTIVATED`; `sessionId` on success |
| `auth.refresh_reuse_detected` | DENIED | `action: FAMILY_REVOKED` (entity = session family) |
| `auth.refresh_denied` | DENIED | `reason: ACCOUNT_INACTIVE` |
| `auth.logout` | SUCCESS | entity = session family |
| `auth.logout_all` | SUCCESS | `sessionsRevoked` |
| `auth.session_revoked` | SUCCESS | entity = session family |
| `auth.password_change` | SUCCESS, FAILED | `sessionsRevoked` or `reason` |

Successful refreshes are not audited (too frequent); `RefreshSession` rows record them.
IP addresses are not stored (data minimisation); request ids link audit rows to logs.

## 11. Environment variables

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | - (required) | 32+ chars, random, different per environment. Production refuses placeholders. |
| `JWT_ISSUER` | `balswasthya-api:<NODE_ENV>` | |
| `JWT_AUDIENCE` | `balswasthya-worker-app` | |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | 60-3600 |
| `REFRESH_TOKEN_IDLE_DAYS` | `14` | 1-90 |
| `REFRESH_TOKEN_ABSOLUTE_DAYS` | `30` | 1-180, >= idle days |
| `TRUST_PROXY_HOPS` | `0` | Number of reverse proxies in front of the API |

## 12. Testing

```powershell
npm test          # unit + API hardening tests (no database)
npm run test:db   # database-backed auth lifecycle tests (local Docker PostgreSQL)
```

All test users and data are synthetic. Database tests drive time with an injected clock (expiry,
lockout, grace window, absolute lifetime). A mutation check (each security condition removed in
turn) confirmed every one is caught by at least one test.

## 13. Known limitations and remaining risks (Stage 2)

| Item | Risk / note |
|---|---|
| In-memory rate-limit counters | Per process. Needs a shared store (e.g. PostgreSQL or Redis) before running more than one API instance. |
| HS256 shared secret | Acceptable while only this API signs and verifies. Switch to an asymmetric key if another service must verify tokens. Rotating `JWT_SECRET` invalidates current access tokens (users refresh transparently). |
| Account lockout | A third party who knows a login ID can lock it for up to 15 minutes at a time (bounded by design, mitigated by rate limits). |
| Grace window (decision B) | A thief replaying a just-rotated token within 30 s gets a token, but the legitimate client's next refresh then triggers reuse detection and revokes both. |
| No device binding | Refresh tokens are bearer tokens; protection relies on SecureStore on the device (Android Keystore / iOS Keychain, excluded from backups). |
| Audit without IP | Investigations rely on request ids and server logs. |
| `npm audit` | 4 high / 3 moderate findings in Prisma CLI config tooling and Expo build tooling; only fixes are Prisma 7 or an Expo downgrade. Accepted (decision H); not in the request path. Step 4 added 25 moderate findings, all one `minimatch`/`glob` issue inside Jest test tooling (dev only, not shipped). |
| No self-service password reset | By design until an approved SMS/email channel exists. |
