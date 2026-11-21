# BalSwasthya AI - Authorization (RBAC + Area Access)

> **Status:** Step 3 complete (2026-11-21); this is Stage 3. Builds on
> [database-design.md](database-design.md) sections 4-6 and [authentication.md](authentication.md).
> Roles, role permissions and the area hierarchy are **illustrative assumptions** pending RBSK
> programme confirmation (decisions D1, D2).

---

## 1. Model in one paragraph

*Where* a user may act comes from their **area assignments**; *what* they may do there comes from
the **role** on each assignment. Both are read from the database on **every request** (never from
the token), deny by default, and are enforced on the server only. Every child-linked record is
reachable only through a child whose **current** area the user covers.

## 2. Request pipeline

```text
request ─► authenticate        token valid? user ACTIVE? session not revoked?      else 401
        ─► requirePermission   holds the permission through ≥1 effective assignment? else 403 (audited)
        ─► validate            strict params/query/body                             else 400
        ─► service             area scope applied INSIDE the database query;
                               single record out of scope ─► 404 (audited, same as "not found")
```

An assignment is **effective** at time *t* when: status `ACTIVE`, `effectiveFrom <= t`,
(`effectiveTo` null or `> t`), the user is `ACTIVE`, and the role is active.

## 3. Permission matrix (illustrative - decision D2)

| Permission | Class (D11) | ASHA | ANGANWADI_WORKER | MHT_MEDICAL_OFFICER | SUPERVISOR | DISTRICT_ADMIN | STATE_ADMIN |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `child.read` | fieldwork | ✓ | ✓ | ✓ | ✓ | | |
| `child.create` / `child.update` | fieldwork | ✓ | ✓ | ✓ | | | |
| `consent.record` | fieldwork | ✓ | ✓ | ✓ | | | |
| `screening.conduct` | fieldwork | ✓ | ✓ | ✓ | | | |
| `screening.review` | fieldwork | | | ✓ | | | |
| `referral.create` | fieldwork | ✓ | ✓ | ✓ | | | |
| `referral.update` | fieldwork | | | ✓ | ✓ | | |
| `report.aggregate` | management | | | | ✓ | ✓ | ✓ |
| `assignment.manage` | management | | | | ✓ | ✓ | ✓ |
| `user.manage` (new, decision G) | management | | | | | ✓ | ✓ |
| `facility.manage` | management | | | | | ✓ | ✓ |
| `area.manage` | management | | | | | | ✓ |
| `audit.read` | management | | | | | | ✓ |

Source of truth: `services/api/src/modules/access-control/roles.ts` (seeded; the seed now also
**removes** grants taken out of the code) and `permissions.ts`. District and state administrators do
not read individual children (D3). There is no global super-user: the top administrator is a
`STATE_ADMIN` assignment at the root area with descendant scope.

## 4. Geographical rules

| Rule | Behaviour |
|---|---|
| Scope `AREA_ONLY` | The assigned area only. A village assignment does **not** reach an Anganwadi centre below it. |
| Scope `AREA_AND_DESCENDANTS` | The area and everything below it. Never implied: it must be chosen explicitly. |
| Several assignments | Union of coverage, **per permission** (a permission does not travel to another assignment's area). |
| Expired / future / suspended / revoked assignment | Grants nothing, effective on the next request (no re-login needed). |
| Child moves area | Access follows the child's **current** area (D4). The `areaId` snapshots on screening sessions and referrals are reporting history only and never grant access. |
| Area moved in the hierarchy | Access recomputed through the closure table; no assignment edits. |
| Historical records | Never deleted when an assignment ends; still attributed to their authors. |

The hierarchy is configuration data (levels, ranks); no code depends on specific level names.

## 5. Child-linked records (IDOR / BOLA)

`accessScope.ts` exposes one filter per entity, all derived from the child's current area:

| Entity | Reachable when |
|---|---|
| Child | its current area is covered; not soft-deleted |
| Guardian | linked to an accessible child through a **current** link (`endedAt` null); not deleted |
| Consent, Measurement, Referral, FollowUp, ChildAreaTransfer | their child is accessible |
| ScreeningSession | its child is accessible |
| ScreeningObservation, ScreeningResult, AiAnalysis | their session's child is accessible |
| MediaMetadata | its child is accessible; not deleted |

- Lists: `scopedWhere.<entity>(userId, permission)` goes into the Prisma `where`.
- Single records: `findChildOrDeny` / `assertInScopeOrDeny` -> **404 identical to "does not exist"**,
  audited as `<entity>.access_denied` with `recordExists` (for detecting ID probing).
- Inside a transaction, denials must pass `auditDb` (the root client) - otherwise the check
  refuses to run, because the audit row would be rolled back (Stage 1 defect, fixed).

## 6. Endpoints added in Stage 3

| Endpoint | Gate | Notes |
|---|---|---|
| `GET /children` | `child.read` | `search` (2-50 chars), `areaId` (narrows within scope), `page`, `pageSize` (≤ 50), `sort` (allowlist). `total` counts in-scope rows only. |
| `GET /children/:childId` | `child.read` | Profile + current guardians (no phone). Views audited as `child.viewed`. |
| `GET /auth/me` | authenticated | Now also returns `access.permissions` and `access.assignments` - **for the UI only**. |
| `GET /users` | `user.manage` | Users with a current assignment inside the caller's user.manage areas; never the caller. |
| `POST /users` | `user.manage` | Account + first assignment in one transaction; returns a one-time password. |
| `GET /users/:userId` | `user.manage` | Account + assignment history. |
| `POST /users/:userId/status` | `user.manage` | `ACTIVE` ↔ `SUSPENDED`, or `DEACTIVATED` (permanent). Leaving ACTIVE revokes all sessions. |
| `POST /users/:userId/reset-password` | `user.manage` | New one-time password, `mustChangePassword`, lock cleared, all sessions revoked. |
| `POST /users/:userId/revoke-sessions` | `user.manage` | Signs the user out everywhere. |
| `POST /assignments` | `assignment.manage` | Grant a role in an area to an existing user. |
| `POST /assignments/:id/end` | `assignment.manage` | Set or shorten the end date only; never extend or backdate. |
| `POST /assignments/:id/suspend` · `/reactivate` · `/revoke` | `assignment.manage` | Status transitions; invalid ones -> 409. |
| `GET /roles` | `assignment.manage` | Active roles with permission codes. |

Every write needs a `reason` (3-500 chars, no children's personal data). Request schemas are
strict: `status`, `passwordHash`, `createdById`, `mustChangePassword` etc. cannot be supplied.

### Example: create a worker

```http
POST /api/v1/users
Authorization: Bearer <district admin token>

{ "loginId": "EMP-0101", "displayName": "Synthetic Worker",
  "assignment": { "areaId": "<village id>", "roleId": "<ASHA role id>", "scope": "AREA_ONLY",
                  "reason": "Order 12/2026" } }
```

```json
201 { "user": { "id": "...", "loginId": "EMP-0101", "displayName": "Synthetic Worker", "status": "ACTIVE",
                "mustChangePassword": true, "lastLoginAt": null },
      "temporaryPassword": "K7QM-2XPA-9HTR" }
```

The temporary password (about 59 bits, unambiguous characters) is shown once, never stored or
logged; the administrator passes it on in person. Until it is changed, the account can only call
`/auth/me`, `/auth/change-password` and `/auth/logout-all`.

## 7. Delegation rules (privilege escalation)

To grant or change an assignment (design 4.4, amended by **D11**):

1. The actor holds `assignment.manage` (and, to create an account, also `user.manage`) over the
   area - over its **whole subtree** when granting `AREA_AND_DESCENDANTS`.
2. Every **management** permission of the role is one the actor holds there.
   **Fieldwork** permissions may be granted without being held (D11), so administrators who do not
   read child records can still provision field workers.
3. Nobody changes their own assignments or account (403 `SELF_MODIFICATION`).

To manage another **account** (status, reset, sessions, view): every current assignment of the target
must pass the rules above with `user.manage` - the target sits entirely inside the actor's areas
and holds no management power the actor lacks there. A worker who also works in another district
can only be managed by someone covering both.

| Situation | Response |
|---|---|
| Target user / assignment outside the actor's scope | 404 (looks unknown), audited `OUT_OF_SCOPE` |
| Area outside scope on create | 403 `OUT_OF_SCOPE`, audited |
| Role with management power the actor lacks | 403 `ROLE_EXCEEDS_OWN_PERMISSIONS`, audited |
| Own account or assignment | 403 `SELF_MODIFICATION`, audited |
| Overlapping assignment | 409 `ASSIGNMENT_OVERLAP` (database exclusion constraint) |

## 8. First administrator

```powershell
npm run db:seed
npm run db:bootstrap-admin -- --login-id ADMIN-0001 --display-name "State Administrator"
```

Creates a `STATE_ADMIN` at the root area with descendant scope and prints a one-time password.
Refuses whenever an active root administrator already exists, so it cannot mint extra admins.

## 9. Audit events added

`authz.denied` (403 at a route gate: permission, method, route pattern - never record ids),
`<entity>.access_denied`, `child.viewed`, `user.created`, `user.status_changed`,
`user.password_reset`, `user.sessions_revoked`, `user.denied`, `user.bootstrap_admin`,
`assignment.created`, `assignment.ended`, `assignment.suspended`, `assignment.reactivated`,
`assignment.revoked`, `assignment.denied` (with the rule that refused it).

## 10. Known limitations and risks (Stage 3)

| Item | Note |
|---|---|
| D11 residual risk | An administrator could create a second (worker) account and use it to read children. It is fully audited (`user.created`, `assignment.created`) but not technically prevented. A two-person approval or periodic audit review would close it - **programme decision**. |
| Role matrix is illustrative | D2 still open; changing it is a code + seed change, not a migration. |
| Reports, exports, dashboards | Not built yet. `countChildrenInScope` (report.aggregate) is tested; new report/export endpoints must use the scope filters and get leakage tests. |
| Other child-linked endpoints | Filters and IDOR tests exist for every entity; endpoints come in Step 4 and must use them. |
| Child-name search | Plain case-insensitive substring; no trigram index yet (design §10). |
| `child.viewed` audit volume | One row per profile view; review volume/retention with the programme (D8). |
| Performance at state scale | Scope queries are indexed EXISTS joins; not yet load-tested with a large synthetic dataset. |
