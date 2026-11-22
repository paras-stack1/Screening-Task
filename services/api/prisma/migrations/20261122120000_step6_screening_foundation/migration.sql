-- =====================================================================================
-- Step 6 (approved decisions A-K, N, O; docs/step-6/initial-audit.md section 8), 2026-11-22.
-- Screening foundation: per-category versioned protocols, session/category/response integrity,
-- insert-only measurements with correction chains.
--
-- Additive: no column or row is dropped. The new NOT NULL columns have no defaults, so the
-- migration first REFUSES to run if any screening table already holds rows (they were empty when
-- this was written; a non-empty table needs a reviewed backfill, never a guessed one).
--
-- NOTE for future `prisma migrate dev` runs: the partial unique index, exclusion constraint,
-- CHECK constraints and triggers below are not expressible in Prisma 6. Review every generated
-- migration so they are never dropped.
-- =====================================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ScreeningProtocol") OR EXISTS (SELECT 1 FROM "ScreeningQuestion")
     OR EXISTS (SELECT 1 FROM "ScreeningSession") OR EXISTS (SELECT 1 FROM "ScreeningObservation")
     OR EXISTS (SELECT 1 FROM "Measurement") THEN
    RAISE EXCEPTION 'Step 6 migration expects empty screening tables; a data backfill must be designed first';
  END IF;
END $$;

-- ------------------------------------------------------------------------- enums
CREATE TYPE "ProtocolStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED');
CREATE TYPE "CategoryProgress" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "ResponseSource" AS ENUM ('WORKER_OBSERVED', 'GUARDIAN_REPORTED');
CREATE TYPE "MeasurementSource" AS ENUM ('MEASURED', 'GUARDIAN_REPORTED', 'FROM_RECORD');
-- The new value is not used by any statement in this migration (PostgreSQL forbids using an enum
-- value in the transaction that added it).
ALTER TYPE "ObservationStatus" ADD VALUE 'UNKNOWN';

-- ---------------------------------------------------------------- ScreeningProtocol
ALTER TABLE "ScreeningProtocol"
  ADD COLUMN "category" "FourDCategory" NOT NULL,
  ADD COLUMN "descriptionEn" TEXT,
  ADD COLUMN "descriptionHi" TEXT,
  ADD COLUMN "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "approvalReference" TEXT,
  ADD COLUMN "effectiveFrom" TIMESTAMPTZ(3),
  ADD COLUMN "retiredAt" TIMESTAMPTZ(3);

-- Change the status type in place (Prisma would drop and re-add the column).
ALTER TABLE "ScreeningProtocol" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ScreeningProtocol"
  ALTER COLUMN "status" TYPE "ProtocolStatus" USING ("status"::text::"ProtocolStatus");
ALTER TABLE "ScreeningProtocol" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE INDEX "ScreeningProtocol_category_status_ageMinDays_ageMaxDays_idx"
  ON "ScreeningProtocol"("category", "status", "ageMinDays", "ageMaxDays");

-- ---------------------------------------------------------------- ScreeningQuestion
ALTER TABLE "ScreeningQuestion"
  ADD COLUMN "sectionCode" TEXT NOT NULL,
  ADD COLUMN "prompt" JSONB NOT NULL,
  ADD COLUMN "help" JSONB,
  ADD COLUMN "validation" JSONB;

-- ----------------------------------------------------------------- ScreeningSession
ALTER TABLE "ScreeningSession"
  ALTER COLUMN "protocolId" DROP NOT NULL,
  ADD COLUMN "dateOfBirthAtStart" DATE NOT NULL,
  ADD COLUMN "dobEstimatedAtStart" BOOLEAN NOT NULL,
  ADD COLUMN "screeningConsentId" UUID NOT NULL,
  ADD COLUMN "cancelledById" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "clientOperationId" UUID;

CREATE UNIQUE INDEX "ScreeningSession_clientOperationId_key" ON "ScreeningSession"("clientOperationId");
CREATE INDEX "ScreeningSession_conductedById_status_updatedAt_idx"
  ON "ScreeningSession"("conductedById", "status", "updatedAt");

ALTER TABLE "ScreeningSession" ADD CONSTRAINT "ScreeningSession_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScreeningSession" ADD CONSTRAINT "ScreeningSession_screeningConsentId_fkey"
  FOREIGN KEY ("screeningConsentId") REFERENCES "Consent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --------------------------------------------------------- ScreeningSessionCategory
CREATE TABLE "ScreeningSessionCategory" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "category" "FourDCategory" NOT NULL,
    "protocolId" UUID NOT NULL,
    "protocolStatusAtStart" "ProtocolStatus" NOT NULL,
    "status" "CategoryProgress" NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ScreeningSessionCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScreeningSessionCategory_sessionId_category_key"
  ON "ScreeningSessionCategory"("sessionId", "category");
CREATE INDEX "ScreeningSessionCategory_protocolId_idx" ON "ScreeningSessionCategory"("protocolId");
ALTER TABLE "ScreeningSessionCategory" ADD CONSTRAINT "ScreeningSessionCategory_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScreeningSessionCategory" ADD CONSTRAINT "ScreeningSessionCategory_protocolId_fkey"
  FOREIGN KEY ("protocolId") REFERENCES "ScreeningProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------- ScreeningObservation
ALTER TABLE "ScreeningObservation"
  ADD COLUMN "sessionCategoryId" UUID NOT NULL,
  ADD COLUMN "source" "ResponseSource" NOT NULL,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "recordedById" UUID NOT NULL,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL;
CREATE INDEX "ScreeningObservation_sessionCategoryId_idx" ON "ScreeningObservation"("sessionCategoryId");
ALTER TABLE "ScreeningObservation" ADD CONSTRAINT "ScreeningObservation_sessionCategoryId_fkey"
  FOREIGN KEY ("sessionCategoryId") REFERENCES "ScreeningSessionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScreeningObservation" ADD CONSTRAINT "ScreeningObservation_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------- Measurement
ALTER TABLE "Measurement"
  ADD COLUMN "source" "MeasurementSource" NOT NULL,
  ADD COLUMN "supersedesId" UUID,
  ADD COLUMN "correctionReason" TEXT,
  ADD COLUMN "notes" TEXT;
CREATE UNIQUE INDEX "Measurement_supersedesId_key" ON "Measurement"("supersedesId");
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "Measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Integrity rules (hand-written)
-- =====================================================================================

-- ------------------------------------------------------- protocol governance checks
ALTER TABLE "ScreeningProtocol" ADD CONSTRAINT protocol_version_positive CHECK ("version" >= 1);
-- From APPROVED on: who approved, when, under which reference, exactly which content.
-- Demonstration content can never reach APPROVED, ACTIVE or RETIRED.
ALTER TABLE "ScreeningProtocol" ADD CONSTRAINT protocol_approval_complete CHECK (
  "status" IN ('DRAFT', 'IN_REVIEW')
  OR ("clinicalApprovedById" IS NOT NULL AND "clinicalApprovedAt" IS NOT NULL
      AND "approvalReference" IS NOT NULL AND "contentSha256" IS NOT NULL AND NOT "isDemonstration")
);
-- Review is of a fixed content hash.
ALTER TABLE "ScreeningProtocol" ADD CONSTRAINT protocol_review_has_hash
  CHECK ("status" = 'DRAFT' OR "contentSha256" IS NOT NULL);
ALTER TABLE "ScreeningProtocol" ADD CONSTRAINT protocol_active_has_effective_date
  CHECK ("status" <> 'ACTIVE' OR "effectiveFrom" IS NOT NULL);
ALTER TABLE "ScreeningProtocol" ADD CONSTRAINT protocol_retired_at
  CHECK (("status" = 'RETIRED') = ("retiredAt" IS NOT NULL));
-- Two ACTIVE protocols of the same category never cover the same age: selection is unambiguous.
ALTER TABLE "ScreeningProtocol" ADD CONSTRAINT screening_protocol_one_active_per_band
  EXCLUDE USING gist ("category" WITH =, int4range("ageMinDays", "ageMaxDays", '[]') WITH &&)
  WHERE ("status" = 'ACTIVE');

CREATE OR REPLACE FUNCTION screening_protocol_in_use(protocol_id UUID) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM "ScreeningSessionCategory" WHERE "protocolId" = protocol_id);
$$ LANGUAGE sql STABLE;

-- --------------------------------------------------------------- protocol protection
CREATE OR REPLACE FUNCTION screening_protocol_protect() RETURNS trigger AS $$
DECLARE
  frozen boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only DRAFT screening protocols can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- Allowed lifecycle moves (decision B).
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT'     AND NEW."status" = 'IN_REVIEW')
    OR (OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('DRAFT', 'APPROVED'))
    OR (OLD."status" = 'APPROVED'  AND NEW."status" IN ('ACTIVE', 'RETIRED'))
    OR (OLD."status" = 'ACTIVE'    AND NEW."status" = 'RETIRED')) THEN
    RAISE EXCEPTION 'Screening protocol status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'IN_REVIEW'
     AND NOT EXISTS (SELECT 1 FROM "ScreeningQuestion" WHERE "protocolId" = NEW."id") THEN
    RAISE EXCEPTION 'A screening protocol without questions cannot be submitted for review'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Content is frozen once the protocol left DRAFT or any session used it (decision D).
  frozen := OLD."status" <> 'DRAFT' OR screening_protocol_in_use(OLD."id");
  IF frozen AND (NEW."id", NEW."code", NEW."version", NEW."category", NEW."nameEn", NEW."nameHi",
                 NEW."descriptionEn", NEW."descriptionHi", NEW."ageMinDays", NEW."ageMaxDays",
                 NEW."sourceReference", NEW."isDemonstration", NEW."createdAt")
     IS DISTINCT FROM
                (OLD."id", OLD."code", OLD."version", OLD."category", OLD."nameEn", OLD."nameHi",
                 OLD."descriptionEn", OLD."descriptionHi", OLD."ageMinDays", OLD."ageMaxDays",
                 OLD."sourceReference", OLD."isDemonstration", OLD."createdAt") THEN
    RAISE EXCEPTION 'Screening protocol content is frozen; create a new version'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The reviewed hash may only be cleared by sending the protocol back to DRAFT.
  IF OLD."status" <> 'DRAFT' AND NOT (OLD."status" = 'IN_REVIEW' AND NEW."status" = 'DRAFT')
     AND NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256" THEN
    RAISE EXCEPTION 'Screening protocol content hash is frozen' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" IN ('APPROVED', 'ACTIVE', 'RETIRED')
     AND (NEW."clinicalApprovedById", NEW."clinicalApprovedAt", NEW."approvalReference")
         IS DISTINCT FROM (OLD."clinicalApprovedById", OLD."clinicalApprovedAt", OLD."approvalReference") THEN
    RAISE EXCEPTION 'Screening protocol approval record is immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" IN ('ACTIVE', 'RETIRED') AND NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" THEN
    RAISE EXCEPTION 'Screening protocol effective date is immutable once active' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" = 'RETIRED' AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
    RAISE EXCEPTION 'Screening protocol retirement is immutable' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_protocol_protect
  BEFORE UPDATE OR DELETE ON "ScreeningProtocol"
  FOR EACH ROW EXECUTE FUNCTION screening_protocol_protect();

-- --------------------------------------------------------------- question protection
-- Questions change only while their protocol is an unused DRAFT. FOR UPDATE on the protocol row
-- serialises with category starts (FOR SHARE) and status changes, so a question can never slip in
-- after review or first use.
CREATE OR REPLACE FUNCTION screening_question_protect() RETURNS trigger AS $$
DECLARE
  p RECORD;
  pid UUID;
BEGIN
  FOREACH pid IN ARRAY ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."protocolId" END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."protocolId" END]) AS x WHERE x IS NOT NULL) LOOP
    SELECT "status", "category" INTO p FROM "ScreeningProtocol" WHERE "id" = pid FOR UPDATE;
    IF p."status" <> 'DRAFT' OR screening_protocol_in_use(pid) THEN
      RAISE EXCEPTION 'Questions of a reviewed, approved or used screening protocol are frozen; create a new version'
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP <> 'DELETE' AND pid = NEW."protocolId" AND NEW."category" <> p."category" THEN
      RAISE EXCEPTION 'Question category must match its protocol category' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_question_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "ScreeningQuestion"
  FOR EACH ROW EXECUTE FUNCTION screening_question_protect();

-- ------------------------------------------------------------------- session rules
-- At most one open session per child (decision K).
CREATE UNIQUE INDEX screening_one_open_session_per_child
  ON "ScreeningSession"("childId") WHERE "status" IN ('DRAFT', 'IN_PROGRESS');

ALTER TABLE "ScreeningSession" ADD CONSTRAINT session_age_non_negative CHECK ("ageInDaysAtStart" >= 0);
ALTER TABLE "ScreeningSession" ADD CONSTRAINT session_version_positive CHECK ("version" >= 1);
ALTER TABLE "ScreeningSession" ADD CONSTRAINT session_completed_at
  CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL));
ALTER TABLE "ScreeningSession" ADD CONSTRAINT session_cancellation_complete CHECK (
  ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND "cancelReason" IS NOT NULL)
  OR ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL)
);

/** Raises unless the session exists and is open; locks it against a concurrent finalisation. */
CREATE OR REPLACE FUNCTION screening_assert_session_open(session_id UUID) RETURNS "ScreeningSession" AS $$
DECLARE
  s "ScreeningSession";
BEGIN
  SELECT * INTO s FROM "ScreeningSession" WHERE "id" = session_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Screening session not found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF s."status" NOT IN ('DRAFT', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Screening session is % and can no longer be changed', s."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN s;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION screening_session_protect() RETURNS trigger AS $$
DECLARE
  c RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Screening sessions cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'IN_PROGRESS') OR NEW."version" <> 1 OR NEW."protocolId" IS NOT NULL THEN
      RAISE EXCEPTION 'A new screening session must be open, at version 1, without the deprecated protocolId'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT "childId", "purpose", "decision", "withdrawnAt" INTO c FROM "Consent" WHERE "id" = NEW."screeningConsentId";
    IF NOT FOUND OR c."childId" <> NEW."childId" OR c."purpose" <> 'SCREENING'
       OR c."decision" <> 'GRANTED' OR c."withdrawnAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Screening session must reference a granted, not withdrawn SCREENING consent of the same child'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Screening session is % and can no longer be changed', OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."childId", NEW."protocolId", NEW."conductedById", NEW."areaId", NEW."ageInDaysAtStart",
      NEW."dateOfBirthAtStart", NEW."dobEstimatedAtStart", NEW."screeningConsentId", NEW."startedAt",
      NEW."clientOperationId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."childId", OLD."protocolId", OLD."conductedById", OLD."areaId", OLD."ageInDaysAtStart",
      OLD."dateOfBirthAtStart", OLD."dobEstimatedAtStart", OLD."screeningConsentId", OLD."startedAt",
      OLD."clientOperationId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Recorded screening session fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Screening session version must increase by exactly 1 (concurrent change)'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT'       AND NEW."status" IN ('IN_PROGRESS', 'CANCELLED'))
    OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" IN ('COMPLETED', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'Screening session status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'COMPLETED' AND NOT EXISTS (
       SELECT 1 FROM "ScreeningSessionCategory" WHERE "sessionId" = NEW."id" AND "status" = 'COMPLETED') THEN
    RAISE EXCEPTION 'A screening session needs at least one completed category to be completed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_session_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "ScreeningSession"
  FOR EACH ROW EXECUTE FUNCTION screening_session_protect();

-- -------------------------------------------------------------------- category rules
ALTER TABLE "ScreeningSessionCategory" ADD CONSTRAINT session_category_completed_at
  CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL));

CREATE OR REPLACE FUNCTION screening_category_protect() RETURNS trigger AS $$
DECLARE
  s "ScreeningSession";
  p RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Screening categories cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  s := screening_assert_session_open(NEW."sessionId");

  IF TG_OP = 'INSERT' THEN
    SELECT "status", "category", "ageMinDays", "ageMaxDays" INTO p
      FROM "ScreeningProtocol" WHERE "id" = NEW."protocolId" FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Screening protocol not found' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF p."category" <> NEW."category" THEN
      RAISE EXCEPTION 'Protocol category does not match the screening category' USING ERRCODE = 'check_violation';
    END IF;
    -- DRAFT is accepted here only because the draft policy depends on the environment; the API
    -- refuses DRAFT protocols in production. IN_REVIEW, APPROVED (not yet active) and RETIRED never.
    IF p."status" NOT IN ('ACTIVE', 'DRAFT') OR NEW."protocolStatusAtStart" <> p."status" THEN
      RAISE EXCEPTION 'Screening protocol is not usable (status %)', p."status" USING ERRCODE = 'check_violation';
    END IF;
    IF s."ageInDaysAtStart" NOT BETWEEN p."ageMinDays" AND p."ageMaxDays" THEN
      RAISE EXCEPTION 'Screening protocol does not cover the child''s age' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF (NEW."id", NEW."sessionId", NEW."category", NEW."protocolId", NEW."protocolStatusAtStart",
      NEW."startedAt", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."sessionId", OLD."category", OLD."protocolId", OLD."protocolStatusAtStart",
      OLD."startedAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'Recorded screening category fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  -- Completion needs an explicit state for every required question (decision N).
  IF NEW."status" = 'COMPLETED' AND OLD."status" <> 'COMPLETED' AND EXISTS (
       SELECT 1 FROM "ScreeningQuestion" q
        WHERE q."protocolId" = NEW."protocolId" AND q."isRequired"
          AND NOT EXISTS (SELECT 1 FROM "ScreeningObservation" o
                           WHERE o."sessionCategoryId" = NEW."id" AND o."questionId" = q."id")) THEN
    RAISE EXCEPTION 'Every required question needs an explicit answer state before the category is completed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_category_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "ScreeningSessionCategory"
  FOR EACH ROW EXECUTE FUNCTION screening_category_protect();

-- ----------------------------------------------------------------- observation rules
-- ANSWERED carries a value; every other state carries none (missing data is never a value).
ALTER TABLE "ScreeningObservation" ADD CONSTRAINT observation_value_matches_status CHECK (
  ("status" = 'ANSWERED' AND ("valueBoolean" IS NOT NULL OR "valueCode" IS NOT NULL
     OR COALESCE(cardinality("valueCodes"), 0) > 0 OR "valueNumber" IS NOT NULL OR "valueText" IS NOT NULL))
  OR ("status" <> 'ANSWERED' AND "valueBoolean" IS NULL AND "valueCode" IS NULL
     AND COALESCE(cardinality("valueCodes"), 0) = 0 AND "valueNumber" IS NULL AND "valueText" IS NULL)
);
ALTER TABLE "ScreeningObservation" ADD CONSTRAINT observation_reason_only_when_not_assessed
  CHECK ("notAssessedReason" IS NULL OR "status" IN ('NOT_ASSESSED', 'UNABLE_TO_ASSESS'));

CREATE OR REPLACE FUNCTION screening_observation_protect() RETURNS trigger AS $$
DECLARE
  r "ScreeningObservation";
  c RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM screening_assert_session_open(r."sessionId");

  IF TG_OP = 'UPDATE' AND (NEW."id", NEW."sessionId", NEW."sessionCategoryId", NEW."questionId")
                          IS DISTINCT FROM (OLD."id", OLD."sessionId", OLD."sessionCategoryId", OLD."questionId") THEN
    RAISE EXCEPTION 'Screening answer identity fields are immutable' USING ERRCODE = 'check_violation';
  END IF;

  SELECT "sessionId", "protocolId", "status" INTO c FROM "ScreeningSessionCategory" WHERE "id" = r."sessionCategoryId";
  IF NOT FOUND OR c."sessionId" <> r."sessionId" THEN
    RAISE EXCEPTION 'Screening answer category belongs to another session' USING ERRCODE = 'check_violation';
  END IF;
  IF c."status" <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Answers of a completed category cannot change; reopen the category first'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (
       SELECT 1 FROM "ScreeningQuestion" WHERE "id" = r."questionId" AND "protocolId" = c."protocolId") THEN
    RAISE EXCEPTION 'Question does not belong to the protocol version used for this category'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_observation_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "ScreeningObservation"
  FOR EACH ROW EXECUTE FUNCTION screening_observation_protect();

-- ----------------------------------------------------------------- measurement rules
ALTER TABLE "Measurement" ADD CONSTRAINT measurement_correction_complete
  CHECK (("supersedesId" IS NULL) = ("correctionReason" IS NULL));

CREATE OR REPLACE FUNCTION screening_measurement_protect() RETURNS trigger AS $$
DECLARE
  s "ScreeningSession";
  old_m RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Measurements are insert-only; record a correction instead' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."sessionId" IS NOT NULL THEN
    s := screening_assert_session_open(NEW."sessionId");
    IF s."childId" <> NEW."childId" THEN
      RAISE EXCEPTION 'Measurement child does not match the screening session child' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."supersedesId" IS NOT NULL THEN
    SELECT "childId", "sessionId", "type" INTO old_m FROM "Measurement" WHERE "id" = NEW."supersedesId";
    IF NOT FOUND OR old_m."childId" <> NEW."childId" OR old_m."type" <> NEW."type"
       OR old_m."sessionId" IS DISTINCT FROM NEW."sessionId" THEN
      RAISE EXCEPTION 'A correction must be of the same child, session and measurement type'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_measurement_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "Measurement"
  FOR EACH ROW EXECUTE FUNCTION screening_measurement_protect();
