# Worker App - Authentication, Session and API Client

> Status: Step 4 (2026-11-21). Backend contract: [../authentication.md](../authentication.md).
> Decisions K-P approved 2026-11-21.

## 1. Pieces

| File | Responsibility |
|---|---|
| `src/config/env.ts` | Validated API base URL (HTTPS required outside development) |
| `src/services/api/http.ts` | JSON over HTTP: timeout, `X-Request-Id`, error envelope, Zod-checked responses. No session logic, no logging |
| `src/services/api/errors.ts` | `ApiError` (`network`, `timeout`, `cancelled`, `http`, `invalidResponse`, `notConfigured`, `noSession`) |
| `src/services/api/errorMessages.ts` | Error -> translation key. Server text is never shown |
| `src/features/auth/services/authApi.ts` | `/auth/login`, `/refresh`, `/logout`, `/change-password`, `/me` using the shared contracts |
| `src/features/auth/services/sessionManager.ts` | Session state machine, token storage, single-flight refresh |
| `src/services/api/client.ts` | The one authenticated client (`get`, `post`) |
| `src/services/query/queryClient.ts` | TanStack Query cache (memory only, cleared at sign-out) |
| `src/services/appServices.tsx` | Creates exactly one of each of the above |
| `src/features/auth/AuthProvider.tsx` | React binding (`useAuth`, `useAuthenticatedUser`) |

## 2. Session states

| State | Meaning | Screen |
|---|---|---|
| `initializing` | Reading the saved session / first refresh | Splash, then "Checking your sign-in…" |
| `unauthenticated` | No session. `reason`: `loggedOut` or `sessionEnded` | Login (with a matching notice) |
| `restoreFailed` | A session is saved but the server is unreachable (decision M) | "Cannot connect" with Try again / Sign out |
| `authenticated` | Signed in; `user.mustChangePassword` decides the area | App tabs, or change-password (decision O) |

"Refreshing" is an internal, invisible activity - it never changes the screen.

## 3. Tokens (decisions K, L)

| | Where | Lifetime |
|---|---|---|
| Access token | **Memory only**. Every cold start refreshes once to get one | 15 min (server) |
| Refresh token | Memory + SecureStore `bs.auth.refreshToken` (Keystore/Keychain, device-only, excluded from backups) | Rotated on every refresh |
| Password | Form state only while the screen is open; never stored, never logged | - |

- Login sends a generic `deviceLabel` ("Android phone", "iPhone"): no model or device id.
- Expiry is computed from the token's own `exp - iat` plus the moment it was received, not from
  `accessTokenExpiresAt`, because budget phones often have wrong clocks. The app refreshes 60 s
  before expiry; the API's 401 is the backstop.
- Web (development only, decision F): the refresh token lives in memory and is lost on reload.

## 4. Refresh rules

1. **Single-flight.** Concurrent callers share one `POST /auth/refresh`. The server treats a second
   use of a rotated token as theft and revokes the whole sign-in, so this is required, not an
   optimisation.
2. **Save before use.** The rotated refresh token replaces the old one in memory immediately and is
   written to SecureStore before the request that needed it continues.
3. **One retry, never a loop.** An API call that gets 401 triggers one refresh (unless another caller
   already replaced the token) and one retry. A second 401 ends the session. A 401 means the API
   rejected the request before running it, so the single retry is safe for POST too.
4. **Permanent vs temporary.** Refresh 401/400 (expired, revoked, reused, account inactive) ends the
   session (decision N): token deleted, cached data cleared, login with "Your session has ended".
   Network errors, timeouts, 429 and 5xx keep the session; the next call tries again.
5. **Late responses are discarded.** A generation counter increments whenever a session ends. A
   refresh or login response that arrives afterwards is not used; its new refresh token is revoked
   on the server.
6. `403 PASSWORD_CHANGE_REQUIRED` from any call switches the session to the change-password state.

## 5. Login, logout, password change

- **Login:** client checks (required, max length) -> `POST /auth/login`. Every 401 shows one generic
  message (the API does not reveal whether the ID exists, the password was wrong or the account is
  locked/suspended). The password field is cleared after a credential failure. A ref-based guard
  prevents duplicate submissions (also from the keyboard "Go" key).
- **Logout (decision P, this device):** local credentials and cached data are cleared **first**, so it
  works offline; `POST /auth/logout` is best effort. "Sign out everywhere" (`/auth/logout-all`) is not
  exposed yet.
- **Password change (decision O):** required when `mustChangePassword` is true. Client checks (8-128
  characters counted like the server, confirmation, different from current); server rules
  (`TOO_SHORT`, `TOO_LONG`, `TOO_COMMON`, `CONTAINS_LOGIN_ID`, `SAME_AS_CURRENT`) are shown next to the
  new-password field. On success the server revokes all sessions and the returned tokens replace
  the current ones.

## 6. What the frontend does NOT do

- It does not authorise anything. Route guards only decide what to *show*; the API checks every
  request. Roles/permissions from `/auth/me` may adapt the UI but are never trusted.
- It does not log (ESLint `no-console` is an error in `app/` and `src/`).
- It does not put tokens in URLs, persist access tokens, or store personal data on the device.
- It does not retry writes automatically (no idempotency keys yet).

## 7. Known limitations

| Item | Note |
|---|---|
| No server language sync | No endpoint to update `preferredLanguage` |
| Restore needs the network | With no connection at start-up the user sees "Cannot connect" (decision M); offline use of data is a later phase |
| SecureStore write failure | Session works until the app restarts, then the user signs in again |
| Refresh token is a bearer token | Protection relies on SecureStore and the device lock; no device binding (backend limitation) |
| Rooted devices | SecureStore cannot protect secrets on a compromised device |
| Session list / sign out everywhere | Backend supports them; UI deferred |
