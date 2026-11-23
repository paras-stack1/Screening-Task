-- =====================================================================================
-- Step 6G (approved 2026-11-23; docs/step-6/amendment-design.md): amendments of COMPLETED
-- screenings as append-only versions. Additive: three new tables; no existing table, column,
-- row or trigger is changed (the completed-session lock stays as it is).
-- =====================================================================================

-- CreateEnum
CREATE TYPE "AmendmentBasis" AS ENUM ('CONDUCTOR_WITHIN_WINDOW', 'MEDICAL_OFFICER');
-- CreateEnum
CREATE TYPE "AmendmentReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'REVIEWED');
-- CreateEnum
CREATE TYPE "AmendmentChangeKind" AS ENUM ('RESPONSE', 'MEASUREMENT', 'CATEGORY_NOTES');
-- CreateEnum
CREATE TYPE "ReassessmentStatus" AS ENUM ('PENDING', 'REASSESSED');
-- CreateTable
CREATE TABLE "ScreeningAmendment" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amendedById" UUID NOT NULL,
    "amendedAt" TIMESTAMPTZ(3) NOT NULL,
    "basis" "AmendmentBasis" NOT NULL,
    "reason" TEXT NOT NULL,
    "clinicallySignificant" BOOLEAN NOT NULL,
    "reviewStatus" "AmendmentReviewStatus" NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNotes" TEXT,
    "clientOperationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScreeningAmendment_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ScreeningAmendmentChange" (
    "id" UUID NOT NULL,
    "amendmentId" UUID NOT NULL,
    "kind" "AmendmentChangeKind" NOT NULL,
    "sessionCategoryId" UUID,
    "questionId" UUID,
    "measurementId" UUID,
    "oldValue" JSONB,
    "newValue" JSONB,
    "clinicallySignificant" BOOLEAN NOT NULL,
    CONSTRAINT "ScreeningAmendmentChange_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ScreeningAmendmentReferralImpact" (
    "id" UUID NOT NULL,
    "amendmentId" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "referralStatusAtAmendment" "ReferralStatus" NOT NULL,
    "reassessmentStatus" "ReassessmentStatus" NOT NULL DEFAULT 'PENDING',
    "reassessedById" UUID,
    "reassessedAt" TIMESTAMPTZ(3),
    CONSTRAINT "ScreeningAmendmentReferralImpact_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "ScreeningAmendment_clientOperationId_key" ON "ScreeningAmendment"("clientOperationId");
-- CreateIndex
CREATE INDEX "ScreeningAmendment_reviewStatus_amendedAt_idx" ON "ScreeningAmendment"("reviewStatus", "amendedAt");
-- CreateIndex
CREATE UNIQUE INDEX "ScreeningAmendment_sessionId_sequence_key" ON "ScreeningAmendment"("sessionId", "sequence");
-- CreateIndex
CREATE INDEX "ScreeningAmendmentChange_amendmentId_idx" ON "ScreeningAmendmentChange"("amendmentId");
-- CreateIndex
CREATE INDEX "ScreeningAmendmentReferralImpact_referralId_reassessmentSta_idx" ON "ScreeningAmendmentReferralImpact"("referralId", "reassessmentStatus");
-- CreateIndex
CREATE UNIQUE INDEX "ScreeningAmendmentReferralImpact_amendmentId_referralId_key" ON "ScreeningAmendmentReferralImpact"("amendmentId", "referralId");
-- AddForeignKey
ALTER TABLE "ScreeningAmendment" ADD CONSTRAINT "ScreeningAmendment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendment" ADD CONSTRAINT "ScreeningAmendment_amendedById_fkey" FOREIGN KEY ("amendedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendment" ADD CONSTRAINT "ScreeningAmendment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendmentChange" ADD CONSTRAINT "ScreeningAmendmentChange_amendmentId_fkey" FOREIGN KEY ("amendmentId") REFERENCES "ScreeningAmendment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendmentChange" ADD CONSTRAINT "ScreeningAmendmentChange_sessionCategoryId_fkey" FOREIGN KEY ("sessionCategoryId") REFERENCES "ScreeningSessionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendmentChange" ADD CONSTRAINT "ScreeningAmendmentChange_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ScreeningQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendmentChange" ADD CONSTRAINT "ScreeningAmendmentChange_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendmentReferralImpact" ADD CONSTRAINT "ScreeningAmendmentReferralImpact_amendmentId_fkey" FOREIGN KEY ("amendmentId") REFERENCES "ScreeningAmendment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendmentReferralImpact" ADD CONSTRAINT "ScreeningAmendmentReferralImpact_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScreeningAmendmentReferralImpact" ADD CONSTRAINT "ScreeningAmendmentReferralImpact_reassessedById_fkey" FOREIGN KEY ("reassessedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Integrity rules (hand-written). Prisma 6 cannot express these: review every future generated
-- migration so they are never dropped.
-- =====================================================================================

ALTER TABLE "ScreeningAmendment" ADD CONSTRAINT amendment_sequence_positive CHECK ("sequence" >= 1);
ALTER TABLE "ScreeningAmendment" ADD CONSTRAINT amendment_reason_present CHECK (length("reason") > 0);
-- Significant changes are reviewed (PENDING -> REVIEWED); others never need review (decision G5).
ALTER TABLE "ScreeningAmendment" ADD CONSTRAINT amendment_review_matches_significance
  CHECK ("clinicallySignificant" = ("reviewStatus" <> 'NOT_REQUIRED'));
ALTER TABLE "ScreeningAmendment" ADD CONSTRAINT amendment_review_complete CHECK (
  ("reviewStatus" = 'REVIEWED') = ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL)
  AND ("reviewNotes" IS NULL OR "reviewStatus" = 'REVIEWED')
);

-- Each change points at exactly the kind of item it amends.
ALTER TABLE "ScreeningAmendmentChange" ADD CONSTRAINT amendment_change_target CHECK (
  ("kind" = 'RESPONSE' AND "questionId" IS NOT NULL AND "sessionCategoryId" IS NOT NULL AND "measurementId" IS NULL)
  OR ("kind" = 'MEASUREMENT' AND "measurementId" IS NOT NULL AND "questionId" IS NULL AND "sessionCategoryId" IS NULL)
  OR ("kind" = 'CATEGORY_NOTES' AND "sessionCategoryId" IS NOT NULL AND "questionId" IS NULL AND "measurementId" IS NULL)
);

ALTER TABLE "ScreeningAmendmentReferralImpact" ADD CONSTRAINT referral_impact_reassessment_complete CHECK (
  ("reassessmentStatus" = 'REASSESSED') = ("reassessedById" IS NOT NULL AND "reassessedAt" IS NOT NULL)
);

/** True when the amendment row was inserted by the CURRENT transaction (append-only grouping). */
CREATE OR REPLACE FUNCTION screening_amendment_is_new(amendment_id UUID) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "ScreeningAmendment"
     WHERE "id" = amendment_id AND xmin = pg_current_xact_id()::xid
  );
$$ LANGUAGE sql VOLATILE;

-- ------------------------------------------------------------------ amendment rows
CREATE OR REPLACE FUNCTION screening_amendment_protect() RETURNS trigger AS $$
DECLARE
  s_status "SessionStatus";
  last_sequence INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Screening amendments cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Lock the (immutable) session row: concurrent amendments of one session are serialised.
    SELECT "status" INTO s_status FROM "ScreeningSession" WHERE "id" = NEW."sessionId" FOR UPDATE;
    IF s_status IS DISTINCT FROM 'COMPLETED' THEN
      RAISE EXCEPTION 'Only a completed screening can be amended' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(MAX("sequence"), 0) INTO last_sequence
      FROM "ScreeningAmendment" WHERE "sessionId" = NEW."sessionId";
    IF NEW."sequence" <> last_sequence + 1 THEN
      RAISE EXCEPTION 'Amendment sequence must follow the latest version (concurrent amendment)'
        USING ERRCODE = 'serialization_failure';
    END IF;
    IF NEW."reviewStatus" = 'REVIEWED' THEN
      RAISE EXCEPTION 'A new amendment cannot already be reviewed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only the one-time review of a PENDING amendment.
  IF NOT (OLD."reviewStatus" = 'PENDING' AND NEW."reviewStatus" = 'REVIEWED') THEN
    RAISE EXCEPTION 'Screening amendments are append-only (only a one-time review is allowed)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."sessionId", NEW."sequence", NEW."amendedById", NEW."amendedAt", NEW."basis",
      NEW."reason", NEW."clinicallySignificant", NEW."clientOperationId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."sessionId", OLD."sequence", OLD."amendedById", OLD."amendedAt", OLD."basis",
      OLD."reason", OLD."clinicallySignificant", OLD."clientOperationId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Recorded amendment fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_amendment_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "ScreeningAmendment"
  FOR EACH ROW EXECUTE FUNCTION screening_amendment_protect();

-- -------------------------------------------------------------------- change rows
CREATE OR REPLACE FUNCTION screening_amendment_change_protect() RETURNS trigger AS $$
DECLARE
  a_session UUID;
  c RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Amendment changes are append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT screening_amendment_is_new(NEW."amendmentId") THEN
    RAISE EXCEPTION 'Changes can only be added together with their amendment' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "sessionId" INTO a_session FROM "ScreeningAmendment" WHERE "id" = NEW."amendmentId";

  IF NEW."sessionCategoryId" IS NOT NULL THEN
    SELECT "sessionId", "protocolId" INTO c FROM "ScreeningSessionCategory" WHERE "id" = NEW."sessionCategoryId";
    IF NOT FOUND OR c."sessionId" <> a_session THEN
      RAISE EXCEPTION 'Amended area belongs to another screening' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."questionId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "ScreeningQuestion" WHERE "id" = NEW."questionId" AND "protocolId" = c."protocolId") THEN
      RAISE EXCEPTION 'Amended question does not belong to the protocol version of that area'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."measurementId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "Measurement" WHERE "id" = NEW."measurementId" AND "sessionId" = a_session) THEN
    RAISE EXCEPTION 'Amended measurement belongs to another screening' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_amendment_change_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "ScreeningAmendmentChange"
  FOR EACH ROW EXECUTE FUNCTION screening_amendment_change_protect();

-- ------------------------------------------------------------- referral impact rows
CREATE OR REPLACE FUNCTION screening_referral_impact_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Referral reassessment flags cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT screening_amendment_is_new(NEW."amendmentId") THEN
      RAISE EXCEPTION 'Referral flags can only be added together with their amendment'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM "Referral" r JOIN "ScreeningAmendment" a ON a."sessionId" = r."sessionId"
          WHERE r."id" = NEW."referralId" AND a."id" = NEW."amendmentId") THEN
      RAISE EXCEPTION 'Referral was not made from this screening' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the one-time reassessment (Step 7 referral module).
  IF NOT (OLD."reassessmentStatus" = 'PENDING' AND NEW."reassessmentStatus" = 'REASSESSED')
     OR (NEW."id", NEW."amendmentId", NEW."referralId", NEW."referralStatusAtAmendment")
        IS DISTINCT FROM (OLD."id", OLD."amendmentId", OLD."referralId", OLD."referralStatusAtAmendment") THEN
    RAISE EXCEPTION 'Referral reassessment flags are append-only (only a one-time reassessment is allowed)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER screening_referral_impact_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "ScreeningAmendmentReferralImpact"
  FOR EACH ROW EXECUTE FUNCTION screening_referral_impact_protect();
