# Step 7 - Test report

> All numbers come from runs on 2026-11-24 on the development machine (Windows, PostgreSQL in Docker
> Desktop). Nothing below is estimated. Test data is synthetic.

## Final runs (stage 7G)

| Test category | Total | Passed | Failed | Status |
|---|---|---|---|---|
| Backend - API unit (Vitest) | 482 | 482 | 0 | Pass |
| Database / API integration (Vitest, real PostgreSQL) - full suite | 418 | 413 | 5 | See note: 5 timeouts (20 s) in one run; every file passes when run alone |
| Database / API - files re-run alone after the full run | 23 / 35 / 17 | 23 / 35 / 17 | 0 | Pass (referrals, screening sessions, amendments) |
| Frontend - worker app (Jest) | 3202 (20 skipped) | 3182 | 0 | Pass |
| Frontend - admin portal (Vitest) | 401 (5 skipped) | 396 | 0 | Pass (run alone) |
| Security (included above: route inventory 401s for all 47 Step 7 routes, scope / IDOR / mass-assignment / consent / role tests) | - | - | 0 | Pass |
| Regression (Steps 1-6 + admin portal suites, included above) | - | - | 0 | Pass (same timeout caveat for the DB suite) |
| Static checks: typecheck, ESLint, Prettier (whole repository), portal production build | - | - | - | Clean |
| Mutation checks (deliberate bugs that the tests must catch) | 7 | 7 caught | 0 | Pass |

**Database timeout note (open, S7-004).** Across three full database runs in stage 7G (the first
overlapping with the portal suite, the other two with nothing else running), 4-7 tests timed out at
20 s in one file per run - a different file each time (amendments, screening sessions, referrals). Each of these files passes completely when run alone, and earlier full runs passed
(7B 380/380, 7C 402/402, 7D 415/415). PostgreSQL's own statistics on this machine show 108
checkpoints with 2,023 s spent in disk sync (about 19 s each), so a test that coincides with a
checkpoint exceeds 20 s. Step 7 writes more per screening completion (result run, four results,
review task, notification), which makes this more frequent. This is reported as an environment
problem, not hidden: the timeout was **not** raised. Recommended: run the suite on a machine with
normal disk I/O (or CI) before release.

## What the Step 7 tests cover

| Area | Where | Examples |
|---|---|---|
| Rule DSL and evaluator | `services/api/tests/clinicalRules.test.ts` (38) | no negation; three-valued logic; missing / unknown / not-assessed / unreliable / conflicting input -> unknown; exact decimals and unit conversion; outcome selection; determinism; validation against protocols; demonstration sets contain no thresholds |
| Result generation and rule lifecycle | `tests/db/screeningResults.test.ts` (30) | completion and amendment create runs; draft / cancelled refused; idempotent backfill; versions kept; CLI lifecycle incl. approval reference, overlap, demonstration never approvable; DB rules for results, facilities, referrals, follow-ups, reviews, notifications |
| Clinical review, referrals, facilities | `tests/db/referrals.test.ts` (23) | scope 404 + audit; claim / version / decisions; review creates approved referral / follow-up; idempotent create, duplicates, mass assignment; rule-recommendation check; approval / reject / issue with consent / cancel; reassessment; facility selection and administration |
| Tracking, follow-ups, notifications, dashboards | `tests/db/followUps.test.ts` (13) | source-derived verification; corrections; closure rules; follow-up assignment / ownership / reschedule / missed / overdue; notifications own-only; reminder idempotency; dashboard scope; suppressed reports |
| Route authentication | `tests/apiSecurity.test.ts` | all 47 new routes return 401 without a token |
| Worker app screens | `tests/screens/results.test.tsx` (11), `referrals.test.tsx` (13), updated Step 4 dashboard tests, translation key checks | four layers kept apart; no reassuring wording; claim / decision; emergency notice; consent message; not-verified labels; follow-up completion does not close the referral; Hindi rendering |
| Admin portal | `tests/facilities.test.tsx` (4) | menu by permission; unverified creation; verification body; stale version error; suppressed report counts; no child data |

Mutation checks: missing answer read as "no"; unknown hidden by not-met; unfinished category reported
as no concern; consent check removed at issue; any reviewer allowed to decide; closing with open
follow-ups; family reports recorded as verified - all 7 caught.

## Not done

Device testing on low-cost Android phones, load / performance testing, external penetration test,
live end-to-end run of the Step 7 screens against the real API.
