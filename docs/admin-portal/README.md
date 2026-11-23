# Admin Web Portal

> Status: decisions P1-P12 **approved 2026-11-23** (portal before Step 6G-2).
> Stages **PA** (`790aac7`), **PB** (`934e4d7`) and **PC** done; PD-PE not started. Branch
> `feat/admin-portal` (based on `feat/step-6-screening` at 6G-1, commit `9324319`).

A separate browser portal for office administrators: create worker accounts, give them a role
and an area, change or end assignments. It never shows child health data.

## 1. Approved decisions

| # | Decision |
|---|---|
| P1 | New workspace `apps/admin-portal`: React + Vite + TypeScript, TanStack Query, react-hook-form with the shared Zod contracts. Desktop browser, dev port 5173 |
| P2 | Only accounts holding `user.manage` or `assignment.manage` (State Admin, District Admin; Supervisor for assignments only). Others see "This portal is for administrators" |
| P3 | No child, guardian or screening data in the portal (keeps decision D3) |
| P4 | Refresh token in an httpOnly, SameSite=Strict cookie (never readable by page scripts); access token in memory only. Mobile sign-in unchanged |
| P5 | New read-only, scoped `GET /api/v1/areas` (state -> village tree) |
| P6 | Screens: sign in / change password, user list, create worker (role + area picker, one-time password shown once), user detail (assignments, suspend/reactivate, reset password, sign out everywhere), add/end/suspend/revoke assignments with a reason |
| P7 | English first; Hindi wired up the same way as the worker app |
| P8 | Not in the first version: audit-log viewer, reports, area editing, facilities, protocol management |
| P9 | `CORS_ORIGINS` gains `http://localhost:5173` (production: the portal's own https domain) |
| P10 | API tests for areas and cookie sign-in; portal component tests; one live end-to-end run |
| P11 | No database schema change expected; any need is presented for review first |
| P12 | 6G-1 committed first; portal on its own branch |

## 2. Stages

| Stage | Content | Status |
|---|---|---|
| PA | API: area tree, browser sign-in with cookie, CORS, tests | **Done** - see [api.md](api.md) |
| PB | Portal shell: sign in, change password, admin-only access, layout | **Done** - section 4 |
| PC | Users: list, detail, create worker, temporary password, status, reset | **Done** - section 5 |
| PD | Assignments: add, end, suspend, reactivate, revoke | Not started |
| PE | Docs, security review, live end-to-end run, PDF guide admin section | Not started |

## 3. Notes from stage PA (all handled in PB)

- **Refresh from several tabs:** the cookie is shared by all tabs. Two tabs refreshing at the
  same moment could trip reuse detection (the API's 30-second grace covers most cases, but the
  order in which browsers store two Set-Cookie responses is not guaranteed). The portal must
  refresh through one tab at a time (Web Locks API `navigator.locks.request`), and other tabs
  reuse the result.
- **Same-site in development:** `localhost:5173` and `localhost:4000` are the same site (ports are
  ignored), so SameSite=Strict cookies work in development. In production the portal and API
  must also be same-site (e.g. `admin.example.gov.in` and `api.example.gov.in`), or the cookie is
  never sent.
- The portal's requests to `/auth/web/*` must use `credentials: 'include'` and send the header
  `x-balswasthya-client: admin-portal`.

## 4. Stage PB - the portal shell

### Running it

```powershell
Copy-Item appsadmin-portal.env.example appsadmin-portal.env   # once; VITE_API_BASE_URL
npm run dev:admin                                                # http://localhost:5173
```

The API must be running and list `http://localhost:5173` in `CORS_ORIGINS`. Everything in
`apps/admin-portal/.env` is built into the page: never put a secret there.

### What a person sees

| Situation | Screen |
|---|---|
| API address missing or invalid in the build | "The portal is not set up correctly" (no request is made) |
| Page loading | Loading, while the session is continued from the cookie (a page reload does **not** sign out) |
| API unreachable on load | "Could not reach the server…" + Try again |
| Not signed in | Sign in (the requested address is kept, e.g. `/users`) |
| Temporary password | Forced "Choose a new password", nothing else reachable |
| Signed in without `user.manage` / `assignment.manage` | "This portal is for administrators" + Sign out |
| Administrator | Header (name, language, sign out), navigation (Home, Users, Change password), Home with role, areas and scope |

The API checks every request again; the screen choices above are for usability only.

### Structure (`apps/admin-portal/src`)

| Path | Role |
|---|---|
| `config.ts` | Validates `VITE_API_BASE_URL` (must end in `/api/v1`; https in production) |
| `api/http.ts`, `api/errors.ts`, `api/client.ts` | JSON over HTTP; cookies (`credentials: 'include'`) and the portal header **only** for `/auth/web/*`; every other call `credentials: 'omit'`; `cache: 'no-store'` |
| `auth/sessionManager.ts` | Session states, single-flight refresh, one retry on 401, generation counter against late responses |
| `auth/tabCoordination.ts` | Web Locks (one refresh at a time across tabs) and BroadcastChannel (sign-out / sign-in in one tab reaches the others) |
| `auth/tokenLifetime.ts` | Access-token lifetime from `exp - iat` (independent of the computer clock) |
| `app/App.tsx`, `app/Layout.tsx`, `app/services.tsx` | Gate (table above), shell, service wiring; cached data is cleared when a session ends |
| `i18n/` | English and Hindi (`Record<TranslationKey, string>`: a missing Hindi key is a compile error). Only the language choice is stored in the browser |
| `pages/` | Sign in, change password (forced and voluntary), home, not-admin, placeholders |

Token rules: the access token is in memory only; the refresh token is an httpOnly cookie the
page cannot read. Nothing is written to localStorage or sessionStorage except the language.
Nothing is logged (`no-console` lint rule).

### Tests

- `npm test --workspace @balswasthya/admin-portal`: **131 tests** (Vitest + jsdom + Testing
  Library) against a fake API that models the cookie jar: session states, cookie transport,
  single refresh for concurrent 401s, cross-tab lock, refresh before expiry, sign-out across
  tabs, late responses after sign-out, password change, no token in browser storage, all screens
  in the table above, form validation, server policy errors, Hindi, address validation,
  translation completeness.
- Mutation checks: letting everyone in (2 failures), refreshing without the cross-tab lock (1),
  sending cookies on every call (2).
- **Live** (opt-in, `tests/live/livePortal.test.ts`): the real session code against a running
  API with a browser-like cookie jar - sign in, cookie attributes, reload continues, rotation,
  `GET /areas`, sign out, worker refused, wrong password. Run on 2026-11-23 against a temporary
  API on the test database: **3/3 passed**.
- `npm run build --workspace @balswasthya/admin-portal` builds `dist/` (about 143 kB gzipped).

### Hindi

Strings shared with the worker app reuse its wording; portal-only Hindi strings are engineering
drafts and need review by a native speaker before release.

## 5. Stage PC - user accounts

### Screens

| Address | What it does |
|---|---|
| `/users` | Accounts with a current assignment in the administrator's areas (never the administrator): name, login ID, role and area, status, "must change password", last sign-in. Search (2+ characters), status filter and page live in the address. Accounts without `user.manage` (supervisors) see an explanation, and **no request is made** (a refused request would be logged as a denied attempt) |
| `/users/new` | Create a worker: login ID (normalised like the API: upper case, trimmed), full name, preferred language, role (only roles whose management permissions the administrator holds), area (picker), coverage (this area only / and all within it; default this area only), reason. Then the **one-time password**, shown once |
| `/users/:id` | Account facts, assignments (read-only until stage PD) and actions, each with a required reason and an explicit confirmation: suspend / reactivate, reset password (new one-time password), sign out everywhere, deactivate permanently. Unknown and out-of-scope accounts show the same "not found or outside your areas" message |

**Area picker:** starts at the administrator's own top areas (`GET /areas`), opens sub-areas
with a breadcrumb trail, or searches by name or code; the chosen area is shown with its full
path. Only areas the API offers can be chosen, and the API checks the choice again.

**One-time passwords:** shown in a panel with a copy button and "I have noted it - continue".
They exist only in that page's state: never in the query cache, mutations keep no result
(`gcTime: 0`), and leaving the page loses them (by design - they can only be reset again).

**Errors:** login ID taken -> on the field; outside your areas / role above your own -> a
specific message; a concurrent change (409) -> "changed meanwhile" and the account is reloaded;
everything else -> the generic translated messages.

### API changes in this stage (additive, no database change)

- `GET /users` rows now include `currentAssignments` (role code, area name, status) - only
  current assignments **inside the caller's `user.manage` areas**; assignments elsewhere are not
  revealed. New shared schemas: `userListResponseSchema`, `roleListResponseSchema`,
  `UserDetailResponse`, `TemporaryPasswordResponse`.
- `MANAGEMENT_PERMISSIONS` in the shared contracts; a unit test keeps it equal to the API's
  delegation table.

### Tests

- Portal: **253 tests** (17 new screen tests for PC): list contents, search/filter/paging in the
  address, supervisor makes no request, every validation message, the complete create flow
  (browse state -> district -> village, exact request body, password panel, not cached, gone
  after continue), area search, taken login ID, out-of-scope refusal, role filtering for a
  district administrator, account page, suspend (reason required) -> reactivate, permanent
  deactivation, password reset panel, sign out everywhere, 409 reload.
- Mutation checks: keeping one-time passwords in the cache (1 failure), offering every role (2),
  requesting the list without `user.manage` (1).
- API: 2 new database tests (list rows show only current in-scope assignments; roles parse) and
  1 unit test (management permissions in step).
- **Live** (opt-in): a new test creates a synthetic worker through the real API, finds it, opens
  it, lets the worker sign in with the one-time password (must change it), suspends,
  reactivates, resets, signs out everywhere and finally deactivates it. Run 2026-11-23 against a
  temporary API on the test database: **4/4 passed**.

### Known gaps (for later stages)

- Supervisors hold `assignment.manage` but not `user.manage`, so they cannot list accounts;
  how they find a person to assign is part of stage PD.
- The create form does not offer future start or end dates for the first assignment (the API
  supports them; stage PD adds them for assignments).
