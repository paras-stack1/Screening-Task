# Step 5 - Final report: child registration, guardians and consent

Branch `feat/step-5-children` (stages 5B `b99b680`, 5C `7c4a5a0`, 5D `1da4e86`, 5E `033deea`).
Decisions A-X approved 2026-11-21. All data used in development and tests is synthetic.

> Automated tests do not establish complete security or legal compliance. Independent security,
> privacy and programme/legal review is required before real children's data is used. The consent
> notice wording is a placeholder and the Hindi text needs expert review.

## 1. What was delivered

| Area | Implementation | Documentation |
|---|---|---|
| Schema (decision B) | Migration `20261121150000_step5_guardian_links_consent_integrity`: link history (`ChildGuardian.id`, created/ended by, end reason), one active link per pair and one primary contact (partial unique indexes), append-only `Consent` trigger, `withdrawalMethod`; DELETE/TRUNCATE on `Consent` revoked from the runtime account. Additive; applied to dev and test DBs | `docs/database-design.md` D12 |
| Child registration | `POST /children`: area scope + registration level, date rules (India date, no future, max 18 assumed, estimated ages), in-scope duplicate warnings (never merged, never cross-area), per-area serialisation, idempotent retries, single transaction with audit | `docs/api/children.md` |
| Guardians and links | Guardians created only with a child; encrypted phones (AES-256-GCM + HMAC lookup) masked except on the audited guardian view; link add/update/end with primary-contact and last-guardian rules; nested IDs verified as a chain | `docs/api/children.md` |
| Profile and updates | Profile, list with date filters, PATCH with optimistic concurrency; area cannot change | `docs/api/children.md` |
| Consent | Purpose-specific, versioned (hash-verified notices), append-only; latest decision wins; guardian authority; withdrawal of the current grant; status per purpose; `assertConsentPermits` gate for future steps; production refuses placeholder notices | `docs/api/consent.md` |
| Security | Route permission + record-level area scope everywhere, 404 for out-of-scope (audited), strict schemas, per-user rate limits, safe DB error mapping (409/503) | `docs/api/*.md` |
| Frontend | Children tab, registration, profile, edits, guardians, consent overview/capture/history/withdrawal, dashboard Register + recently registered; Hindi/English | `docs/frontend/children.md`, `docs/frontend/consent.md` |

## 2. Test results (actually executed)

### Backend unit (`services/api`, vitest) - 254 passed, 0 failed

| File | Passed | Covers |
|---|---|---|
| childRules.test.ts | 73 | dates/leap years/India day, names, phones, schemas (mass assignment), encryption |
| consentRules.test.ts | 16 | notice registry, purpose independence, consent schemas |
| apiSecurity.test.ts | 55 | route inventory (every new route requires a token), rate limits, headers |
| env.test.ts | 25 | incl. production requirement for distinct PII keys |
| other existing (jwt, password, errors, health, logger, AI client) | 85 | regression |

### Backend database (`npm run test:db`) - 235 passed, 0 failed (re-run on the final Step 5 code, 2026-11-22)

| File | Passed | Covers |
|---|---|---|
| children.test.ts | 44 | registration, validation, area scope, duplicates (privacy, twins, guardian phone, concurrency), idempotency, atomic rollback, profile, stale updates, guardians, scenario 4, links, scenario 5 (nested IDOR), DB constraints, consent trigger, rate limit |
| consent.test.ts | 30 | notices, capture, refusal, missing consent, wrong guardian/notice, protected fields, retries, concurrency, history, scenarios 1-5, withdrawal rules, enforcement, production policy |
| existing Step 3 suites | 161 | regression (authorization, auth, administration, scope, DB rules) |

Three deliberate code mutations of consent safety checks (ignore authority, skip guardian check,
ignore refusal) were each caught by the database tests.

### Frontend (`apps/worker-app`, jest) - 1,433 passed, 0 failed, 10 skipped

| File | Passed | Covers |
|---|---|---|
| screens/children.test.tsx | 27 | list/search, no-access role, registration validation, success, estimated age, network retry with same id, double tap, duplicate child/guardian flows, Hindi, profile masking, route links, stale edit, last guardian, consent-authority confirmation, guardian page |
| screens/consent.test.tsx | 14 | consent colours (missing never "agreed"), capture with confirmation and exact body, no preselection, authority filter, outdated notice, missing notice, Hindi, history, withdrawal |
| children/childValidation.test.ts | 18 | date boxes, India "today", request building, display, submission ids, URL encoding |
| localization/translations.test.ts | 1,143 | key parity, placeholders, Hindi present for every key |
| other existing suites | 231 | regression (auth, navigation, dashboard, components, API client, storage, contrast) |
| live/liveApi.test.ts | 0 (10 skipped) | opt-in live API check, not run |

The full parallel run, which previously timed out, now passes consistently (Jest `maxWorkers: 50%`).
One run of two files together failed once and did not reproduce in three later runs (recorded here
rather than hidden).

### Other checks

| Check | Result |
|---|---|
| TypeScript (all workspaces) | Pass |
| ESLint (all workspaces) | Pass, 0 warnings |
| Prettier (changed files) | Pass (`services/api/src/modules/README.md` was already unformatted) |
| `npm audit --omit=dev` | 24 advisories (4 high), all pre-existing and none introduced in Step 5; the high ones are in the Prisma CLI config loader (`@prisma/config`, `effect`, `deepmerge-ts`), not the runtime. npm's suggested fix changes the Prisma version, so it was not applied (Prisma 6 must stay) |
| Migration status | Applied to dev and test; `prisma migrate diff` shows no drift |

## 3. Defects found and fixed during Step 5

| Severity | Defect | Fix / regression test |
|---|---|---|
| Medium | An unlinked guardian could not be re-linked to the same child (would force duplicates) | Allowed for the same child; `children.test.ts` |
| Medium | Profile link used a typed-route form that did not resolve ("Page not found") | Plain encoded paths; `children.test.tsx` route-link tests |
| Low | Children list requested child records for roles without `child.read` | Query disabled; `children.test.tsx` |
| Low | Consent notices fetched before the guardian's language was known | Fetched after purpose choice; `consent.test.tsx` |
| Test infra | Frontend full-run timeouts | `maxWorkers: 50%` |

No Critical or High defects are known to be open.

## 4. Remaining risks

1. **Consent wording and legal basis**: placeholder text; methods (D7), who may consent, renewal
   and expiry are not legally reviewed. Production cannot record consent until notices are APPROVED.
2. **Hindi text** (Step 4 and Step 5) drafted by engineers - needs qualified review.
3. **`canGiveConsent`** is a worker declaration, not a verification of guardianship.
4. **Encryption keys**: loss of `PII_ENCRYPTION_KEY` makes stored phones unreadable; no rotation
   procedure yet (format is versioned for it).
5. **Rate limits** are in memory per API process (multiple instances need a shared store).
6. **Duplicate detection** is heuristic: similar names in other villages within the same worker
   scope are only checked within the same registration area.
7. **Partial unique indexes** are not expressible in Prisma 6: every future generated migration
   must be reviewed so they are not dropped.
8. **Supervisors** may read consent history (child.read) including free-text withdrawal reasons;
   the UI warns against personal data in reasons.
9. **Query performance at state scale** not load-tested.

## 5. Unresolved policy decisions (programme / legal)

Maximum registration age (18 assumed); sex-at-birth and relationship option lists; approved
consent notices and approver; accepted consent methods and evidence (D7); legal authority to
consent and its verification; whether media capture requires screening consent (assumed yes);
conflicting decisions between guardians (latest wins); renewal after notice changes; consent
expiry; retention and media handling after withdrawal (D8); child area transfer workflow;
deletion/archiving of records.

## 6. Setup and testing

```powershell
npm install
npm run db:up                 # Docker Desktop must be running
npm run db:migrate            # or, non-destructive: npx prisma migrate deploy (services/api)
npm run db:setup-roles        # re-applies runtime-account grants (Consent DELETE/TRUNCATE revoked)
npm run db:seed               # reference data + DRAFT placeholder consent notices
# services/api/.env needs PII_ENCRYPTION_KEY and PII_LOOKUP_KEY (see .env.example)
npm run typecheck; npm run lint; npm test; npm run test:db
```

## 7. Files

New backend: `services/api/src/modules/children/{birthDate,childDto,nameMatching}.ts`,
`modules/guardians/*`, `modules/consent/*`, `utils/{idempotency,piiCrypto}.ts`, the migration,
`tests/{childRules,consentRules}.test.ts`, `tests/db/{children,consent}.test.ts`.
New contracts: `packages/shared-contracts/src/{dates,people,guardians,consent}.ts`.
New frontend: `apps/worker-app/app/(app)/children/**`, `src/features/{children,consent}/**`,
`src/components/forms/ChoiceGroup.tsx`, `src/utils/submissionId.ts`, tests and fakes.
Docs: `docs/api/{children,consent}.md`, `docs/frontend/{children,consent}.md`, this report.
