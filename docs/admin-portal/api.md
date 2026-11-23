# Admin Portal - API Additions (Stage PA)

No database schema change. Two new route groups, plus credentialed CORS for listed origins.

## 1. `GET /api/v1/areas` - scoped area tree

**Gate:** `user.manage` **or** `assignment.manage` (otherwise `403`, audited as `authz.denied`).
**Scope:** only active areas (of an active level) where the caller holds one of those
permissions through an effective assignment. `AREA_ONLY` covers the area itself;
`AREA_AND_DESCENDANTS` also everything below it. Ended, future, suspended or revoked assignments
grant nothing.

| Query | Returns |
|---|---|
| (none) | The caller's top areas: in scope, and the parent is not (a State Admin gets the state; a District Admin gets their district) |
| `?parentId=<uuid>` | In-scope sub-areas of that area. An area outside scope, or unknown, gives `404` (same answer, so other districts are not revealed) |
| `?search=<2-50 chars>` | In-scope areas whose English or Hindi name or code contains the text, max 50 |

`parentId` and `search` together, a malformed id, a 1-character search or an unknown parameter
give `400`.

Response (`areaListResponseSchema`):

```json
{
  "items": [
    {
      "id": "…", "code": "DEMO-D1-B1-S1-V1", "nameEn": "…", "nameHi": null,
      "levelCode": "VILLAGE", "levelNameEn": "…", "levelNameHi": "…",
      "allowsChildRegistration": true,
      "childCount": 0,
      "path": [ { "id": "…", "nameEn": "Demo DEMO-STATE (synthetic)", "nameHi": null, "levelCode": "STATE" } ]
    }
  ],
  "truncated": false
}
```

- `childCount` counts only sub-areas the caller can also see (0 = nothing to open).
- `path` lists the ancestors from the top down to the parent, **including ancestors outside the
  caller's scope** (names only), so "Village X" can be shown as "State > District > … > Village X".
- Reference data only: no people, assignments or child data. Reads are not audited (like
  `GET /roles`); refusals are.
- This endpoint never grants anything: `POST /users` and `POST /assignments` still run the full
  delegation check (area, role subset, self-modification).

## 2. `/api/v1/auth/web/*` - browser sign-in for the portal

Same accounts, sessions, rotation, reuse detection, lockout, rate limits and audit events as
`/auth/*` ([../authentication.md](../authentication.md)). Only the transport of the refresh token
differs.

| Endpoint | Body | Result |
|---|---|---|
| `POST /auth/web/login` | `{ loginId, password, deviceLabel? }` | `200` `webAuthResponseSchema` (access token, expiries, user) + refresh cookie |
| `POST /auth/web/refresh` | none (cookie) | `200` new access token + **rotated** cookie. No/invalid cookie: `401 SESSION_EXPIRED` and the cookie is cleared |
| `POST /auth/web/logout` | none (cookie) | Always `204`; revokes the cookie's session and clears the cookie |
| `POST /auth/web/change-password` | `{ currentPassword, newPassword }` + `Authorization: Bearer` | `200` as login; every older session revoked, new cookie |

**Cookie:** `bs_admin_rt`, `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth/web`, `Expires` =
refresh expiry, `Secure` in production. The refresh token is never in a response body.

**Every `/auth/web/*` request must have** (otherwise `403`):

1. an `Origin` header listed in `CORS_ORIGINS` (`ORIGIN_NOT_ALLOWED`);
2. the header `x-balswasthya-client: admin-portal` (`WEB_CLIENT_REQUIRED`). A custom header
   forces a CORS preflight, which unlisted origins fail.

Together with SameSite=Strict this is the CSRF defence. Browsers must call these endpoints with
`credentials: 'include'`.

## 3. CORS

`credentials: true` is now enabled for **listed** origins only (the origin is reflected, never
`*`). Requests without an Origin header (mobile app, curl) are unaffected. The cookie is scoped
to `/api/v1/auth/web`, so no other endpoint ever receives it; all other endpoints still need the
`Authorization` header.

## 4. Tests

- `tests/apiSecurity.test.ts` (no database): origin and header refusals, refresh without cookie,
  logout clears the cookie, change-password needs a token, credentialed CORS and preflight only
  for listed origins, `/areas` requires authentication.
- `tests/db/adminPortal.test.ts` (19 tests): area scope per role (state admin, district admin,
  supervisor subtree, `AREA_ONLY`, ended assignment), other district = 404, search limited to
  scope, deactivated areas hidden, 400 cases, no personal data in the response; cookie
  attributes, no refresh token in bodies, rotation, replay -> family revoked, logout,
  password change replaces the cookie, `Secure` with production settings, audit.
- Mutation checks: removing the scope filter (6 failures), `httpOnly: false` (1), returning the
  refresh token in the body (3).
