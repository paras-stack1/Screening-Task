-- =====================================================================================
-- Step 7 (approved decisions A-X, docs/step-7/architecture.md and schema-change-proposal.md),
-- 2026-11-24. Clinical rule sets, result runs, clinical review, and the reshaped facility,
-- referral, follow-up and notification tables.
--
-- The tables reshaped here were EMPTY when this was written. The guard below REFUSES to run if any
-- of them holds rows: enum values are removed and NOT NULL columns are added without a backfill.
--
-- NOTE for future `prisma migrate` runs: the partial unique indexes, exclusion constraint, CHECK
-- constraints and triggers at the end are not expressible in Prisma 6. Review every generated
-- migration so they are never dropped.
-- =====================================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ScreeningResult") OR EXISTS (SELECT 1 FROM "Facility")
     OR EXISTS (SELECT 1 FROM "Referral") OR EXISTS (SELECT 1 FROM "ReferralStatusEvent")
     OR EXISTS (SELECT 1 FROM "FollowUp") OR EXISTS (SELECT 1 FROM "Notification")
     OR EXISTS (SELECT 1 FROM "ScreeningAmendmentReferralImpact") THEN
    RAISE EXCEPTION 'Step 7 migration expects empty result, referral, follow-up and notification tables; design a backfill first';
  END IF;
END $$;

-- The new FacilityType value is not used by any statement in this migration (PostgreSQL forbids
-- using an enum value in the transaction that added it).

-- CreateEnum
CREATE TYPE "ClinicalReviewStatus" AS ENUM ('PENDING_REVIEW', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'ESCALATED', 'REVIEWED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClinicalReviewDecision" AS ENUM ('ACCEPT_RESULT', 'REQUEST_ADDITIONAL_SCREENING', 'RECOMMEND_REFERRAL', 'ESCALATE_FOR_SPECIALIST_REVIEW', 'REJECT_WITH_REASON');

-- CreateEnum
CREATE TYPE "RuleSetEventType" AS ENUM ('CREATED', 'STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "ReferralOrigin" AS ENUM ('CLINICAL_REVIEW', 'RULE_RECOMMENDATION', 'WORKER_CONCERN');

-- CreateEnum
CREATE TYPE "ReferralUpdateSource" AS ENUM ('SYSTEM', 'APP_USER_DIRECT', 'FACILITY_PHONE_CALL', 'FACILITY_DOCUMENT_SEEN', 'GUARDIAN_REPORTED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "FollowUpEventType" AS ENUM ('CREATED', 'ASSIGNED', 'REASSIGNED', 'STARTED', 'RESCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "FacilityType" ADD VALUE 'DESIGNATED_SPECIALIST_CENTRE';

-- AlterEnum
CREATE TYPE "FollowUpStatus_new" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'CANCELLED');
ALTER TABLE "public"."FollowUp" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "FollowUp" ALTER COLUMN "status" TYPE "FollowUpStatus_new" USING ("status"::text::"FollowUpStatus_new");
ALTER TYPE "FollowUpStatus" RENAME TO "FollowUpStatus_old";
ALTER TYPE "FollowUpStatus_new" RENAME TO "FollowUpStatus";
DROP TYPE "public"."FollowUpStatus_old";
ALTER TABLE "FollowUp" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterEnum
CREATE TYPE "NotificationType_new" AS ENUM ('REVIEW_TASK_NEW', 'REVIEW_OVERDUE', 'ADDITIONAL_ASSESSMENT_REQUESTED', 'REFERRAL_APPROVED', 'REFERRAL_REJECTED', 'REFERRAL_ISSUED', 'REFERRAL_ACKNOWLEDGED', 'REFERRAL_APPOINTMENT_SCHEDULED', 'REFERRAL_STATUS_CHANGED', 'FOLLOW_UP_ASSIGNED', 'FOLLOW_UP_DUE_SOON', 'FOLLOW_UP_OVERDUE', 'SYSTEM');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";

-- AlterEnum
CREATE TYPE "ReferralStatus_new" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'ACKNOWLEDGED', 'APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED', 'UNDER_TREATMENT', 'FOLLOW_UP_REQUIRED', 'CLOSED', 'CANCELLED');
ALTER TABLE "public"."Referral" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ScreeningAmendmentReferralImpact" ALTER COLUMN "referralStatusAtAmendment" TYPE "ReferralStatus_new" USING ("referralStatusAtAmendment"::text::"ReferralStatus_new");
ALTER TABLE "Referral" ALTER COLUMN "status" TYPE "ReferralStatus_new" USING ("status"::text::"ReferralStatus_new");
ALTER TABLE "ReferralStatusEvent" ALTER COLUMN "fromStatus" TYPE "ReferralStatus_new" USING ("fromStatus"::text::"ReferralStatus_new");
ALTER TABLE "ReferralStatusEvent" ALTER COLUMN "toStatus" TYPE "ReferralStatus_new" USING ("toStatus"::text::"ReferralStatus_new");
ALTER TYPE "ReferralStatus" RENAME TO "ReferralStatus_old";
ALTER TYPE "ReferralStatus_new" RENAME TO "ReferralStatus";
DROP TYPE "public"."ReferralStatus_old";
ALTER TABLE "Referral" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';

-- AlterEnum
CREATE TYPE "ResultOutcome_new" AS ENUM ('NO_CONCERN_IN_COMPLETED_ITEMS', 'FURTHER_EVALUATION_RECOMMENDED', 'URGENT_EVALUATION_RECOMMENDED', 'INCOMPLETE', 'NOT_ASSESSED', 'UNABLE_TO_DETERMINE', 'NOT_INTERPRETED');
ALTER TABLE "ScreeningResult" ALTER COLUMN "outcome" TYPE "ResultOutcome_new" USING ("outcome"::text::"ResultOutcome_new");
ALTER TYPE "ResultOutcome" RENAME TO "ResultOutcome_old";
ALTER TYPE "ResultOutcome_new" RENAME TO "ResultOutcome";
DROP TYPE "public"."ResultOutcome_old";

-- DropForeignKey
ALTER TABLE "ScreeningResult" DROP CONSTRAINT "ScreeningResult_reviewedById_fkey";

-- DropIndex
DROP INDEX "ScreeningResult_reviewStatus_createdAt_idx";

-- AlterTable
ALTER TABLE "Facility" DROP COLUMN "phone",
ADD COLUMN     "acceptsReferrals" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "deactivatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "deactivationReason" TEXT,
ADD COLUMN     "nameHi" TEXT,
ADD COLUMN     "officialCode" TEXT,
ADD COLUMN     "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedById" UUID,
ADD COLUMN     "verificationReference" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "verifiedById" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN     "assignedById" UUID,
ADD COLUMN     "clientOperationId" UUID,
ADD COLUMN     "clinicalReviewId" UUID,
ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "reasonCode" TEXT NOT NULL,
ADD COLUMN     "reasonNote" TEXT,
ADD COLUMN     "screeningSessionId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT NOT NULL,
ADD COLUMN     "entityId" UUID NOT NULL,
ADD COLUMN     "entityType" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Referral" DROP COLUMN "notes",
ADD COLUMN     "approvedAt" TIMESTAMPTZ(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "clinicalReviewId" UUID,
ADD COLUMN     "consentVerifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "consentWithdrawnAfterIssueAt" TIMESTAMPTZ(3),
ADD COLUMN     "issuedAt" TIMESTAMPTZ(3),
ADD COLUMN     "origin" "ReferralOrigin" NOT NULL,
ADD COLUMN     "outOfDistrictReason" TEXT,
ADD COLUMN     "reasonNote" TEXT,
ADD COLUMN     "screeningResultId" UUID,
ADD COLUMN     "sharingConsentId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "facilityId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL',
ALTER COLUMN "reasonCode" SET NOT NULL;

-- AlterTable
ALTER TABLE "ReferralStatusEvent" ADD COLUMN     "actorRoleCode" TEXT NOT NULL,
ADD COLUMN     "correctsEventId" UUID,
ADD COLUMN     "effectiveAt" TIMESTAMPTZ(3),
ADD COLUMN     "facilityId" UUID,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "source" "ReferralUpdateSource" NOT NULL,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL;

-- AlterTable
ALTER TABLE "ScreeningResult" DROP COLUMN "reasons",
DROP COLUMN "reviewNotes",
DROP COLUMN "reviewStatus",
DROP COLUMN "reviewedAt",
DROP COLUMN "reviewedById",
DROP COLUMN "ruleSetVersion",
ADD COLUMN     "evidence" JSONB NOT NULL,
ADD COLUMN     "protocolId" UUID,
ADD COLUMN     "referralRecommended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resultRunId" UUID NOT NULL,
ADD COLUMN     "ruleSetId" UUID,
ADD COLUMN     "sessionCategoryId" UUID,
ADD COLUMN     "suggestedPriority" "ReferralUrgency",
ALTER COLUMN "limitations" SET NOT NULL;

-- DropEnum
DROP TYPE "ReviewStatus";

-- CreateTable
CREATE TABLE "ClinicalRuleSet" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "category" "FourDCategory" NOT NULL,
    "protocolCode" TEXT NOT NULL,
    "protocolVersions" INTEGER[],
    "nameEn" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "ageMinDays" INTEGER NOT NULL,
    "ageMaxDays" INTEGER NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "status" "ProtocolStatus" NOT NULL DEFAULT 'DRAFT',
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "contentSha256" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "approvalReference" TEXT,
    "effectiveFrom" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicalRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalRuleSetEvent" (
    "id" UUID NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "type" "RuleSetEventType" NOT NULL,
    "fromStatus" "ProtocolStatus",
    "toStatus" "ProtocolStatus" NOT NULL,
    "actorId" UUID,
    "reference" TEXT,
    "contentSha256" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalRuleSetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningResultRun" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "screeningVersion" INTEGER NOT NULL,
    "overallOutcome" "ResultOutcome" NOT NULL,
    "usesUnapprovedContent" BOOLEAN NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "generatedById" UUID,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "ScreeningResultRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalReview" (
    "id" UUID NOT NULL,
    "resultRunId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "status" "ClinicalReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "claimedById" UUID,
    "claimedAt" TIMESTAMPTZ(3),
    "decision" "ClinicalReviewDecision",
    "decidedById" UUID,
    "decidedByRoleCode" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicalReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalReviewEvent" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "fromStatus" "ClinicalReviewStatus",
    "toStatus" "ClinicalReviewStatus" NOT NULL,
    "decision" "ClinicalReviewDecision",
    "actorId" UUID,
    "actorRoleCode" TEXT,
    "notes" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityHistory" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "reason" TEXT,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpEvent" (
    "id" UUID NOT NULL,
    "followUpId" UUID NOT NULL,
    "type" "FollowUpEventType" NOT NULL,
    "fromStatus" "FollowUpStatus",
    "toStatus" "FollowUpStatus" NOT NULL,
    "actorId" UUID NOT NULL,
    "assignedToId" UUID,
    "oldDueDate" DATE,
    "newDueDate" DATE,
    "reason" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicalRuleSet_category_status_ageMinDays_ageMaxDays_idx" ON "ClinicalRuleSet"("category", "status", "ageMinDays", "ageMaxDays");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalRuleSet_code_version_key" ON "ClinicalRuleSet"("code", "version");

-- CreateIndex
CREATE INDEX "ClinicalRuleSetEvent_ruleSetId_occurredAt_idx" ON "ClinicalRuleSetEvent"("ruleSetId", "occurredAt");

-- CreateIndex
CREATE INDEX "ScreeningResultRun_generatedAt_idx" ON "ScreeningResultRun"("generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningResultRun_sessionId_screeningVersion_key" ON "ScreeningResultRun"("sessionId", "screeningVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalReview_resultRunId_key" ON "ClinicalReview"("resultRunId");

-- CreateIndex
CREATE INDEX "ClinicalReview_status_createdAt_idx" ON "ClinicalReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalReview_areaId_status_idx" ON "ClinicalReview"("areaId", "status");

-- CreateIndex
CREATE INDEX "ClinicalReviewEvent_reviewId_occurredAt_idx" ON "ClinicalReviewEvent"("reviewId", "occurredAt");

-- CreateIndex
CREATE INDEX "FacilityHistory_facilityId_occurredAt_idx" ON "FacilityHistory"("facilityId", "occurredAt");

-- CreateIndex
CREATE INDEX "FollowUpEvent_followUpId_occurredAt_idx" ON "FollowUpEvent"("followUpId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_officialCode_key" ON "Facility"("officialCode");

-- CreateIndex
CREATE INDEX "Facility_verificationStatus_acceptsReferrals_isActive_idx" ON "Facility"("verificationStatus", "acceptsReferrals", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_clientOperationId_key" ON "FollowUp"("clientOperationId");

-- CreateIndex
CREATE INDEX "FollowUp_referralId_idx" ON "FollowUp"("referralId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Referral_status_updatedAt_idx" ON "Referral"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralStatusEvent_correctsEventId_key" ON "ReferralStatusEvent"("correctsEventId");

-- CreateIndex
CREATE INDEX "ScreeningResult_ruleSetId_idx" ON "ScreeningResult"("ruleSetId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningResult_resultRunId_category_key" ON "ScreeningResult"("resultRunId", "category");

-- AddForeignKey
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT "ClinicalRuleSet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT "ClinicalRuleSet_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalRuleSetEvent" ADD CONSTRAINT "ClinicalRuleSetEvent_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "ClinicalRuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalRuleSetEvent" ADD CONSTRAINT "ClinicalRuleSetEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResultRun" ADD CONSTRAINT "ScreeningResultRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResultRun" ADD CONSTRAINT "ScreeningResultRun_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_resultRunId_fkey" FOREIGN KEY ("resultRunId") REFERENCES "ScreeningResultRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_sessionCategoryId_fkey" FOREIGN KEY ("sessionCategoryId") REFERENCES "ScreeningSessionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "ScreeningProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "ClinicalRuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalReview" ADD CONSTRAINT "ClinicalReview_resultRunId_fkey" FOREIGN KEY ("resultRunId") REFERENCES "ScreeningResultRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalReview" ADD CONSTRAINT "ClinicalReview_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalReview" ADD CONSTRAINT "ClinicalReview_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalReview" ADD CONSTRAINT "ClinicalReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalReviewEvent" ADD CONSTRAINT "ClinicalReviewEvent_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ClinicalReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalReviewEvent" ADD CONSTRAINT "ClinicalReviewEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityHistory" ADD CONSTRAINT "FacilityHistory_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityHistory" ADD CONSTRAINT "FacilityHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_screeningResultId_fkey" FOREIGN KEY ("screeningResultId") REFERENCES "ScreeningResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clinicalReviewId_fkey" FOREIGN KEY ("clinicalReviewId") REFERENCES "ClinicalReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_sharingConsentId_fkey" FOREIGN KEY ("sharingConsentId") REFERENCES "Consent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralStatusEvent" ADD CONSTRAINT "ReferralStatusEvent_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralStatusEvent" ADD CONSTRAINT "ReferralStatusEvent_correctsEventId_fkey" FOREIGN KEY ("correctsEventId") REFERENCES "ReferralStatusEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_screeningSessionId_fkey" FOREIGN KEY ("screeningSessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_clinicalReviewId_fkey" FOREIGN KEY ("clinicalReviewId") REFERENCES "ClinicalReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Integrity rules (hand-written). Every rule here is also enforced by the API; these make the
-- same rules hold for every database account and every code path.
-- =====================================================================================

/** Shared: rejects any change of an append-only row. */
CREATE OR REPLACE FUNCTION step7_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

/** True when the row was written by the current transaction (no clock comparison involved). */
CREATE OR REPLACE FUNCTION step7_written_in_this_tx(row_xmin xid) RETURNS boolean AS $$
  SELECT row_xmin::text = (txid_current() % 4294967296)::text;
$$ LANGUAGE sql VOLATILE;

-- ------------------------------------------------------------------- clinical rule sets
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_version_positive CHECK ("version" >= 1);
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_age_band
  CHECK ("ageMinDays" >= 0 AND "ageMaxDays" >= "ageMinDays");
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_protocol_versions
  CHECK ("protocolVersions" IS NOT NULL AND cardinality("protocolVersions") >= 1 AND 0 < ALL ("protocolVersions"));
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_creator
  CHECK ("createdById" IS NOT NULL OR "isDemonstration");
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_source_reference
  CHECK (length(btrim("sourceReference")) >= 3);
-- From APPROVED on: who approved, when, under which reference, exactly which content.
-- Demonstration rule sets can never reach APPROVED, ACTIVE or RETIRED.
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_approval_complete CHECK (
  "status" IN ('DRAFT', 'IN_REVIEW')
  OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvalReference" IS NOT NULL
      AND "contentSha256" IS NOT NULL AND NOT "isDemonstration")
);
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_review_has_hash
  CHECK ("status" = 'DRAFT' OR "contentSha256" IS NOT NULL);
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_active_has_effective_date
  CHECK ("status" <> 'ACTIVE' OR "effectiveFrom" IS NOT NULL);
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT rule_set_retired_at
  CHECK (("status" = 'RETIRED') = ("retiredAt" IS NOT NULL));
-- Two ACTIVE rule sets for the same category and protocol code never cover the same age.
ALTER TABLE "ClinicalRuleSet" ADD CONSTRAINT clinical_rule_set_one_active_per_band
  EXCLUDE USING gist ("category" WITH =, "protocolCode" WITH =,
                      int4range("ageMinDays", "ageMaxDays", '[]') WITH &&)
  WHERE ("status" = 'ACTIVE');

CREATE OR REPLACE FUNCTION clinical_rule_set_protect() RETURNS trigger AS $$
DECLARE
  frozen boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Clinical rule sets cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT'     AND NEW."status" = 'IN_REVIEW')
    OR (OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('DRAFT', 'APPROVED'))
    OR (OLD."status" = 'APPROVED'  AND NEW."status" IN ('ACTIVE', 'RETIRED'))
    OR (OLD."status" = 'ACTIVE'    AND NEW."status" = 'RETIRED')) THEN
    RAISE EXCEPTION 'Clinical rule set status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Content is frozen once the set left DRAFT or any result used it.
  frozen := OLD."status" <> 'DRAFT'
    OR EXISTS (SELECT 1 FROM "ScreeningResult" WHERE "ruleSetId" = OLD."id");
  IF frozen AND (NEW."id", NEW."code", NEW."version", NEW."category", NEW."protocolCode",
                 NEW."protocolVersions", NEW."nameEn", NEW."nameHi", NEW."ageMinDays", NEW."ageMaxDays",
                 NEW."sourceReference", NEW."definition", NEW."isDemonstration", NEW."createdById",
                 NEW."createdAt")
     IS DISTINCT FROM
                (OLD."id", OLD."code", OLD."version", OLD."category", OLD."protocolCode",
                 OLD."protocolVersions", OLD."nameEn", OLD."nameHi", OLD."ageMinDays", OLD."ageMaxDays",
                 OLD."sourceReference", OLD."definition", OLD."isDemonstration", OLD."createdById",
                 OLD."createdAt") THEN
    RAISE EXCEPTION 'Clinical rule set content is frozen; create a new version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'DRAFT' AND NOT (OLD."status" = 'IN_REVIEW' AND NEW."status" = 'DRAFT')
     AND NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256" THEN
    RAISE EXCEPTION 'Clinical rule set content hash is frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('APPROVED', 'ACTIVE', 'RETIRED')
     AND (NEW."approvedById", NEW."approvedAt", NEW."approvalReference")
         IS DISTINCT FROM (OLD."approvedById", OLD."approvedAt", OLD."approvalReference") THEN
    RAISE EXCEPTION 'Clinical rule set approval record is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('ACTIVE', 'RETIRED') AND NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" THEN
    RAISE EXCEPTION 'Clinical rule set effective date is immutable once active' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'RETIRED' AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
    RAISE EXCEPTION 'Clinical rule set retirement is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER clinical_rule_set_protect
  BEFORE UPDATE OR DELETE ON "ClinicalRuleSet"
  FOR EACH ROW EXECUTE FUNCTION clinical_rule_set_protect();

ALTER TABLE "ClinicalRuleSetEvent" ADD CONSTRAINT rule_set_event_actor
  CHECK ("actorId" IS NOT NULL OR ("type" = 'CREATED' AND "toStatus" = 'DRAFT'));

CREATE TRIGGER clinical_rule_set_event_append_only
  BEFORE UPDATE OR DELETE ON "ClinicalRuleSetEvent"
  FOR EACH ROW EXECUTE FUNCTION step7_append_only();

-- ------------------------------------------------------------------- result runs
ALTER TABLE "ScreeningResultRun" ADD CONSTRAINT result_run_version_positive
  CHECK ("screeningVersion" >= 1);

-- Only supersededAt may change, once (when the next screening version's run is created).
CREATE OR REPLACE FUNCTION screening_result_run_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Screening result runs cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."sessionId", NEW."screeningVersion", NEW."overallOutcome", NEW."usesUnapprovedContent",
      NEW."engineVersion", NEW."generatedById", NEW."generatedAt")
     IS DISTINCT FROM
     (OLD."id", OLD."sessionId", OLD."screeningVersion", OLD."overallOutcome", OLD."usesUnapprovedContent",
      OLD."engineVersion", OLD."generatedById", OLD."generatedAt")
     OR OLD."supersededAt" IS NOT NULL OR NEW."supersededAt" IS NULL THEN
    RAISE EXCEPTION 'Screening result runs are immutable (only a one-time supersede is allowed)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER screening_result_run_protect
  BEFORE UPDATE OR DELETE ON "ScreeningResultRun"
  FOR EACH ROW EXECUTE FUNCTION screening_result_run_protect();

-- Checked at COMMIT, so a run can be written in the same transaction that completes the session
-- (or adds the amendment): the session must then be COMPLETED and the version must exist.
CREATE OR REPLACE FUNCTION screening_result_run_check() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ScreeningSession" WHERE "id" = NEW."sessionId" AND "status" = 'COMPLETED') THEN
    RAISE EXCEPTION 'Results are generated only for COMPLETED screenings' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."screeningVersion" > 1 AND NOT EXISTS (
       SELECT 1 FROM "ScreeningAmendment"
        WHERE "sessionId" = NEW."sessionId" AND "sequence" = NEW."screeningVersion" - 1) THEN
    RAISE EXCEPTION 'Screening version % does not exist', NEW."screeningVersion" USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ScreeningResult" WHERE "resultRunId" = NEW."id") THEN
    RAISE EXCEPTION 'A result run needs its category results' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER screening_result_run_check
  AFTER INSERT ON "ScreeningResultRun" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION screening_result_run_check();

-- ------------------------------------------------------------------- category results
-- No rule set <=> not assessed / not interpreted. Concern outcomes and referral recommendations
-- exist only when a rule set was applied.
ALTER TABLE "ScreeningResult" ADD CONSTRAINT result_rule_set_matches_outcome
  CHECK (("ruleSetId" IS NULL) = ("outcome" IN ('NOT_ASSESSED', 'NOT_INTERPRETED')));
ALTER TABLE "ScreeningResult" ADD CONSTRAINT result_not_assessed_has_no_category
  CHECK (("outcome" = 'NOT_ASSESSED') = ("sessionCategoryId" IS NULL)
         AND ("sessionCategoryId" IS NULL) = ("protocolId" IS NULL));
ALTER TABLE "ScreeningResult" ADD CONSTRAINT result_referral_recommendation
  CHECK ((NOT "referralRecommended" OR "outcome" IN ('FURTHER_EVALUATION_RECOMMENDED', 'URGENT_EVALUATION_RECOMMENDED'))
         AND ("suggestedPriority" IS NULL OR "referralRecommended"));

CREATE OR REPLACE FUNCTION screening_result_check() RETURNS trigger AS $$
DECLARE
  r RECORD;
  c RECORD;
  p RECORD;
  rs RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Screening results are insert-only' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "sessionId" INTO r FROM "ScreeningResultRun" WHERE "id" = NEW."resultRunId";
  IF r."sessionId" IS DISTINCT FROM NEW."sessionId" THEN
    RAISE EXCEPTION 'Result session must match its result run' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."sessionCategoryId" IS NOT NULL THEN
    SELECT "sessionId", "category", "protocolId" INTO c
      FROM "ScreeningSessionCategory" WHERE "id" = NEW."sessionCategoryId";
    IF c."sessionId" IS DISTINCT FROM NEW."sessionId" OR c."category" IS DISTINCT FROM NEW."category"
       OR c."protocolId" IS DISTINCT FROM NEW."protocolId" THEN
      RAISE EXCEPTION 'Result category must be the session''s own category and protocol'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."ruleSetId" IS NOT NULL THEN
    SELECT * INTO rs FROM "ClinicalRuleSet" WHERE "id" = NEW."ruleSetId";
    SELECT "code", "version" INTO p FROM "ScreeningProtocol" WHERE "id" = NEW."protocolId";
    IF rs."status" NOT IN ('ACTIVE', 'DRAFT') THEN
      RAISE EXCEPTION 'Only an ACTIVE (or, outside production, DRAFT) rule set can produce a result'
        USING ERRCODE = 'check_violation';
    END IF;
    IF rs."category" <> NEW."category" OR rs."protocolCode" <> p."code"
       OR NOT (p."version" = ANY (rs."protocolVersions")) THEN
      RAISE EXCEPTION 'Rule set does not apply to this category and protocol version'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "ScreeningSession" s WHERE s."id" = NEW."sessionId"
                     AND s."ageInDaysAtStart" BETWEEN rs."ageMinDays" AND rs."ageMaxDays") THEN
      RAISE EXCEPTION 'Rule set does not apply to the child''s age' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER screening_result_check
  BEFORE INSERT OR UPDATE OR DELETE ON "ScreeningResult"
  FOR EACH ROW EXECUTE FUNCTION screening_result_check();

-- ------------------------------------------------------------------- clinical review
ALTER TABLE "ClinicalReview" ADD CONSTRAINT review_version_positive CHECK ("version" >= 1);
-- A decision exists exactly in the decided states, with who / when; and it matches the state.
ALTER TABLE "ClinicalReview" ADD CONSTRAINT review_decision_matches_status CHECK (
  ("status" IN ('PENDING_REVIEW', 'UNDER_REVIEW')
     AND "decision" IS NULL AND "decidedById" IS NULL AND "decidedAt" IS NULL AND "decidedByRoleCode" IS NULL)
  OR ("status" = 'REVIEWED' AND "decision" IN ('ACCEPT_RESULT', 'RECOMMEND_REFERRAL'))
  OR ("status" = 'ADDITIONAL_INFORMATION_REQUIRED' AND "decision" = 'REQUEST_ADDITIONAL_SCREENING')
  OR ("status" = 'ESCALATED' AND "decision" = 'ESCALATE_FOR_SPECIALIST_REVIEW')
  OR ("status" = 'REJECTED' AND "decision" = 'REJECT_WITH_REASON')
);
ALTER TABLE "ClinicalReview" ADD CONSTRAINT review_decided_complete CHECK (
  "decision" IS NULL
  OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decidedByRoleCode" IS NOT NULL
      AND ("decision" = 'ACCEPT_RESULT' OR "notes" IS NOT NULL))
);
ALTER TABLE "ClinicalReview" ADD CONSTRAINT review_claim_complete CHECK (
  ("status" = 'PENDING_REVIEW' AND "claimedById" IS NULL AND "claimedAt" IS NULL)
  OR ("status" <> 'PENDING_REVIEW' AND "claimedById" IS NOT NULL AND "claimedAt" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION clinical_review_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Clinical reviews cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING_REVIEW' OR NEW."version" <> 1 THEN
      RAISE EXCEPTION 'A clinical review starts as PENDING_REVIEW' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."resultRunId", NEW."areaId", NEW."createdAt")
     IS DISTINCT FROM (OLD."id", OLD."resultRunId", OLD."areaId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Clinical review identity fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Clinical review version must increase by exactly 1 (concurrent change)'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'PENDING_REVIEW' AND NEW."status" = 'UNDER_REVIEW')
    OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN
          ('PENDING_REVIEW', 'REVIEWED', 'REJECTED', 'ESCALATED', 'ADDITIONAL_INFORMATION_REQUIRED'))
    OR (OLD."status" IN ('ESCALATED', 'ADDITIONAL_INFORMATION_REQUIRED') AND NEW."status" = 'UNDER_REVIEW')) THEN
    RAISE EXCEPTION 'Clinical review status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('REVIEWED', 'REJECTED') THEN
    RAISE EXCEPTION 'A completed clinical review cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER clinical_review_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "ClinicalReview"
  FOR EACH ROW EXECUTE FUNCTION clinical_review_protect();

CREATE TRIGGER clinical_review_event_append_only
  BEFORE UPDATE OR DELETE ON "ClinicalReviewEvent"
  FOR EACH ROW EXECUTE FUNCTION step7_append_only();

-- ------------------------------------------------------------------- facilities
CREATE UNIQUE INDEX facility_unique_name_in_area ON "Facility"("areaId", "type", lower("name"));
ALTER TABLE "Facility" ADD CONSTRAINT facility_version_positive CHECK ("version" >= 1);
ALTER TABLE "Facility" ADD CONSTRAINT facility_verification_complete CHECK (
  ("verificationStatus" = 'UNVERIFIED' AND "verifiedById" IS NULL AND "verifiedAt" IS NULL
     AND "verificationReference" IS NULL)
  OR ("verificationStatus" = 'VERIFIED' AND "verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL
     AND "verificationReference" IS NOT NULL)
);
-- Never claim a facility accepts referrals or offers services without verification (decision P).
ALTER TABLE "Facility" ADD CONSTRAINT facility_claims_need_verification CHECK (
  ("acceptsReferrals" = false AND cardinality("services") = 0) OR "verificationStatus" = 'VERIFIED'
);
ALTER TABLE "Facility" ADD CONSTRAINT facility_inactive_does_not_accept
  CHECK ("isActive" OR NOT "acceptsReferrals");
ALTER TABLE "Facility" ADD CONSTRAINT facility_deactivation_complete CHECK (
  ("isActive" AND "deactivatedAt" IS NULL AND "deactivationReason" IS NULL)
  OR (NOT "isActive" AND "deactivatedAt" IS NOT NULL AND "deactivationReason" IS NOT NULL)
);
ALTER TABLE "Facility" ADD CONSTRAINT facility_services_not_null CHECK ("services" IS NOT NULL);

CREATE OR REPLACE FUNCTION facility_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Facilities cannot be deleted; deactivate them' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'A facility starts at version 1' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."createdById", NEW."createdAt") IS DISTINCT FROM (OLD."id", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Facility identity fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Facility version must increase by exactly 1 (concurrent change)'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER facility_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "Facility"
  FOR EACH ROW EXECUTE FUNCTION facility_protect();

CREATE TRIGGER facility_history_append_only
  BEFORE UPDATE OR DELETE ON "FacilityHistory"
  FOR EACH ROW EXECUTE FUNCTION step7_append_only();

-- ------------------------------------------------------------------- referrals
-- Decision N: one active referral per child + screening + category.
-- (Two partial indexes: an enum-to-text cast is not allowed in an index expression.)
CREATE UNIQUE INDEX referral_one_active_per_category ON "Referral"(
  "childId", COALESCE("sessionId", '00000000-0000-0000-0000-000000000000'::uuid), "category"
) WHERE "category" IS NOT NULL AND "status" NOT IN ('REJECTED', 'CLOSED', 'CANCELLED');
CREATE UNIQUE INDEX referral_one_active_without_category ON "Referral"(
  "childId", COALESCE("sessionId", '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE "category" IS NULL AND "status" NOT IN ('REJECTED', 'CLOSED', 'CANCELLED');

ALTER TABLE "Referral" ADD CONSTRAINT referral_version_positive CHECK ("version" >= 1);
ALTER TABLE "Referral" ADD CONSTRAINT referral_reason_code CHECK (length(btrim("reasonCode")) >= 1);
ALTER TABLE "Referral" ADD CONSTRAINT referral_closed_at CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));
-- Approved from APPROVED on (CANCELLED may or may not have been approved).
ALTER TABLE "Referral" ADD CONSTRAINT referral_approval_complete CHECK (
  "status" IN ('PENDING_APPROVAL', 'REJECTED', 'CANCELLED')
  OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)
);
-- Decision L/M: from ISSUED on a facility, the issue time and the verified sharing consent exist.
ALTER TABLE "Referral" ADD CONSTRAINT referral_issue_complete CHECK (
  "status" IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')
  OR ("status" = 'CANCELLED' AND "issuedAt" IS NULL)
  OR ("facilityId" IS NOT NULL AND "issuedAt" IS NOT NULL AND "sharingConsentId" IS NOT NULL
      AND "consentVerifiedAt" IS NOT NULL)
);
ALTER TABLE "Referral" ADD CONSTRAINT referral_review_origin CHECK (
  ("origin" = 'CLINICAL_REVIEW') = ("clinicalReviewId" IS NOT NULL)
);
ALTER TABLE "Referral" ADD CONSTRAINT referral_result_needs_session CHECK (
  "screeningResultId" IS NULL OR "sessionId" IS NOT NULL
);

/** True when the referral may move from one status to the other (architecture.md section 6). */
CREATE OR REPLACE FUNCTION referral_transition_allowed(f "ReferralStatus", t "ReferralStatus") RETURNS boolean AS $$
  SELECT CASE f
    WHEN 'PENDING_APPROVAL' THEN t IN ('APPROVED', 'REJECTED', 'CANCELLED')
    WHEN 'APPROVED' THEN t IN ('ISSUED', 'CANCELLED')
    WHEN 'ISSUED' THEN t IN ('ACKNOWLEDGED', 'APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED', 'CANCELLED')
    WHEN 'ACKNOWLEDGED' THEN t IN ('APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED', 'CANCELLED')
    WHEN 'APPOINTMENT_SCHEDULED' THEN t IN ('APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED', 'CANCELLED')
    WHEN 'VISIT_NOT_COMPLETED' THEN t IN ('APPOINTMENT_SCHEDULED', 'VISITED', 'FOLLOW_UP_REQUIRED', 'CLOSED')
    WHEN 'VISITED' THEN t IN ('UNDER_TREATMENT', 'FOLLOW_UP_REQUIRED', 'CLOSED')
    WHEN 'UNDER_TREATMENT' THEN t IN ('FOLLOW_UP_REQUIRED', 'CLOSED')
    WHEN 'FOLLOW_UP_REQUIRED' THEN t IN ('APPOINTMENT_SCHEDULED', 'VISITED', 'UNDER_TREATMENT', 'CLOSED')
    ELSE false
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION referral_protect() RETURNS trigger AS $$
DECLARE
  s RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Referrals cannot be deleted; cancel them' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'A referral starts at version 1' USING ERRCODE = 'check_violation';
    END IF;
    -- Decision K: only a clinical-review referral starts approved.
    IF NOT (NEW."status" = 'PENDING_APPROVAL'
            OR (NEW."status" = 'APPROVED' AND NEW."origin" = 'CLINICAL_REVIEW')) THEN
      RAISE EXCEPTION 'A referral starts as PENDING_APPROVAL (APPROVED only from a clinical review)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."sessionId" IS NOT NULL THEN
      SELECT "childId", "status" INTO s FROM "ScreeningSession" WHERE "id" = NEW."sessionId";
      IF s."childId" IS DISTINCT FROM NEW."childId" OR s."status" <> 'COMPLETED' THEN
        RAISE EXCEPTION 'Referral screening must be a COMPLETED screening of the same child'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW."screeningResultId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "ScreeningResult" r WHERE r."id" = NEW."screeningResultId"
            AND r."sessionId" = NEW."sessionId"
            AND r."category" IS NOT DISTINCT FROM NEW."category") THEN
      RAISE EXCEPTION 'Referral result must belong to the referral screening and category'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."clinicalReviewId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "ClinicalReview" cr JOIN "ScreeningResultRun" rr ON rr."id" = cr."resultRunId"
          WHERE cr."id" = NEW."clinicalReviewId" AND rr."sessionId" = NEW."sessionId") THEN
      RAISE EXCEPTION 'Referral review must belong to the referral screening' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF (NEW."id", NEW."childId", NEW."sessionId", NEW."screeningResultId", NEW."clinicalReviewId",
      NEW."origin", NEW."areaId", NEW."category", NEW."clientOperationId", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."childId", OLD."sessionId", OLD."screeningResultId", OLD."clinicalReviewId",
      OLD."origin", OLD."areaId", OLD."category", OLD."clientOperationId", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Referral identity fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Referral version must increase by exactly 1 (concurrent change)'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF OLD."status" IN ('REJECTED', 'CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'A % referral cannot be changed', OLD."status" USING ERRCODE = 'check_violation';
  END IF;
  -- Once issued, the destination, issue record and consent reference are history.
  IF OLD."issuedAt" IS NOT NULL
     AND (NEW."facilityId", NEW."issuedAt", NEW."sharingConsentId", NEW."consentVerifiedAt", NEW."approvedById", NEW."approvedAt")
         IS DISTINCT FROM
         (OLD."facilityId", OLD."issuedAt", OLD."sharingConsentId", OLD."consentVerifiedAt", OLD."approvedById", OLD."approvedAt") THEN
    RAISE EXCEPTION 'An issued referral keeps its facility, approval and consent record' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."consentWithdrawnAfterIssueAt" IS NOT NULL
     AND NEW."consentWithdrawnAfterIssueAt" IS DISTINCT FROM OLD."consentWithdrawnAfterIssueAt" THEN
    RAISE EXCEPTION 'The consent withdrawal flag is set once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT referral_transition_allowed(OLD."status", NEW."status")
     -- Decision J: a correction reverts the latest TRACKING event (never back before ISSUED). The
     -- correction event is written first, in this transaction.
     AND NOT (NEW."status" NOT IN ('PENDING_APPROVAL', 'APPROVED') AND EXISTS (
           SELECT 1 FROM "ReferralStatusEvent" e
            WHERE e."referralId" = NEW."id" AND e."correctsEventId" IS NOT NULL
              AND e."fromStatus" = OLD."status" AND e."toStatus" = NEW."status"
              AND step7_written_in_this_tx(e.xmin))) THEN
    RAISE EXCEPTION 'Referral status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER referral_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "Referral"
  FOR EACH ROW EXECUTE FUNCTION referral_protect();

-- Every status (including the first) is backed by a status event written in the same transaction.
CREATE OR REPLACE FUNCTION referral_history_check() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "ReferralStatusEvent" e WHERE e."referralId" = NEW."id"
                     AND e."fromStatus" IS NULL AND e."toStatus" = NEW."status") THEN
      RAISE EXCEPTION 'A new referral needs its first status event' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT EXISTS (SELECT 1 FROM "ReferralStatusEvent" e WHERE e."referralId" = NEW."id"
                     AND e."fromStatus" = OLD."status" AND e."toStatus" = NEW."status"
                     AND step7_written_in_this_tx(e.xmin)) THEN
      RAISE EXCEPTION 'A referral status change needs its status event' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER referral_history_check
  AFTER INSERT OR UPDATE ON "Referral" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION referral_history_check();

ALTER TABLE "ReferralStatusEvent" ADD CONSTRAINT referral_event_reason_required CHECK (
  "reason" IS NOT NULL OR ("toStatus" NOT IN ('REJECTED', 'CANCELLED', 'CLOSED') AND "correctsEventId" IS NULL)
);
-- First-hand entries are verified by definition; reports from others carry their own status.
ALTER TABLE "ReferralStatusEvent" ADD CONSTRAINT referral_event_first_hand_verified CHECK (
  "source" NOT IN ('SYSTEM', 'APP_USER_DIRECT') OR "verificationStatus" = 'VERIFIED'
);
CREATE TRIGGER referral_status_event_append_only
  BEFORE UPDATE OR DELETE ON "ReferralStatusEvent"
  FOR EACH ROW EXECUTE FUNCTION step7_append_only();

-- ------------------------------------------------------------------- follow-ups
-- Decision Q: one active task per child + referral + reason.
CREATE UNIQUE INDEX follow_up_one_active_per_reason ON "FollowUp"(
  "childId",
  COALESCE("referralId", '00000000-0000-0000-0000-000000000000'::uuid),
  "reasonCode"
) WHERE "status" IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS');

ALTER TABLE "FollowUp" ADD CONSTRAINT follow_up_version_positive CHECK ("version" >= 1);
ALTER TABLE "FollowUp" ADD CONSTRAINT follow_up_reason_code CHECK (length(btrim("reasonCode")) >= 1);
ALTER TABLE "FollowUp" ADD CONSTRAINT follow_up_assignee CHECK (
  ("status" = 'PENDING' AND "assignedToId" IS NULL)
  OR ("status" IN ('ASSIGNED', 'IN_PROGRESS') AND "assignedToId" IS NOT NULL AND "assignedById" IS NOT NULL)
  OR "status" IN ('COMPLETED', 'MISSED', 'CANCELLED')
);
ALTER TABLE "FollowUp" ADD CONSTRAINT follow_up_completion CHECK (
  ("status" = 'COMPLETED') = ("completedAt" IS NOT NULL AND "completedById" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION follow_up_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Follow-ups cannot be deleted; cancel them' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1 OR NEW."status" NOT IN ('PENDING', 'ASSIGNED') THEN
      RAISE EXCEPTION 'A follow-up starts as PENDING or ASSIGNED, at version 1' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."referralId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "Referral" WHERE "id" = NEW."referralId" AND "childId" = NEW."childId") THEN
      RAISE EXCEPTION 'Follow-up referral must belong to the same child' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."screeningSessionId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "ScreeningSession" WHERE "id" = NEW."screeningSessionId" AND "childId" = NEW."childId") THEN
      RAISE EXCEPTION 'Follow-up screening must belong to the same child' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."clinicalReviewId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "ClinicalReview" cr
           JOIN "ScreeningResultRun" rr ON rr."id" = cr."resultRunId"
           JOIN "ScreeningSession" s ON s."id" = rr."sessionId"
          WHERE cr."id" = NEW."clinicalReviewId" AND s."childId" = NEW."childId") THEN
      RAISE EXCEPTION 'Follow-up review must belong to the same child' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."childId", NEW."referralId", NEW."screeningSessionId", NEW."clinicalReviewId",
      NEW."reasonCode", NEW."clientOperationId", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."childId", OLD."referralId", OLD."screeningSessionId", OLD."clinicalReviewId",
      OLD."reasonCode", OLD."clientOperationId", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Follow-up identity fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Follow-up version must increase by exactly 1 (concurrent change)'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'A % follow-up cannot be changed', OLD."status" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'PENDING'     AND NEW."status" IN ('ASSIGNED', 'CANCELLED'))
    OR (OLD."status" = 'ASSIGNED'    AND NEW."status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'CANCELLED'))
    OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" IN ('ASSIGNED', 'COMPLETED', 'MISSED', 'CANCELLED'))
    -- A missed task may be rescheduled (back to its assignee) or cancelled.
    OR (OLD."status" = 'MISSED'      AND NEW."status" IN ('ASSIGNED', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'Follow-up status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER follow_up_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "FollowUp"
  FOR EACH ROW EXECUTE FUNCTION follow_up_protect();

ALTER TABLE "FollowUpEvent" ADD CONSTRAINT follow_up_event_reason_required CHECK (
  "reason" IS NOT NULL OR "type" NOT IN ('RESCHEDULED', 'MISSED', 'CANCELLED', 'REASSIGNED')
);
CREATE TRIGGER follow_up_event_append_only
  BEFORE UPDATE OR DELETE ON "FollowUpEvent"
  FOR EACH ROW EXECUTE FUNCTION step7_append_only();

-- ------------------------------------------------------------------- notifications
-- Only readAt may change, once. Rows may be deleted by a later retention job (not in Step 7).
CREATE OR REPLACE FUNCTION notification_protect() RETURNS trigger AS $$
BEGIN
  IF (NEW."id", NEW."userId", NEW."type", NEW."entityType", NEW."entityId", NEW."dedupeKey", NEW."payload", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."userId", OLD."type", OLD."entityType", OLD."entityId", OLD."dedupeKey", OLD."payload", OLD."createdAt")
     OR OLD."readAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Notifications are immutable (only a one-time read mark is allowed)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER notification_protect
  BEFORE UPDATE ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION notification_protect();
