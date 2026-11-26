-- Step 8, stage 8B: Parent Care content library (videos and home activities).
-- New tables only; nothing existing is changed. See docs/step-8/care-content-governance.md.

-- CreateEnum
CREATE TYPE "CareContentKind" AS ENUM ('VIDEO', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "CareContentTopic" AS ENUM ('DEVELOPMENT_MOTOR', 'DEVELOPMENT_SPEECH_LANGUAGE', 'DEVELOPMENT_SOCIAL_PLAY', 'DEVELOPMENT_COGNITIVE', 'NUTRITION_FEEDING', 'HYGIENE', 'DAILY_CARE');

-- CreateEnum
CREATE TYPE "CareContentEventType" AS ENUM ('CREATED', 'STATUS_CHANGED');

-- CreateTable
CREATE TABLE "CareContent" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "CareContentKind" NOT NULL,
    "topic" "CareContentTopic" NOT NULL,
    "category" "FourDCategory",
    "titleEn" TEXT NOT NULL,
    "titleHi" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "summaryHi" TEXT NOT NULL,
    "ageMinDays" INTEGER NOT NULL,
    "ageMaxDays" INTEGER NOT NULL,
    "requiresDoctor" BOOLEAN NOT NULL DEFAULT false,
    "sourceReference" TEXT NOT NULL,
    "usagePermission" TEXT NOT NULL,
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

    CONSTRAINT "CareContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareContentEvent" (
    "id" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "type" "CareContentEventType" NOT NULL,
    "fromStatus" "ProtocolStatus",
    "toStatus" "ProtocolStatus" NOT NULL,
    "actorId" UUID,
    "reference" TEXT,
    "contentSha256" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareContentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareContent_status_kind_topic_ageMinDays_ageMaxDays_idx" ON "CareContent"("status", "kind", "topic", "ageMinDays", "ageMaxDays");

-- CreateIndex
CREATE UNIQUE INDEX "CareContent_code_version_key" ON "CareContent"("code", "version");

-- CreateIndex
CREATE INDEX "CareContentEvent_contentId_occurredAt_idx" ON "CareContentEvent"("contentId", "occurredAt");

-- AddForeignKey
ALTER TABLE "CareContent" ADD CONSTRAINT "CareContent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareContent" ADD CONSTRAINT "CareContent_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareContentEvent" ADD CONSTRAINT "CareContentEvent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "CareContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareContentEvent" ADD CONSTRAINT "CareContentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =================================================================== database rules (hand-written)
-- Same governance as clinical rule sets (Step 7): the database enforces it for every account.

ALTER TABLE "CareContent" ADD CONSTRAINT care_content_version_positive CHECK ("version" >= 1);
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_age_band
  CHECK ("ageMinDays" >= 0 AND "ageMaxDays" >= "ageMinDays");
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_creator
  CHECK ("createdById" IS NOT NULL OR "isDemonstration");
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_source
  CHECK (length(btrim("sourceReference")) >= 3 AND length(btrim("usagePermission")) >= 3);
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_text_present
  CHECK (length(btrim("titleEn")) >= 1 AND length(btrim("titleHi")) >= 1
         AND length(btrim("summaryEn")) >= 1 AND length(btrim("summaryHi")) >= 1);
-- A video always carries its link; an activity always carries its steps (shape checked by the app).
-- IS NOT DISTINCT FROM: a missing key gives NULL, which a plain "=" would let through a CHECK.
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_kind_shape CHECK (
  ("kind" = 'VIDEO' AND jsonb_typeof("definition" -> 'video') IS NOT DISTINCT FROM 'object'
   AND NOT ("definition" ? 'steps'))
  OR ("kind" = 'ACTIVITY' AND jsonb_typeof("definition" -> 'steps') IS NOT DISTINCT FROM 'array'
      AND NOT ("definition" ? 'video'))
);
-- From APPROVED on: who approved, when, under which reference, exactly which content.
-- Demonstration items can never reach APPROVED, ACTIVE or RETIRED.
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_approval_complete CHECK (
  "status" IN ('DRAFT', 'IN_REVIEW')
  OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvalReference" IS NOT NULL
      AND "contentSha256" IS NOT NULL AND NOT "isDemonstration")
);
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_review_has_hash
  CHECK ("status" = 'DRAFT' OR "contentSha256" IS NOT NULL);
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_active_has_effective_date
  CHECK ("status" <> 'ACTIVE' OR "effectiveFrom" IS NOT NULL);
ALTER TABLE "CareContent" ADD CONSTRAINT care_content_retired_at
  CHECK (("status" = 'RETIRED') = ("retiredAt" IS NOT NULL));
-- At most one ACTIVE version of each content code.
CREATE UNIQUE INDEX care_content_one_active_version ON "CareContent"("code") WHERE "status" = 'ACTIVE';

CREATE OR REPLACE FUNCTION care_content_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Care content cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT'     AND NEW."status" = 'IN_REVIEW')
    OR (OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('DRAFT', 'APPROVED'))
    OR (OLD."status" = 'APPROVED'  AND NEW."status" IN ('ACTIVE', 'RETIRED'))
    OR (OLD."status" = 'ACTIVE'    AND NEW."status" = 'RETIRED')) THEN
    RAISE EXCEPTION 'Care content status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Content is frozen once the item left DRAFT (stage 8C extends this to items used by a plan).
  IF OLD."status" <> 'DRAFT'
     AND (NEW."id", NEW."code", NEW."version", NEW."kind", NEW."topic", NEW."category",
          NEW."titleEn", NEW."titleHi", NEW."summaryEn", NEW."summaryHi", NEW."ageMinDays",
          NEW."ageMaxDays", NEW."requiresDoctor", NEW."sourceReference", NEW."usagePermission",
          NEW."definition", NEW."isDemonstration", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
         (OLD."id", OLD."code", OLD."version", OLD."kind", OLD."topic", OLD."category",
          OLD."titleEn", OLD."titleHi", OLD."summaryEn", OLD."summaryHi", OLD."ageMinDays",
          OLD."ageMaxDays", OLD."requiresDoctor", OLD."sourceReference", OLD."usagePermission",
          OLD."definition", OLD."isDemonstration", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Care content is frozen; create a new version' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'DRAFT' AND NOT (OLD."status" = 'IN_REVIEW' AND NEW."status" = 'DRAFT')
     AND NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256" THEN
    RAISE EXCEPTION 'Care content hash is frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('APPROVED', 'ACTIVE', 'RETIRED')
     AND (NEW."approvedById", NEW."approvedAt", NEW."approvalReference")
         IS DISTINCT FROM (OLD."approvedById", OLD."approvedAt", OLD."approvalReference") THEN
    RAISE EXCEPTION 'Care content approval record is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('ACTIVE', 'RETIRED') AND NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" THEN
    RAISE EXCEPTION 'Care content effective date is immutable once active' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'RETIRED' AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
    RAISE EXCEPTION 'Care content retirement is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER care_content_protect
  BEFORE UPDATE OR DELETE ON "CareContent"
  FOR EACH ROW EXECUTE FUNCTION care_content_protect();

ALTER TABLE "CareContentEvent" ADD CONSTRAINT care_content_event_actor
  CHECK ("actorId" IS NOT NULL OR ("type" = 'CREATED' AND "toStatus" = 'DRAFT'));
CREATE TRIGGER care_content_event_append_only
  BEFORE UPDATE OR DELETE ON "CareContentEvent"
  FOR EACH ROW EXECUTE FUNCTION step7_append_only();
