-- =====================================================================
-- BalSwasthya AI - least-privilege runtime database account.
--
-- Run as the schema OWNER (the account Prisma Migrate uses). Idempotent: safe to re-run,
-- and re-running also rotates the password.
-- Local:       npm run db:setup-roles   (reads the root .env, runs this file in Docker)
-- Production:  a DBA runs this file with psql, supplying the variables below.
--
-- psql variables:  app_user, app_password, db_name, owner_user
-- =====================================================================
\set ON_ERROR_STOP on
-- Terse errors: never echo the failing statement (it may contain the password).
\set VERBOSITY terse
\set SHOW_CONTEXT never

-- 1. Account: can log in, nothing else (no superuser, no DDL, no role creation).
SELECT format('CREATE ROLE %I LOGIN', :'app_user')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
ALTER ROLE :"app_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'app_password';

-- 2. Database: only listed accounts may connect.
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db_name" TO :"app_user";

-- 3. Schema: use, but never create or alter objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_user";

-- 4. Data access on existing and future tables created by the owner (i.e. by migrations).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";

-- 5. Exceptions (applied when the tables exist; re-run this script after the first migration).
--    AuditLog is append-only for the app (a trigger also blocks UPDATE/DELETE for everyone).
SELECT format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM %I', 'AuditLog', :'app_user')
 WHERE to_regclass('public."AuditLog"') IS NOT NULL \gexec
--    Consent is append-only (Step 5): a trigger blocks row DELETE and non-withdrawal UPDATEs for
--    everyone; TRUNCATE (which bypasses row triggers) is revoked from the app account.
SELECT format('REVOKE DELETE, TRUNCATE ON public.%I FROM %I', 'Consent', :'app_user')
 WHERE to_regclass('public."Consent"') IS NOT NULL \gexec
--    Screening records (Step 6): triggers block deleting sessions, categories and measurements
--    and changing final sessions for everyone; DELETE is also revoked where no delete is ever
--    legitimate, and TRUNCATE (which bypasses row triggers) is revoked on every screening table.
SELECT format('REVOKE DELETE, TRUNCATE ON public.%I FROM %I', t, :'app_user')
  FROM unnest(ARRAY['ScreeningSession', 'ScreeningSessionCategory', 'Measurement',
                    -- Step 6G: amendment history is append-only.
                    'ScreeningAmendment', 'ScreeningAmendmentChange',
                    'ScreeningAmendmentReferralImpact',
                    -- Step 7: rule sets, results, reviews, facilities, referrals and follow-ups
                    -- keep their history; nothing is ever deleted (triggers block it as well).
                    'ClinicalRuleSet', 'ClinicalRuleSetEvent', 'ScreeningResultRun',
                    'ScreeningResult', 'ClinicalReview', 'ClinicalReviewEvent',
                    'Facility', 'FacilityHistory', 'Referral', 'ReferralStatusEvent',
                    'FollowUp', 'FollowUpEvent',
                    -- Step 8 Parent Portal: accounts, invitations, codes, access, SMS log.
                    'ParentAccount', 'ParentInvitation', 'OtpChallenge', 'GuardianChildAccess',
                    'SmsMessage',
                    -- Step 8B Parent Care: content library and its history.
                    'CareContent', 'CareContentEvent']) AS t
 WHERE to_regclass(format('public.%I', t)) IS NOT NULL \gexec
SELECT format('REVOKE TRUNCATE ON public.%I FROM %I', t, :'app_user')
  FROM unnest(ARRAY['ScreeningProtocol', 'ScreeningQuestion', 'ScreeningObservation',
                    -- Step 7: notifications may be purged by a later retention job, never truncated.
                    'Notification']) AS t
 WHERE to_regclass(format('public.%I', t)) IS NOT NULL \gexec
--    The migration history table is the owner's business only.
SELECT format('REVOKE ALL ON public.%I FROM %I', '_prisma_migrations', :'app_user')
 WHERE to_regclass('public._prisma_migrations') IS NOT NULL \gexec

\echo 'Runtime account configured.'
