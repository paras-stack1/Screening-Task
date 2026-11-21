-- =====================================================================================
-- Step 5 (approved decision B, 2026-11-21). Additive and non-destructive:
--   1. ChildGuardian gets its own id, so ending a link keeps its history and the same guardian
--      can be linked again later as a NEW row (previously the composite primary key made that
--      impossible without erasing the ended link).
--   2. At most one ACTIVE link per (child, guardian) and one ACTIVE primary contact per child.
--   3. Consent becomes append-only: no DELETE, and the only allowed UPDATE is a one-time
--      withdrawal of a GRANTED record (previously nothing in the database prevented rewriting).
--   4. Consent.withdrawalMethod records how a withdrawal was communicated.
-- Existing rows are kept; existing links receive generated ids.
-- NOTE for future `prisma migrate dev` runs: the partial unique indexes and the trigger below
-- are not expressible in Prisma 6. Review generated migrations and never let them drop
-- child_guardian_one_active_link or child_guardian_one_primary.
-- =====================================================================================

-- ------------------------------------------------------------- 1. ChildGuardian identity
ALTER TABLE "ChildGuardian" ADD COLUMN "id" UUID;
UPDATE "ChildGuardian" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
ALTER TABLE "ChildGuardian" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "ChildGuardian" DROP CONSTRAINT "ChildGuardian_pkey";
ALTER TABLE "ChildGuardian" ADD CONSTRAINT "ChildGuardian_pkey" PRIMARY KEY ("id");

ALTER TABLE "ChildGuardian" ADD COLUMN "createdById" UUID;
ALTER TABLE "ChildGuardian" ADD COLUMN "endedById" UUID;
ALTER TABLE "ChildGuardian" ADD COLUMN "endReason" TEXT;

ALTER TABLE "ChildGuardian" ADD CONSTRAINT "ChildGuardian_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChildGuardian" ADD CONSTRAINT "ChildGuardian_endedById_fkey"
  FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ChildGuardian_childId_endedAt_idx" ON "ChildGuardian"("childId", "endedAt");

-- ------------------------------------------------------------- 2. Link integrity
-- An end actor/reason only on an ended link. (Links ended before this migration may lack an
-- actor, so endedAt alone is still accepted; the API always sets both.)
-- NOT VALID is not used: any existing violation must fail the migration loudly.
ALTER TABLE "ChildGuardian" ADD CONSTRAINT child_guardian_end_complete
  CHECK (("endedById" IS NULL AND "endReason" IS NULL) OR "endedAt" IS NOT NULL);

CREATE UNIQUE INDEX child_guardian_one_active_link
  ON "ChildGuardian"("childId", "guardianId") WHERE "endedAt" IS NULL;

CREATE UNIQUE INDEX child_guardian_one_primary
  ON "ChildGuardian"("childId") WHERE "endedAt" IS NULL AND "isPrimaryContact";

-- ------------------------------------------------------------- 3. Consent withdrawal method
ALTER TABLE "Consent" ADD COLUMN "withdrawalMethod" "ConsentMethod";

ALTER TABLE "Consent" ADD CONSTRAINT consent_withdrawal_method_only_when_withdrawn
  CHECK ("withdrawalMethod" IS NULL OR "withdrawnAt" IS NOT NULL);

-- ------------------------------------------------------------- 4. Append-only consent
CREATE OR REPLACE FUNCTION consent_protect_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Consent records are append-only and cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;

  -- UPDATE: only a single withdrawal of a GRANTED record is allowed.
  IF OLD."withdrawnAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Consent record is already withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."withdrawnAt" IS NULL THEN
    RAISE EXCEPTION 'Consent records can only be changed by withdrawal' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."decision" <> 'GRANTED' THEN
    RAISE EXCEPTION 'Only granted consent can be withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."childId", NEW."guardianId", NEW."purpose", NEW."decision", NEW."method",
      NEW."templateId", NEW."evidenceReference", NEW."recordedById", NEW."recordedAt", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."childId", OLD."guardianId", OLD."purpose", OLD."decision", OLD."method",
      OLD."templateId", OLD."evidenceReference", OLD."recordedById", OLD."recordedAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'Recorded consent fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consent_protect_history
  BEFORE UPDATE OR DELETE ON "Consent"
  FOR EACH ROW EXECUTE FUNCTION consent_protect_history();
