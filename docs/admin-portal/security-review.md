# Admin Portal - Security Review (Stage PE)

> Date: 2026-11-23. Scope: `apps/admin-portal`, the API additions of stages PA-PD
> (`/auth/web/*`, `GET /areas`, `GET /assignments`, `currentAssignments` in `GET /users`) and the
> development scripts. Method: code review of every portal source file and API change, a sweep
> for risky patterns, inspection of the production build, and the automated and live tests.

## 1. Findings fixed in this stage

| # | Finding | Risk | Fix | Test |
|---|---|---|---|---|
| PE-1 | The built portal page had no Content-Security-Policy | If text were ever rendered as HTML by mistake, injected script could run and send data anywhere | Build-time CSP `<meta>`: `default-src 'none'`, scripts/styles only from the page itself, `connect-src` only the configured API origin (`'none'` when not configured), `base-uri 'none'`, `form-action 'none'`, `object-src 'none'`; no `unsafe-inline`/`unsafe-eval` (`src/security/contentSecurityPolicy.ts`, `vite.config.ts`) | 2 unit tests; production build inspected |
| PE-2 | `db:dev-reset-password` and `db:dev-live-worker` were guarded only by `NODE_ENV=production` | Run against a shared or real database without `NODE_ENV` set, they would reset a real password or create an account | Both now also refuse unless `DATABASE_URL` points at `localhost`, `127.0.0.1` or `::1` (`prisma/devGuard.ts`) | 7 unit tests; both scripts refused a remote URL in a real run |
| PE-3 | No per-user rate limit on `/users`, `/assignments`, `/roles`, `/areas` (pre-existing since Step 3 for users/assignments) | A stolen administrator session could page through every worker name in its area at full speed | Same per-user budget as child-data routes (600 reads / 150 changes per 15 minutes per signed-in person), counted after authentication | DB test: 4th request -> 429, another administrator unaffected |

## 2. Checked and in order

| Area | Result |
|---|---|
| Sign-in tokens | Access token in memory only; refresh token an httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth/web`, Secure in production, never in a response body (API + portal tests, live run checked the attributes). Nothing in localStorage/sessionStorage except the language choice (test) |
| CSRF on the cookie endpoints | SameSite=Strict + listed `Origin` required + custom header forcing a CORS preflight (API tests for each refusal) |
| CORS | Credentials only for listed origins, origin reflected, never `*` (tests, including preflight) |
| Several tabs | Refresh one tab at a time (Web Locks), sign-out reaches every tab (BroadcastChannel); late responses after sign-out discarded (tests) |
| XSS | React escaping only; no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `window.open` or `target=_blank` (sweep). URL parameters (`q`, `status`, `userId`, `name`) are validated or only displayed as text |
| Logging | `no-console` lint rule; no tokens, passwords or response bodies in error messages (`ApiError.message` carries kind/status/code only) |
| One-time passwords | Shown once in page state only; never in the query cache; mutations keep no result (`gcTime: 0`); gone after "continue" (tests) |
| Authorisation | The portal's role/permission checks are for usability only; every request is checked again by the API (area scope, delegation, self-modification). Supervisors never call `/users` (no refused, audited requests) |
| Data minimisation | No child, guardian or screening data anywhere in the portal or the new endpoints (DB tests assert the absence of such fields). `GET /users` rows show only assignments inside the caller's areas; `GET /assignments` shows names, login IDs and account status of people assigned inside the caller's areas, never the caller's own |
| Out-of-scope access | Unknown and out-of-scope accounts, assignments and areas give the same 404 (tests) |
| Secrets in the build | None (`JWT_SECRET`, PII keys, database URLs absent from `dist/`); `VITE_*` values are documented as public |
| Dependencies | New portal packages add no `npm audit` advisories; the 32 reported advisories are all in pre-existing API tooling (Prisma toolchain, `effect`) |

## 3. Accepted or open risks

1. **Reasons are stored as plain text.** Account and assignment reasons ("Order 12/2026") are
   stored unencrypted in the assignment row and the audit log (Step 3 design). Every form says
   never to write children's names or health details there. If the programme wants them
   encrypted like screening free text (Step 6F), that is a schema/API change for review.
2. **Area names outside the caller's scope** appear in `path` (e.g. the state above a district).
   They are reference data, not personal data.
3. **The `name` shown on "Add an area for <name>"** comes from the address. A crafted link could
   show a misleading name; the API acts only on the `userId`, checks scope and delegation, and
   the form shows the person's assignments on the account page. Low risk.
4. **Clipboard.** The copy button puts the one-time password on the computer's clipboard, where
   other programs can read it. It is replaced at first sign-in, so its lifetime is short.
5. **Hosting requirements (not testable here):**
   - serve the portal and the API over HTTPS, on the **same site** (e.g. `admin.<domain>` and
     `api.<domain>`), otherwise the SameSite=Strict cookie is never sent;
   - send `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`,
     `Strict-Transport-Security`, `Referrer-Policy: no-referrer` and
     `X-Content-Type-Options: nosniff` from the portal's web server (a `<meta>` CSP cannot
     forbid framing);
   - set `CORS_ORIGINS` to the portal's https origin only.
6. **No browser-level end-to-end test.** The live tests drive the portal's real session and API
   code against the real API with a browser-like cookie jar; the screens are tested with
   Testing Library in jsdom. No real browser (Playwright etc.) is set up in this repository.
7. **Intermittent test timeouts from the local environment** (not portal code): slow Docker
   disk I/O on this Windows machine occasionally stalls PostgreSQL (one checkpoint took 104
   seconds), giving 20-second timeouts or `503` in a database test run, and worker-app screen
   tests time out when several heavy suites run at the same time. Every affected test passes on
   rerun; complete runs pass when suites run one at a time.
