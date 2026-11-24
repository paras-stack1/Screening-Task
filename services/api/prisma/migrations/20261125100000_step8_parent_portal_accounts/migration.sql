-- Step 8 Parent Portal accounts (decisions PP1-PP18, approved 2026-11-24;
-- docs/step-8/parent-portal-plan.md). Additive: new tables + one nullable AuditLog column.

-- CreateEnum
CREATE TYPE "ParentAccountStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ParentInvitationStatus" AS ENUM ('PENDING', 'SENT', 'USED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('INVITATION', 'PASSWORD_RESET', 'PHONE_CHANGE');

-- CreateEnum
CREATE TYPE "GuardianAccessStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "SmsPurpose" AS ENUM ('INVITATION', 'OTP', 'REMINDER');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'NOT_CONFIGURED');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorParentAccountId" UUID;

-- CreateTable
CREATE TABLE "ParentAccount" (
    "id" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "phoneLookupHash" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "ParentAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL,
    "privacyNoticeVersion" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentInvitation" (
    "id" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "ParentInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "phoneLookupHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParentInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "invitationId" UUID,
    "parentAccountId" UUID,
    "phoneLookupHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentRefreshSession" (
    "id" UUID NOT NULL,
    "parentAccountId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,
    "replacedById" UUID,

    CONSTRAINT "ParentRefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianChildAccess" (
    "id" UUID NOT NULL,
    "childGuardianId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "status" "GuardianAccessStatus" NOT NULL DEFAULT 'PENDING',
    "grantedById" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GuardianChildAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" UUID NOT NULL,
    "guardianId" UUID,
    "purpose" "SmsPurpose" NOT NULL,
    "templateId" TEXT NOT NULL,
    "maskedTo" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParentAccount_guardianId_key" ON "ParentAccount"("guardianId");

-- CreateIndex
CREATE INDEX "ParentAccount_phoneLookupHash_idx" ON "ParentAccount"("phoneLookupHash");

-- CreateIndex
CREATE UNIQUE INDEX "ParentInvitation_tokenHash_key" ON "ParentInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ParentInvitation_guardianId_createdAt_idx" ON "ParentInvitation"("guardianId", "createdAt");

-- CreateIndex
CREATE INDEX "ParentInvitation_createdById_createdAt_idx" ON "ParentInvitation"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_phoneLookupHash_createdAt_idx" ON "OtpChallenge"("phoneLookupHash", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_invitationId_createdAt_idx" ON "OtpChallenge"("invitationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParentRefreshSession_tokenHash_key" ON "ParentRefreshSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ParentRefreshSession_replacedById_key" ON "ParentRefreshSession"("replacedById");

-- CreateIndex
CREATE INDEX "ParentRefreshSession_parentAccountId_revokedAt_idx" ON "ParentRefreshSession"("parentAccountId", "revokedAt");

-- CreateIndex
CREATE INDEX "ParentRefreshSession_familyId_idx" ON "ParentRefreshSession"("familyId");

-- CreateIndex
CREATE INDEX "GuardianChildAccess_guardianId_status_idx" ON "GuardianChildAccess"("guardianId", "status");

-- CreateIndex
CREATE INDEX "GuardianChildAccess_childId_idx" ON "GuardianChildAccess"("childId");

-- CreateIndex
CREATE INDEX "SmsMessage_guardianId_createdAt_idx" ON "SmsMessage"("guardianId", "createdAt");

-- AddForeignKey
ALTER TABLE "ParentAccount" ADD CONSTRAINT "ParentAccount_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentInvitation" ADD CONSTRAINT "ParentInvitation_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentInvitation" ADD CONSTRAINT "ParentInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "ParentInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "ParentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentRefreshSession" ADD CONSTRAINT "ParentRefreshSession_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "ParentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentRefreshSession" ADD CONSTRAINT "ParentRefreshSession_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "ParentRefreshSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianChildAccess" ADD CONSTRAINT "GuardianChildAccess_childGuardianId_fkey" FOREIGN KEY ("childGuardianId") REFERENCES "ChildGuardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianChildAccess" ADD CONSTRAINT "GuardianChildAccess_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianChildAccess" ADD CONSTRAINT "GuardianChildAccess_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianChildAccess" ADD CONSTRAINT "GuardianChildAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianChildAccess" ADD CONSTRAINT "GuardianChildAccess_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Integrity rules (hand-written; not expressible in Prisma 6). Review every future generated
-- migration so they are never dropped. docs/step-8/parent-portal-plan.md section 5.
-- =====================================================================================

-- One live account per verified mobile number; one open invitation per guardian.
CREATE UNIQUE INDEX parent_account_one_live_per_phone ON "ParentAccount"("phoneLookupHash")
  WHERE "status" IN ('ACTIVE', 'LOCKED');
CREATE UNIQUE INDEX parent_invitation_one_open_per_guardian ON "ParentInvitation"("guardianId")
  WHERE "status" IN ('PENDING', 'SENT');
-- One non-revoked portal access per guardian-child link.
CREATE UNIQUE INDEX guardian_child_access_one_live_per_link ON "GuardianChildAccess"("childGuardianId")
  WHERE "status" <> 'REVOKED';

ALTER TABLE "OtpChallenge" ADD CONSTRAINT otp_attempts_bounded
  CHECK ("attempts" >= 0 AND "maxAttempts" >= 1 AND "attempts" <= "maxAttempts");
ALTER TABLE "ParentInvitation" ADD CONSTRAINT parent_invitation_states CHECK (
  ("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)
  AND ("status" = 'USED') = ("usedAt" IS NOT NULL)
  AND ("status" <> 'SENT' OR "sentAt" IS NOT NULL)
);
ALTER TABLE "GuardianChildAccess" ADD CONSTRAINT guardian_access_states CHECK (
  ("status" = 'REVOKED') = ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND "revokeReason" IS NOT NULL)
  AND ("status" <> 'ACTIVE' OR "activatedAt" IS NOT NULL)
);

/** Rejects any DELETE (history is kept). */
CREATE OR REPLACE FUNCTION step8_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER parent_account_no_delete BEFORE DELETE ON "ParentAccount"
  FOR EACH ROW EXECUTE FUNCTION step8_no_delete();
CREATE TRIGGER sms_message_no_delete BEFORE DELETE ON "SmsMessage"
  FOR EACH ROW EXECUTE FUNCTION step8_no_delete();

-- Invitations: token, guardian, phone binding and creator never change; allowed status moves only.
CREATE OR REPLACE FUNCTION parent_invitation_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Parent invitations cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'A parent invitation starts as PENDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."guardianId", NEW."tokenHash", NEW."phoneLookupHash", NEW."createdById", NEW."expiresAt", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."guardianId", OLD."tokenHash", OLD."phoneLookupHash", OLD."createdById", OLD."expiresAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'Parent invitation identity fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'PENDING' AND NEW."status" IN ('SENT', 'USED', 'REVOKED'))
    OR (OLD."status" = 'SENT' AND NEW."status" IN ('USED', 'REVOKED'))) THEN
    RAISE EXCEPTION 'Parent invitation status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER parent_invitation_protect BEFORE INSERT OR UPDATE OR DELETE ON "ParentInvitation"
  FOR EACH ROW EXECUTE FUNCTION parent_invitation_protect();

-- OTP challenges: the code, purpose and binding never change; a consumed code stays consumed.
CREATE OR REPLACE FUNCTION otp_challenge_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OTP challenges cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."purpose", NEW."invitationId", NEW."parentAccountId", NEW."phoneLookupHash", NEW."codeHash",
      NEW."expiresAt", NEW."maxAttempts", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."purpose", OLD."invitationId", OLD."parentAccountId", OLD."phoneLookupHash", OLD."codeHash",
      OLD."expiresAt", OLD."maxAttempts", OLD."createdAt")
     OR NEW."attempts" < OLD."attempts"
     OR (OLD."consumedAt" IS NOT NULL AND NEW."consumedAt" IS DISTINCT FROM OLD."consumedAt") THEN
    RAISE EXCEPTION 'OTP challenges only record attempts and a one-time use' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER otp_challenge_protect BEFORE UPDATE OR DELETE ON "OtpChallenge"
  FOR EACH ROW EXECUTE FUNCTION otp_challenge_protect();

-- Guardian-child access: must match the link; PENDING -> ACTIVE -> REVOKED (or PENDING -> REVOKED).
CREATE OR REPLACE FUNCTION guardian_access_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Guardian access history cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'Guardian access starts as PENDING' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "ChildGuardian" cg WHERE cg."id" = NEW."childGuardianId"
                     AND cg."childId" = NEW."childId" AND cg."guardianId" = NEW."guardianId"
                     AND cg."endedAt" IS NULL) THEN
      RAISE EXCEPTION 'Guardian access needs an active link between this guardian and child'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."childGuardianId", NEW."guardianId", NEW."childId", NEW."grantedById", NEW."grantedAt", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."childGuardianId", OLD."guardianId", OLD."childId", OLD."grantedById", OLD."grantedAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'Guardian access identity fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'PENDING' AND NEW."status" IN ('ACTIVE', 'REVOKED'))
    OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'REVOKED')) THEN
    RAISE EXCEPTION 'Guardian access status cannot change from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER guardian_access_protect BEFORE INSERT OR UPDATE OR DELETE ON "GuardianChildAccess"
  FOR EACH ROW EXECUTE FUNCTION guardian_access_protect();
