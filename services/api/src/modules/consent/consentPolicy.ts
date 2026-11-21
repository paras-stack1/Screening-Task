import {
  CONSENT_PURPOSES,
  type ConsentInvalidReason,
  type ConsentPurpose,
  type ConsentPurposeStatus,
  type ConsentStatus,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Db } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { findChildOrDeny, type AccessContext } from '../access-control/accessScope';
import type { PermissionCode } from '../access-control/permissions';
import { recordAudit } from '../audit/audit.service';

/**
 * The single authority for "may this activity happen for this child now?" (Step 5 decisions M,
 * U). Screens only display what this returns; future screening, media and AI endpoints MUST call
 * `assertConsentPermits` at the point of use, inside their own transaction.
 */
export interface ConsentPolicySettings {
  /** DRAFT (placeholder) notices are accepted only outside production. */
  allowDraftNotices: boolean;
}

/**
 * Which purposes each protected activity needs. ASSUMPTION (conservative, requires programme and
 * legal confirmation): every capture also needs screening participation, and AI analysis of a
 * recording needs consent for that recording AND for AI processing - consents never imply each
 * other.
 */
export const ACTIVITY_CONSENTS = {
  SCREENING: ['SCREENING'],
  PHOTO_CAPTURE: ['SCREENING', 'PHOTO_CAPTURE'],
  VIDEO_CAPTURE: ['SCREENING', 'VIDEO_CAPTURE'],
  AUDIO_CAPTURE: ['SCREENING', 'AUDIO_CAPTURE'],
  AI_IMAGE_ANALYSIS: ['SCREENING', 'PHOTO_CAPTURE', 'AI_PROCESSING'],
  AI_VIDEO_ANALYSIS: ['SCREENING', 'VIDEO_CAPTURE', 'AI_PROCESSING'],
  AI_AUDIO_ANALYSIS: ['SCREENING', 'AUDIO_CAPTURE', 'AI_PROCESSING'],
  REFERRAL_SHARING: ['REFERRAL_DATA_SHARING'],
  SMS_REMINDER: ['SMS_REMINDERS'],
} as const satisfies Record<string, readonly ConsentPurpose[]>;
export type ConsentActivity = keyof typeof ACTIVITY_CONSENTS;

/** Newest decision first: recordedAt, then insertion time, then id (total order). */
export const LATEST_FIRST: Prisma.ConsentOrderByWithRelationInput[] = [
  { recordedAt: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
];

const statusSelect = {
  id: true,
  purpose: true,
  decision: true,
  recordedAt: true,
  withdrawnAt: true,
  guardianId: true,
  guardian: { select: { fullName: true } },
  template: { select: { status: true } },
} satisfies Prisma.ConsentSelect;

/**
 * Current status of each purpose. Rule (decision M): only the LATEST record for (child, purpose)
 * counts - a later refusal or withdrawal is never overridden by an older grant. A grant counts
 * only while its guardian is still linked with consent authority and its notice is valid.
 */
export async function evaluateConsents(
  db: Db,
  childId: string,
  purposes: readonly ConsentPurpose[],
  policy: ConsentPolicySettings,
): Promise<ConsentPurposeStatus[]> {
  const [records, links] = await Promise.all([
    db.consent.findMany({
      where: { childId, purpose: { in: [...purposes] } },
      select: statusSelect,
      orderBy: LATEST_FIRST,
    }),
    db.childGuardian.findMany({
      where: { childId, endedAt: null, guardian: { deletedAt: null } },
      select: { guardianId: true, canGiveConsent: true },
    }),
  ]);
  const authority = new Map(links.map((l) => [l.guardianId, l.canGiveConsent]));

  return purposes.map((purpose) => {
    const latest = records.find((r) => r.purpose === purpose);
    if (!latest) {
      return {
        purpose,
        status: 'NOT_RECORDED',
        reason: null,
        permitted: false,
        consentId: null,
        guardianName: null,
        recordedAt: null,
      };
    }
    let status: ConsentStatus;
    let reason: ConsentInvalidReason | null = null;
    if (latest.decision === 'REFUSED') status = 'REFUSED';
    else if (latest.withdrawnAt) status = 'WITHDRAWN';
    else if (!authority.has(latest.guardianId)) [status, reason] = ['NOT_VALID', 'GUARDIAN_NO_LONGER_LINKED'];
    else if (!authority.get(latest.guardianId)) [status, reason] = ['NOT_VALID', 'GUARDIAN_NOT_AUTHORISED'];
    else if (latest.template.status === 'RETIRED') [status, reason] = ['NOT_VALID', 'NOTICE_RETIRED'];
    else if (latest.template.status !== 'APPROVED' && !policy.allowDraftNotices) {
      [status, reason] = ['NOT_VALID', 'NOTICE_NOT_APPROVED'];
    } else status = 'GRANTED';
    return {
      purpose,
      status,
      reason,
      permitted: status === 'GRANTED',
      consentId: latest.id,
      guardianName: latest.guardian.fullName,
      recordedAt: latest.recordedAt.toISOString(),
    };
  });
}

export function evaluateAllPurposes(db: Db, childId: string, policy: ConsentPolicySettings) {
  return evaluateConsents(db, childId, CONSENT_PURPOSES, policy);
}

/**
 * Point-of-use check for a protected activity. Verifies child access (with the activity's
 * permission) AND every required purpose. Missing, refused, withdrawn or invalid consent is a
 * 403 CONSENT_REQUIRED (audited), with the purposes that block it so the app can explain.
 * Returns the consent ids that authorised the activity (to store on media / AI records).
 */
export async function assertConsentPermits(
  db: Db,
  ctx: AccessContext & { auditDb?: PrismaClient },
  childId: string,
  activity: ConsentActivity,
  permission: PermissionCode,
  policy: ConsentPolicySettings,
): Promise<Record<ConsentPurpose, string>> {
  const child = await findChildOrDeny(db, ctx, childId, permission);
  const statuses = await evaluateConsents(db, childId, ACTIVITY_CONSENTS[activity], policy);
  const missing = statuses.filter((s) => !s.permitted);
  if (missing.length > 0) {
    const details = {
      activity,
      missing: missing.map((s) => ({ purpose: s.purpose, status: s.status, reason: s.reason })),
    };
    // Inside a transaction the denial audit must use the root client, or the rollback erases it.
    const auditDb = ctx.auditDb ?? ('$transaction' in db ? db : null);
    if (!auditDb)
      throw new Error('AccessContext.auditDb is required when consent checks run inside a transaction');
    await recordAudit(auditDb, {
      actorUserId: ctx.userId,
      action: 'consent.check_denied',
      entityType: 'child',
      entityId: childId,
      areaId: child.areaId,
      outcome: 'DENIED',
      requestId: ctx.requestId,
      details,
    });
    throw new AppError(
      403,
      'CONSENT_REQUIRED',
      'Guardian consent does not allow this activity for this child.',
      details,
    );
  }
  return Object.fromEntries(statuses.map((s) => [s.purpose, s.consentId!])) as Record<ConsentPurpose, string>;
}
