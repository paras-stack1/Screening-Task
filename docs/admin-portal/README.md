# Admin Web Portal

> Status: decisions P1-P12 **approved 2026-11-23** (portal before Step 6G-2).
> Stage **PA (API additions) done**; PB-PE not started. Branch `feat/admin-portal`
> (based on `feat/step-6-screening` at 6G-1, commit `9324319`).

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
| PB | Portal shell: sign in, change password, admin-only access, layout | Not started |
| PC | Users: list, detail, create worker, temporary password, status, reset | Not started |
| PD | Assignments: add, end, suspend, reactivate, revoke | Not started |
| PE | Docs, security review, live end-to-end run, PDF guide admin section | Not started |

## 3. Notes for stage PB (found in PA)

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
