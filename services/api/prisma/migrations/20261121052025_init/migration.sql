-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "AssignmentScope" AS ENUM ('AREA_ONLY', 'AREA_AND_DESCENDANTS');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SexAtBirth" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'NOT_RECORDED');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('MOTHER', 'FATHER', 'GRANDPARENT', 'SIBLING', 'OTHER_RELATIVE', 'LEGAL_GUARDIAN', 'INSTITUTION_CARETAKER', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('SCREENING', 'PHOTO_CAPTURE', 'VIDEO_CAPTURE', 'AUDIO_CAPTURE', 'AI_PROCESSING', 'REFERRAL_DATA_SHARING', 'SMS_REMINDERS');

-- CreateEnum
CREATE TYPE "ConsentDecision" AS ENUM ('GRANTED', 'REFUSED');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('VERBAL_WITNESSED', 'SIGNATURE', 'THUMB_IMPRESSION', 'DIGITAL_ACKNOWLEDGEMENT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "FourDCategory" AS ENUM ('DEFECTS_AT_BIRTH', 'DEFICIENCIES', 'DISEASES', 'DEVELOPMENTAL_DELAYS_DISABILITIES');

-- CreateEnum
CREATE TYPE "AnswerType" AS ENUM ('YES_NO', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'NUMBER', 'TEXT');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ObservationStatus" AS ENUM ('ANSWERED', 'NOT_ASSESSED', 'UNABLE_TO_ASSESS');

-- CreateEnum
CREATE TYPE "MeasurementType" AS ENUM ('WEIGHT', 'HEIGHT', 'LENGTH', 'MUAC', 'HEAD_CIRCUMFERENCE', 'HAEMOGLOBIN');

-- CreateEnum
CREATE TYPE "MeasurementQuality" AS ENUM ('RELIABLE', 'QUESTIONABLE', 'NOT_RELIABLE');

-- CreateEnum
CREATE TYPE "ResultOutcome" AS ENUM ('REFERRAL_RECOMMENDED', 'FOLLOW_UP_RECOMMENDED', 'NO_CONCERN_IN_COMPLETED_ITEMS', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "ResultSource" AS ENUM ('RULE_ENGINE', 'WORKER_OBSERVATION', 'AI_SUPPORT', 'CLINICIAN');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'REVIEWED');

-- CreateEnum
CREATE TYPE "AiAnalysisType" AS ENUM ('IMAGE_QUALITY', 'IMAGE_ANALYSIS', 'SPEECH', 'MOVEMENT', 'DEVELOPMENTAL', 'GROWTH');

-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'FAILED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('DEIC', 'PHC', 'CHC', 'DISTRICT_HOSPITAL', 'MEDICAL_COLLEGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReferralUrgency" AS ENUM ('ROUTINE', 'PRIORITY', 'URGENT');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('CREATED', 'APPOINTMENT_SCHEDULED', 'ATTENDED', 'COMPLETED', 'NOT_ATTENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'DONE', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('PHOTO', 'VIDEO', 'AUDIO');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING_UPLOAD', 'STORED', 'QUARANTINED', 'DELETED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RECEIVED', 'APPLIED', 'REJECTED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FOLLOW_UP_DUE', 'REFERRAL_UPDATE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "organizationId" UUID,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'hi',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "passwordChangedAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "AreaLevel" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "allowsChildRegistration" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AreaLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" UUID NOT NULL,
    "levelId" UUID NOT NULL,
    "parentId" UUID,
    "code" TEXT NOT NULL,
    "externalCode" TEXT,
    "nameEn" TEXT NOT NULL,
    "nameHi" TEXT,
    "depth" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaClosure" (
    "ancestorId" UUID NOT NULL,
    "descendantId" UUID NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "AreaClosure_pkey" PRIMARY KEY ("ancestorId","descendantId")
);

-- CreateTable
CREATE TABLE "WorkerAreaAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "scope" "AssignmentScope" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "statusChangedById" UUID,
    "statusChangedAt" TIMESTAMPTZ(3),
    "statusChangeReason" TEXT,

    CONSTRAINT "WorkerAreaAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Child" (
    "id" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "dobIsEstimated" BOOLEAN NOT NULL DEFAULT false,
    "sexAtBirth" "SexAtBirth" NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "deletionReason" TEXT,

    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildAreaTransfer" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "fromAreaId" UUID NOT NULL,
    "toAreaId" UUID NOT NULL,
    "transferredById" UUID NOT NULL,
    "transferredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "ChildAreaTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardian" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneEncrypted" BYTEA,
    "phoneLookupHash" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'hi',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildGuardian" (
    "childId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "relationship" "GuardianRelationship" NOT NULL,
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "canGiveConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ChildGuardian_pkey" PRIMARY KEY ("childId","guardianId")
);

-- CreateTable
CREATE TABLE "ConsentTemplate" (
    "id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "version" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalReference" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "decision" "ConsentDecision" NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "templateId" UUID NOT NULL,
    "evidenceReference" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "withdrawnAt" TIMESTAMPTZ(3),
    "withdrawnById" UUID,
    "withdrawalReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningProtocol" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "ageMinDays" INTEGER NOT NULL,
    "ageMaxDays" INTEGER NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "clinicalApprovedById" UUID,
    "clinicalApprovedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScreeningProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningQuestion" (
    "id" UUID NOT NULL,
    "protocolId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" "FourDCategory" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "promptKey" TEXT NOT NULL,
    "helpKey" TEXT,
    "answerType" "AnswerType" NOT NULL,
    "options" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScreeningQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningSession" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "protocolId" UUID NOT NULL,
    "conductedById" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "ageInDaysAtStart" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScreeningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningObservation" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "status" "ObservationStatus" NOT NULL,
    "valueBoolean" BOOLEAN,
    "valueCode" TEXT,
    "valueCodes" TEXT[],
    "valueNumber" DECIMAL(10,3),
    "valueText" TEXT,
    "notAssessedReason" TEXT,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScreeningObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "sessionId" UUID,
    "type" "MeasurementType" NOT NULL,
    "value" DECIMAL(8,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "method" TEXT,
    "deviceMake" TEXT,
    "deviceModel" TEXT,
    "deviceSerial" TEXT,
    "quality" "MeasurementQuality" NOT NULL,
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningResult" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "category" "FourDCategory" NOT NULL,
    "outcome" "ResultOutcome" NOT NULL,
    "source" "ResultSource" NOT NULL,
    "ruleSetVersion" TEXT,
    "aiAnalysisId" UUID,
    "reasons" JSONB NOT NULL,
    "limitations" JSONB,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "consentId" UUID NOT NULL,
    "analysisType" "AiAnalysisType" NOT NULL,
    "requestId" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "modelName" TEXT,
    "modelVersion" TEXT,
    "isMock" BOOLEAN NOT NULL,
    "status" "AiAnalysisStatus" NOT NULL,
    "inputQuality" TEXT,
    "output" JSONB,
    "humanReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "errorCode" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL,
    "areaId" UUID NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "sessionId" UUID,
    "facilityId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "category" "FourDCategory",
    "urgency" "ReferralUrgency" NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'CREATED',
    "reasonCode" TEXT,
    "notes" TEXT,
    "appointmentAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "clientOperationId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralStatusEvent" (
    "id" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "fromStatus" "ReferralStatus",
    "toStatus" "ReferralStatus" NOT NULL,
    "changedById" UUID NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ReferralStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "referralId" UUID,
    "dueDate" DATE NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToId" UUID,
    "completedAt" TIMESTAMPTZ(3),
    "completedById" UUID,
    "outcomeNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaMetadata" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "sessionId" UUID,
    "consentId" UUID NOT NULL,
    "type" "MediaType" NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "capturedById" UUID NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "retentionUntil" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "deletionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,
    "replacedById" UUID,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOperation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientOperationId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "status" "SyncStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "responseSnapshot" JSONB,

    CONSTRAINT "SyncOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "areaId" UUID,
    "outcome" "AuditOutcome" NOT NULL,
    "requestId" TEXT,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "AreaLevel_code_key" ON "AreaLevel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AreaLevel_rank_key" ON "AreaLevel"("rank");

-- CreateIndex
CREATE INDEX "Area_parentId_idx" ON "Area"("parentId");

-- CreateIndex
CREATE INDEX "Area_levelId_isActive_idx" ON "Area"("levelId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Area_parentId_code_key" ON "Area"("parentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Area_levelId_externalCode_key" ON "Area"("levelId", "externalCode");

-- CreateIndex
CREATE INDEX "AreaClosure_descendantId_ancestorId_idx" ON "AreaClosure"("descendantId", "ancestorId");

-- CreateIndex
CREATE INDEX "WorkerAreaAssignment_userId_status_effectiveFrom_idx" ON "WorkerAreaAssignment"("userId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkerAreaAssignment_areaId_status_idx" ON "WorkerAreaAssignment"("areaId", "status");

-- CreateIndex
CREATE INDEX "WorkerAreaAssignment_roleId_idx" ON "WorkerAreaAssignment"("roleId");

-- CreateIndex
CREATE INDEX "Child_areaId_deletedAt_idx" ON "Child"("areaId", "deletedAt");

-- CreateIndex
CREATE INDEX "Child_areaId_dateOfBirth_idx" ON "Child"("areaId", "dateOfBirth");

-- CreateIndex
CREATE INDEX "ChildAreaTransfer_childId_transferredAt_idx" ON "ChildAreaTransfer"("childId", "transferredAt");

-- CreateIndex
CREATE INDEX "Guardian_phoneLookupHash_idx" ON "Guardian"("phoneLookupHash");

-- CreateIndex
CREATE INDEX "ChildGuardian_guardianId_idx" ON "ChildGuardian"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentTemplate_purpose_version_languageCode_key" ON "ConsentTemplate"("purpose", "version", "languageCode");

-- CreateIndex
CREATE INDEX "Consent_childId_purpose_recordedAt_idx" ON "Consent"("childId", "purpose", "recordedAt");

-- CreateIndex
CREATE INDEX "Consent_guardianId_idx" ON "Consent"("guardianId");

-- CreateIndex
CREATE INDEX "ScreeningProtocol_status_ageMinDays_ageMaxDays_idx" ON "ScreeningProtocol"("status", "ageMinDays", "ageMaxDays");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningProtocol_code_version_key" ON "ScreeningProtocol"("code", "version");

-- CreateIndex
CREATE INDEX "ScreeningQuestion_protocolId_sortOrder_idx" ON "ScreeningQuestion"("protocolId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningQuestion_protocolId_code_key" ON "ScreeningQuestion"("protocolId", "code");

-- CreateIndex
CREATE INDEX "ScreeningSession_childId_startedAt_idx" ON "ScreeningSession"("childId", "startedAt");

-- CreateIndex
CREATE INDEX "ScreeningSession_areaId_status_startedAt_idx" ON "ScreeningSession"("areaId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "ScreeningSession_conductedById_startedAt_idx" ON "ScreeningSession"("conductedById", "startedAt");

-- CreateIndex
CREATE INDEX "ScreeningObservation_questionId_idx" ON "ScreeningObservation"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningObservation_sessionId_questionId_key" ON "ScreeningObservation"("sessionId", "questionId");

-- CreateIndex
CREATE INDEX "Measurement_childId_type_measuredAt_idx" ON "Measurement"("childId", "type", "measuredAt");

-- CreateIndex
CREATE INDEX "Measurement_sessionId_idx" ON "Measurement"("sessionId");

-- CreateIndex
CREATE INDEX "ScreeningResult_sessionId_idx" ON "ScreeningResult"("sessionId");

-- CreateIndex
CREATE INDEX "ScreeningResult_reviewStatus_createdAt_idx" ON "ScreeningResult"("reviewStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysis_requestId_key" ON "AiAnalysis"("requestId");

-- CreateIndex
CREATE INDEX "AiAnalysis_sessionId_idx" ON "AiAnalysis"("sessionId");

-- CreateIndex
CREATE INDEX "AiAnalysis_consentId_idx" ON "AiAnalysis"("consentId");

-- CreateIndex
CREATE INDEX "Facility_areaId_type_isActive_idx" ON "Facility"("areaId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_clientOperationId_key" ON "Referral"("clientOperationId");

-- CreateIndex
CREATE INDEX "Referral_childId_idx" ON "Referral"("childId");

-- CreateIndex
CREATE INDEX "Referral_areaId_status_idx" ON "Referral"("areaId", "status");

-- CreateIndex
CREATE INDEX "Referral_facilityId_status_idx" ON "Referral"("facilityId", "status");

-- CreateIndex
CREATE INDEX "ReferralStatusEvent_referralId_changedAt_idx" ON "ReferralStatusEvent"("referralId", "changedAt");

-- CreateIndex
CREATE INDEX "FollowUp_assignedToId_status_dueDate_idx" ON "FollowUp"("assignedToId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "FollowUp_childId_idx" ON "FollowUp"("childId");

-- CreateIndex
CREATE INDEX "FollowUp_status_dueDate_idx" ON "FollowUp"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "MediaMetadata_storageKey_key" ON "MediaMetadata"("storageKey");

-- CreateIndex
CREATE INDEX "MediaMetadata_childId_idx" ON "MediaMetadata"("childId");

-- CreateIndex
CREATE INDEX "MediaMetadata_consentId_idx" ON "MediaMetadata"("consentId");

-- CreateIndex
CREATE INDEX "MediaMetadata_status_retentionUntil_idx" ON "MediaMetadata"("status", "retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_replacedById_key" ON "RefreshSession"("replacedById");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_revokedAt_idx" ON "RefreshSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SyncOperation_userId_receivedAt_idx" ON "SyncOperation"("userId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncOperation_userId_clientOperationId_key" ON "SyncOperation"("userId", "clientOperationId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_occurredAt_idx" ON "AuditLog"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_occurredAt_idx" ON "AuditLog"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_occurredAt_idx" ON "AuditLog"("action", "occurredAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "AreaLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaClosure" ADD CONSTRAINT "AreaClosure_ancestorId_fkey" FOREIGN KEY ("ancestorId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaClosure" ADD CONSTRAINT "AreaClosure_descendantId_fkey" FOREIGN KEY ("descendantId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerAreaAssignment" ADD CONSTRAINT "WorkerAreaAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerAreaAssignment" ADD CONSTRAINT "WorkerAreaAssignment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerAreaAssignment" ADD CONSTRAINT "WorkerAreaAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerAreaAssignment" ADD CONSTRAINT "WorkerAreaAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerAreaAssignment" ADD CONSTRAINT "WorkerAreaAssignment_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildAreaTransfer" ADD CONSTRAINT "ChildAreaTransfer_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildAreaTransfer" ADD CONSTRAINT "ChildAreaTransfer_fromAreaId_fkey" FOREIGN KEY ("fromAreaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildAreaTransfer" ADD CONSTRAINT "ChildAreaTransfer_toAreaId_fkey" FOREIGN KEY ("toAreaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildAreaTransfer" ADD CONSTRAINT "ChildAreaTransfer_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildGuardian" ADD CONSTRAINT "ChildGuardian_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildGuardian" ADD CONSTRAINT "ChildGuardian_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ConsentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningProtocol" ADD CONSTRAINT "ScreeningProtocol_clinicalApprovedById_fkey" FOREIGN KEY ("clinicalApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningQuestion" ADD CONSTRAINT "ScreeningQuestion_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "ScreeningProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningSession" ADD CONSTRAINT "ScreeningSession_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningSession" ADD CONSTRAINT "ScreeningSession_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "ScreeningProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningSession" ADD CONSTRAINT "ScreeningSession_conductedById_fkey" FOREIGN KEY ("conductedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningSession" ADD CONSTRAINT "ScreeningSession_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningObservation" ADD CONSTRAINT "ScreeningObservation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningObservation" ADD CONSTRAINT "ScreeningObservation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ScreeningQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_aiAnalysisId_fkey" FOREIGN KEY ("aiAnalysisId") REFERENCES "AiAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "Consent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralStatusEvent" ADD CONSTRAINT "ReferralStatusEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralStatusEvent" ADD CONSTRAINT "ReferralStatusEvent_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaMetadata" ADD CONSTRAINT "MediaMetadata_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaMetadata" ADD CONSTRAINT "MediaMetadata_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScreeningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaMetadata" ADD CONSTRAINT "MediaMetadata_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "Consent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaMetadata" ADD CONSTRAINT "MediaMetadata_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "RefreshSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Additions from docs/database-design.md section 9 (Prisma cannot express these).
-- =====================================================================

-- ---------------------------------------------------------------- 9.1 Area rules
-- A parent must be at a higher level (smaller rank) than its child; only one root.
CREATE OR REPLACE FUNCTION area_check_hierarchy() RETURNS trigger AS $$
DECLARE
  parent_rank int;
  own_rank    int;
BEGIN
  SELECT rank INTO own_rank FROM "AreaLevel" WHERE id = NEW."levelId";
  IF NEW."parentId" IS NULL THEN
    IF EXISTS (SELECT 1 FROM "Area" WHERE "parentId" IS NULL AND id <> NEW.id) THEN
      RAISE EXCEPTION 'Only one root area is allowed';
    END IF;
    RETURN NEW;
  END IF;
  SELECT l.rank INTO parent_rank
    FROM "Area" a JOIN "AreaLevel" l ON l.id = a."levelId"
   WHERE a.id = NEW."parentId";
  IF parent_rank >= own_rank THEN
    RAISE EXCEPTION 'Parent area level (rank %) must be above child level (rank %)', parent_rank, own_rank;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER area_check_hierarchy
  BEFORE INSERT OR UPDATE OF "parentId", "levelId" ON "Area"
  FOR EACH ROW EXECUTE FUNCTION area_check_hierarchy();

ALTER TABLE "AreaClosure" ADD CONSTRAINT area_closure_depth_non_negative CHECK (depth >= 0);

-- ---------------------------------------------------------- 9.2 Assignment rules
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "WorkerAreaAssignment"
  ADD CONSTRAINT assignment_valid_period
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- No two non-revoked assignments of the same user, area and role may overlap in time.
ALTER TABLE "WorkerAreaAssignment"
  ADD CONSTRAINT assignment_no_overlap
  EXCLUDE USING gist (
    "userId" WITH =,
    "areaId" WITH =,
    "roleId" WITH =,
    tstzrange("effectiveFrom", "effectiveTo", '[)') WITH &&
  ) WHERE (status <> 'REVOKED');

-- ------------------------------------------------------------- 9.3 Other checks
ALTER TABLE "Consent" ADD CONSTRAINT consent_withdrawal_complete
  CHECK (("withdrawnAt" IS NULL) = ("withdrawnById" IS NULL));
ALTER TABLE "Measurement" ADD CONSTRAINT measurement_value_positive CHECK (value > 0);
ALTER TABLE "ScreeningProtocol" ADD CONSTRAINT protocol_age_band
  CHECK ("ageMinDays" >= 0 AND "ageMaxDays" >= "ageMinDays");
ALTER TABLE "MediaMetadata" ADD CONSTRAINT media_size_positive CHECK ("sizeBytes" > 0);

-- ------------------------------------------------------- 9.4 Insert-only audit log
-- Append-only enforcement for every account, independent of role names (bypass requires
-- deliberately disabling the trigger, i.e. a schema change by the owner).
-- (setup-app-role.sql additionally REVOKEs UPDATE/DELETE/TRUNCATE from the runtime account.)
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% is not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
