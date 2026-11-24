import { randomUUID } from 'node:crypto';
import {
  TRACKING_STATUSES,
  type ReferralCloseRequest,
  type ReferralCorrectionRequest,
  type ReferralTrackingRequest,
} from '@balswasthya/shared-contracts';
import type {
  ApproveReferralRequest,
  ChangeFacilityRequest,
  CreateReferralRequest,
  IssueReferralRequest,
  ReferralDetail,
  ReferralListQuery,
  ReferralListResponse,
  ReferralReasonRequest,
  ReferralStatus,
  ReferralSummary,
} from '@balswasthya/shared-contracts';
import { Prisma, type NotificationType, type PrismaClient } from '@prisma/client';
import type { Db } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { runIdempotent } from '../../utils/idempotency';
import type { PiiCrypto } from '../../utils/piiCrypto';
import {
  assertInScopeOrDeny,
  childScopeWhere,
  findChildOrDeny,
  scopedWhere,
  type AccessContext,
} from '../access-control/accessScope';
import { permissionsOverArea } from '../access-control/authorization.service';
import type { PermissionCode } from '../access-control/permissions';
import { recordAudit } from '../audit/audit.service';
import { assertConsentPermits, type ConsentPolicySettings } from '../consent/consentPolicy';
import { notifyAfterCommit } from '../notifications/notifications.service';
import { actorRoleCode, assertFacilityChoice, isSelectable, recordText } from './referralCommon';

export interface ReferralsServiceDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  consentPolicy: ConsentPolicySettings;
}

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;
const FINAL: ReferralStatus[] = ['REJECTED', 'CLOSED', 'CANCELLED'];
const BEFORE_ISSUE: ReferralStatus[] = ['PENDING_APPROVAL', 'APPROVED'];
const CLOSABLE: ReferralStatus[] = [
  'VISITED',
  'UNDER_TREATMENT',
  'FOLLOW_UP_REQUIRED',
  'VISIT_NOT_COMPLETED',
];
/** Tracking moves after issue (architecture.md section 6; the database enforces the same). */
const TRACKING_NEXT: Partial<Record<ReferralStatus, readonly ReferralStatus[]>> = {
  ISSUED: ['ACKNOWLEDGED', 'APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED'],
  ACKNOWLEDGED: ['APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED'],
  APPOINTMENT_SCHEDULED: ['APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED'],
  VISIT_NOT_COMPLETED: ['APPOINTMENT_SCHEDULED', 'VISITED', 'FOLLOW_UP_REQUIRED'],
  VISITED: ['UNDER_TREATMENT', 'FOLLOW_UP_REQUIRED'],
  UNDER_TREATMENT: ['FOLLOW_UP_REQUIRED'],
  FOLLOW_UP_REQUIRED: ['APPOINTMENT_SCHEDULED', 'VISITED', 'UNDER_TREATMENT'],
};
/** Tracking, closure and corrections: medical officers or supervisors (decision O). */
const trackingPermission = (perms: Set<PermissionCode>): PermissionCode | null =>
  perms.has('referral.approve')
    ? 'referral.approve'
    : perms.has('referral.update')
      ? 'referral.update'
      : null;

export const referralDetailInclude = {
  child: { select: { fullName: true, areaId: true } },
  facility: { select: { name: true } },
  createdBy: { select: { displayName: true } },
  approvedBy: { select: { displayName: true } },
  sharingConsent: { select: { withdrawnAt: true } },
  statusEvents: {
    include: { changedBy: { select: { displayName: true } }, facility: { select: { name: true } } },
    orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
  },
  amendmentImpacts: {
    include: {
      amendment: { select: { sequence: true } },
      reassessedBy: { select: { displayName: true } },
    },
    orderBy: { amendment: { sequence: 'asc' } },
  },
} satisfies Prisma.ReferralInclude;
type DetailRow = Prisma.ReferralGetPayload<{ include: typeof referralDetailInclude }>;

const summaryInclude = {
  child: { select: { fullName: true } },
  facility: { select: { name: true } },
  _count: { select: { amendmentImpacts: { where: { reassessmentStatus: 'PENDING' } } } },
} satisfies Prisma.ReferralInclude;
type SummaryRow = Prisma.ReferralGetPayload<{ include: typeof summaryInclude }>;

function toSummary(r: SummaryRow | DetailRow, pending: number): ReferralSummary {
  return {
    id: r.id,
    childId: r.childId,
    childName: r.child.fullName,
    sessionId: r.sessionId,
    category: r.category,
    origin: r.origin,
    priority: r.urgency,
    status: r.status,
    version: r.version,
    facilityId: r.facilityId,
    facilityName: r.facility?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    pendingReassessments: pending,
  };
}

/** What the caller may do with this referral now (architecture.md section 6). */
export function referralActions(
  r: { status: ReferralStatus; createdById: string; facilityId: string | null },
  perms: Set<PermissionCode>,
  userId: string,
  pendingReassessments: number,
) {
  const creator = r.createdById === userId && perms.has('referral.create');
  const approver = perms.has('referral.approve');
  const updater = perms.has('referral.update');
  return {
    approve: approver && r.status === 'PENDING_APPROVAL',
    reject: approver && r.status === 'PENDING_APPROVAL',
    changeFacility:
      (r.status === 'PENDING_APPROVAL' && (approver || creator)) || (r.status === 'APPROVED' && approver),
    issue: r.status === 'APPROVED' && r.facilityId !== null && (creator || approver || updater),
    cancel: FINAL.includes(r.status)
      ? false
      : BEFORE_ISSUE.includes(r.status)
        ? creator || approver || updater
        : approver || updater,
    reassess: pendingReassessments > 0 && (approver || perms.has('screening.review')),
  };
}

/**
 * Referrals (Step 7 stage 7C; decisions J-N, docs/step-7/referral-workflow.md).
 *
 * Every change runs one guarded transaction: scope (404 + audit, R11) -> row lock -> version
 * (409) -> server-decided permission for THIS action over the child's current area (403 +
 * audit) -> state check (409) -> status event + referral update + audit together. The database
 * enforces the same state machine, history and duplicate rules again.
 */
export function createReferralsService({ db, pii, consentPolicy }: ReferralsServiceDependencies) {
  const text = recordText(pii);
  const at = (ctx: AccessContext) => ctx.at ?? new Date();

  async function loadDetail(ctx: AccessContext, id: string, client: Db = db): Promise<ReferralDetail> {
    const r = await client.referral.findUniqueOrThrow({ where: { id }, include: referralDetailInclude });
    const pending = r.amendmentImpacts.filter((i) => i.reassessmentStatus === 'PENDING').length;
    const perms = await permissionsOverArea(client, ctx.userId, r.child.areaId, at(ctx));
    return {
      ...toSummary(r, pending),
      screeningResultId: r.screeningResultId,
      clinicalReviewId: r.clinicalReviewId,
      reasonCode: r.reasonCode,
      reasonNote: text.open({ kind: 'referral', id: r.id, field: 'reasonNote' }, r.reasonNote),
      createdByName: r.createdBy.displayName,
      approvedByName: r.approvedBy?.displayName ?? null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      issuedAt: r.issuedAt?.toISOString() ?? null,
      sharingConsentId: r.sharingConsentId,
      consentVerifiedAt: r.consentVerifiedAt?.toISOString() ?? null,
      consentWithdrawnAfterIssue:
        r.consentWithdrawnAfterIssueAt !== null || (r.sharingConsent?.withdrawnAt ?? null) !== null,
      outOfDistrictReason: text.open(
        { kind: 'referral', id: r.id, field: 'outOfDistrictReason' },
        r.outOfDistrictReason,
      ),
      appointmentAt: r.appointmentAt?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      history: r.statusEvents.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        changedByName: e.changedBy.displayName,
        actorRoleCode: e.actorRoleCode,
        changedAt: e.changedAt.toISOString(),
        source: e.source,
        verificationStatus: e.verificationStatus,
        effectiveAt: e.effectiveAt?.toISOString() ?? null,
        facilityName: e.facility?.name ?? null,
        correctsEventId: e.correctsEventId,
        reason: text.open({ kind: 'referralEvent', id: e.id, field: 'reason' }, e.reason),
        note: text.open({ kind: 'referralEvent', id: e.id, field: 'note' }, e.note),
      })),
      reassessments: r.amendmentImpacts.map((i) => ({
        id: i.id,
        amendmentId: i.amendmentId,
        amendmentSequence: i.amendment.sequence,
        statusAtAmendment: i.referralStatusAtAmendment,
        reassessmentStatus: i.reassessmentStatus,
        reassessedByName: i.reassessedBy?.displayName ?? null,
        reassessedAt: i.reassessedAt?.toISOString() ?? null,
      })),
      actions: referralActions(r, perms, ctx.userId, pending),
    };
  }

  async function denied(
    ctx: AccessContext,
    referralId: string,
    areaId: string,
    action: string,
    reason: string,
  ) {
    await recordAudit(db, {
      actorUserId: ctx.userId,
      action: 'referral.action_denied',
      entityType: 'referral',
      entityId: referralId,
      areaId,
      outcome: 'DENIED',
      requestId: ctx.requestId,
      details: { action, reason },
    });
    return AppError.forbidden(
      'REFERRAL_ACTION_NOT_ALLOWED',
      'You are not allowed to do this with this referral.',
    );
  }

  interface Change {
    /** Fields to update (the version is incremented automatically). */
    data: Prisma.ReferralUncheckedUpdateInput;
    /** Status event written BEFORE the update (database rule: same transaction). */
    event?: {
      toStatus: ReferralStatus;
      permission: PermissionCode;
      reason?: string;
      note?: string;
      facilityId?: string | null;
      /** Tracking reports (decision O); default APP_USER_DIRECT / VERIFIED. */
      source?: 'APP_USER_DIRECT' | 'FACILITY_PHONE_CALL' | 'FACILITY_DOCUMENT_SEEN' | 'GUARDIAN_REPORTED';
      effectiveAt?: Date;
      correctsEventId?: string;
    };
    audit: { action: string; details: Prisma.InputJsonObject };
    /** In-app notification to the referral's creator after commit (not to themself). */
    notify?: NotificationType;
  }

  /** The guarded change sequence shared by every referral action. */
  async function change(
    ctx: AccessContext,
    id: string,
    expectedVersion: number,
    action: string,
    decide: (
      tx: Tx,
      r: Prisma.ReferralGetPayload<{ include: { child: { select: { areaId: true } } } }>,
      perms: Set<PermissionCode>,
    ) => Promise<Change>,
  ): Promise<ReferralDetail> {
    await assertInScopeOrDeny(db, ctx, 'referral', id, 'child.read');
    // Assigned inside the transaction callback (TypeScript cannot see that, hence the cast).
    let notice = null as { type: NotificationType; userId: string } | null;
    await db
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Referral" WHERE id = ${id}::uuid FOR UPDATE`;
        const r = await tx.referral.findUniqueOrThrow({
          where: { id },
          include: { child: { select: { areaId: true } } },
        });
        if (r.version !== expectedVersion) {
          throw AppError.conflict(
            'VERSION_CONFLICT',
            'This referral was changed elsewhere. Reload it first.',
            {
              currentVersion: r.version,
            },
          );
        }
        const perms = await permissionsOverArea(tx, ctx.userId, r.child.areaId, at(ctx));
        const c = await decide(tx, r, perms);
        if (c.event) {
          const eventId = randomUUID();
          await tx.referralStatusEvent.create({
            data: {
              id: eventId,
              referralId: id,
              fromStatus: r.status,
              toStatus: c.event.toStatus,
              changedById: ctx.userId,
              actorRoleCode: await actorRoleCode(tx, ctx.userId, r.child.areaId, c.event.permission, at(ctx)),
              source: c.event.source ?? 'APP_USER_DIRECT',
              // Only the family's account is unverified; facility information and the user's own
              // actions are recorded as verified (decision O).
              verificationStatus: c.event.source === 'GUARDIAN_REPORTED' ? 'UNVERIFIED' : 'VERIFIED',
              effectiveAt: c.event.effectiveAt ?? null,
              correctsEventId: c.event.correctsEventId ?? null,
              facilityId: c.event.facilityId ?? null,
              reason: text.seal({ kind: 'referralEvent', id: eventId, field: 'reason' }, c.event.reason),
              note: text.seal({ kind: 'referralEvent', id: eventId, field: 'note' }, c.event.note),
            },
          });
        }
        await tx.referral.update({ where: { id }, data: { ...c.data, version: { increment: 1 } } });
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: c.audit.action,
          entityType: 'referral',
          entityId: id,
          areaId: r.child.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: { from: r.status, ...c.audit.details },
        });
        if (c.notify && r.createdById !== ctx.userId) notice = { type: c.notify, userId: r.createdById };
      }, TX_OPTIONS)
      .catch(async (error: unknown) => {
        if (error instanceof DeniedAction) {
          const r = await db.referral.findUniqueOrThrow({
            where: { id },
            include: { child: { select: { areaId: true } } },
          });
          throw await denied(ctx, id, r.child.areaId, action, error.reason);
        }
        throw error;
      });
    if (notice) {
      const { type, userId } = notice;
      await notifyAfterCommit(db, () =>
        Promise.resolve([
          {
            userId,
            type,
            entityType: 'referral',
            entityId: id,
            dedupeKey: `${type}:${id}:${expectedVersion + 1}`,
          },
        ]),
      );
    }
    return loadDetail(ctx, id);
  }

  class DeniedAction extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  const wrongState = (status: ReferralStatus) =>
    AppError.conflict('INVALID_REFERRAL_STATE', `This is not possible while the referral is ${status}.`, {
      status,
    });

  async function sessionContext(
    tx: Db,
    childId: string,
    sessionId: string | undefined,
    category: string | undefined,
  ) {
    if (!sessionId) return { screeningResultId: null, referralRecommended: false };
    const session = await tx.screeningSession.findUnique({
      where: { id: sessionId },
      select: { childId: true, status: true },
    });
    if (!session || session.childId !== childId) {
      throw AppError.unprocessable(
        'SCREENING_CHILD_MISMATCH',
        'This screening does not belong to this child.',
      );
    }
    if (session.status !== 'COMPLETED') {
      throw AppError.unprocessable('SCREENING_NOT_COMPLETED', 'Refer from a completed screening.');
    }
    if (!category) return { screeningResultId: null, referralRecommended: false };
    const result = await tx.screeningResult.findFirst({
      where: { sessionId, category: category as never, resultRun: { supersededAt: null } },
      select: { id: true, referralRecommended: true },
    });
    return {
      screeningResultId: result?.id ?? null,
      referralRecommended: result?.referralRecommended ?? false,
    };
  }

  async function activeDuplicate(childId: string, sessionId: string | null, category: string | null) {
    return db.referral.findFirst({
      where: {
        childId,
        sessionId,
        category: category as never,
        status: { notIn: FINAL },
      },
      select: { id: true },
    });
  }

  return {
    loadDetail,

    async get(ctx: AccessContext, id: string): Promise<ReferralDetail> {
      await assertInScopeOrDeny(db, ctx, 'referral', id, 'child.read');
      return loadDetail(ctx, id);
    },

    async list(ctx: AccessContext, query: ReferralListQuery): Promise<ReferralListResponse> {
      const now = at(ctx);
      const where: Prisma.ReferralWhereInput = {
        AND: [
          scopedWhere.referral(ctx.userId, 'child.read', now),
          query.status ? { status: query.status } : {},
          query.childId ? { childId: query.childId } : {},
          query.category ? { category: query.category } : {},
          query.facilityId ? { facilityId: query.facilityId } : {},
          query.awaitingApproval === 'true'
            ? { status: 'PENDING_APPROVAL', child: childScopeWhere(ctx.userId, 'referral.approve', now) }
            : {},
        ],
      };
      const [rows, total] = await Promise.all([
        db.referral.findMany({
          where,
          include: summaryInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.referral.count({ where }),
      ]);
      return {
        items: rows.map((r) => toSummary(r, r._count.amendmentImpacts)),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },

    /** Decision K: a worker's referral always waits for approval. Never from an AI output. */
    async create(
      ctx: AccessContext,
      body: CreateReferralRequest,
    ): Promise<{ result: ReferralDetail; replayed: boolean }> {
      const child = await findChildOrDeny(db, ctx, body.childId, 'referral.create');
      const linked = await sessionContext(db, child.id, body.sessionId, body.category);
      if (body.reasonCode === 'RULE_RECOMMENDATION' && !linked.referralRecommended) {
        throw AppError.unprocessable(
          'NO_RULE_RECOMMENDATION',
          'The screening result does not recommend a referral for this category.',
        );
      }
      if (body.facilityId) {
        await assertFacilityChoice(db, child.areaId, body.facilityId, { mayGoOutOfDistrict: false });
      }
      try {
        const outcome = await runIdempotent(
          db,
          {
            userId: ctx.userId,
            clientOperationId: body.clientOperationId,
            operationType: 'referral.create',
            entityType: 'referral',
            request: body,
          },
          async (tx) => {
            const id = randomUUID();
            await tx.referral.create({
              data: {
                id,
                childId: child.id,
                sessionId: body.sessionId ?? null,
                screeningResultId: linked.screeningResultId,
                origin: body.reasonCode === 'RULE_RECOMMENDATION' ? 'RULE_RECOMMENDATION' : 'WORKER_CONCERN',
                facilityId: body.facilityId ?? null,
                areaId: child.areaId,
                category: body.category ?? null,
                urgency: body.suggestedPriority,
                reasonCode: body.reasonCode,
                reasonNote: text.seal({ kind: 'referral', id, field: 'reasonNote' }, body.reasonNote),
                clientOperationId: body.clientOperationId,
                createdById: ctx.userId,
              },
            });
            await tx.referralStatusEvent.create({
              data: {
                referralId: id,
                toStatus: 'PENDING_APPROVAL',
                changedById: ctx.userId,
                actorRoleCode: await actorRoleCode(tx, ctx.userId, child.areaId, 'referral.create', at(ctx)),
                source: 'APP_USER_DIRECT',
                verificationStatus: 'VERIFIED',
                facilityId: body.facilityId ?? null,
              },
            });
            await recordAudit(tx, {
              actorUserId: ctx.userId,
              action: 'referral.created',
              entityType: 'referral',
              entityId: id,
              areaId: child.areaId,
              outcome: 'SUCCESS',
              requestId: ctx.requestId,
              details: {
                childId: child.id,
                sessionId: body.sessionId ?? null,
                category: body.category ?? null,
                reasonCode: body.reasonCode,
                suggestedPriority: body.suggestedPriority,
                facilityId: body.facilityId ?? null,
              },
            });
            return id;
          },
        );
        return { result: await this.get(ctx, outcome.entityId), replayed: outcome.replayed };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          error.meta?.modelName === 'Referral'
        ) {
          const existing = await activeDuplicate(child.id, body.sessionId ?? null, body.category ?? null);
          throw AppError.conflict(
            'REFERRAL_ALREADY_ACTIVE',
            'This child already has an active referral for this screening and category.',
            { referralId: existing?.id ?? null },
          );
        }
        throw error;
      }
    },

    approve(ctx: AccessContext, id: string, body: ApproveReferralRequest) {
      return change(ctx, id, body.expectedVersion, 'approve', async (tx, r, perms) => {
        if (!perms.has('referral.approve')) throw new DeniedAction('NOT_APPROVER');
        if (r.status !== 'PENDING_APPROVAL') throw wrongState(r.status);
        const facilityId = body.facilityId ?? r.facilityId;
        if (facilityId) {
          await assertFacilityChoice(tx, r.child.areaId, facilityId, {
            mayGoOutOfDistrict: true,
            outOfDistrictReason: body.outOfDistrictReason,
          });
        }
        return {
          data: {
            status: 'APPROVED',
            urgency: body.priority,
            approvedById: ctx.userId,
            approvedAt: at(ctx),
            facilityId,
            ...(body.outOfDistrictReason && {
              outOfDistrictReason: text.seal(
                { kind: 'referral', id, field: 'outOfDistrictReason' },
                body.outOfDistrictReason,
              ),
            }),
          },
          event: { toStatus: 'APPROVED', permission: 'referral.approve', note: body.note, facilityId },
          audit: { action: 'referral.approved', details: { priority: body.priority, facilityId } },
          notify: 'REFERRAL_APPROVED',
        };
      });
    },

    reject(ctx: AccessContext, id: string, body: ReferralReasonRequest) {
      return change(ctx, id, body.expectedVersion, 'reject', (_tx, r, perms) => {
        if (!perms.has('referral.approve')) throw new DeniedAction('NOT_APPROVER');
        if (r.status !== 'PENDING_APPROVAL') throw wrongState(r.status);
        return Promise.resolve({
          data: { status: 'REJECTED' },
          event: { toStatus: 'REJECTED', permission: 'referral.approve', reason: body.reason },
          audit: { action: 'referral.rejected', details: {} },
          notify: 'REFERRAL_REJECTED',
        });
      });
    },

    changeFacility(ctx: AccessContext, id: string, body: ChangeFacilityRequest) {
      return change(ctx, id, body.expectedVersion, 'change_facility', async (tx, r, perms) => {
        const actions = referralActions(r, perms, ctx.userId, 0);
        if (!actions.changeFacility) {
          if (!BEFORE_ISSUE.includes(r.status)) throw wrongState(r.status);
          throw new DeniedAction('NOT_ALLOWED_TO_CHANGE_FACILITY');
        }
        const approver = perms.has('referral.approve');
        await assertFacilityChoice(tx, r.child.areaId, body.facilityId, {
          mayGoOutOfDistrict: approver,
          outOfDistrictReason: body.outOfDistrictReason,
        });
        return {
          data: {
            facilityId: body.facilityId,
            outOfDistrictReason: text.seal(
              { kind: 'referral', id, field: 'outOfDistrictReason' },
              body.outOfDistrictReason ?? null,
            ),
          },
          // Facility assignment is history too: an event without a status change.
          event: {
            toStatus: r.status,
            permission: approver ? 'referral.approve' : 'referral.create',
            facilityId: body.facilityId,
          },
          audit: {
            action: 'referral.facility_assigned',
            details: { from: r.facilityId, to: body.facilityId },
          },
        };
      });
    },

    /**
     * Decision M: REFERRAL_DATA_SHARING consent is verified at the moment data leaves the
     * programme and recorded on the referral. Missing / withdrawn -> 403 CONSENT_REQUIRED (audited).
     */
    issue(ctx: AccessContext, id: string, body: IssueReferralRequest) {
      return change(ctx, id, body.expectedVersion, 'issue', async (tx, r, perms) => {
        const creator = r.createdById === ctx.userId && perms.has('referral.create');
        const permission: PermissionCode | null = perms.has('referral.approve')
          ? 'referral.approve'
          : perms.has('referral.update')
            ? 'referral.update'
            : creator
              ? 'referral.create'
              : null;
        if (!permission) throw new DeniedAction('NOT_ALLOWED_TO_ISSUE');
        if (r.status !== 'APPROVED') throw wrongState(r.status);
        if (!r.facilityId) {
          throw AppError.unprocessable(
            'FACILITY_REQUIRED',
            'Choose the facility before issuing the referral.',
          );
        }
        // Approved choices stay valid only while the facility is still active and verified.
        const facility = await tx.facility.findUniqueOrThrow({ where: { id: r.facilityId } });
        if (!isSelectable(facility)) {
          throw AppError.unprocessable(
            'FACILITY_NOT_AVAILABLE',
            'The chosen facility is no longer active, verified or accepting referrals. Choose another.',
          );
        }
        const consents = await assertConsentPermits(
          tx,
          { ...ctx, auditDb: db },
          r.childId,
          'REFERRAL_SHARING',
          permission === 'referral.create' ? 'referral.create' : 'child.read',
          consentPolicy,
        );
        const consentId = consents.REFERRAL_DATA_SHARING;
        const now = at(ctx);
        return {
          data: { status: 'ISSUED', issuedAt: now, sharingConsentId: consentId, consentVerifiedAt: now },
          event: { toStatus: 'ISSUED', permission, facilityId: r.facilityId },
          audit: {
            action: 'referral.issued',
            details: {
              facilityId: r.facilityId,
              consentId,
              consentPurpose: 'REFERRAL_DATA_SHARING',
              consentVerified: true,
            },
          },
          notify: 'REFERRAL_ISSUED',
        };
      });
    },

    /**
     * Tracking after issue (decision O): acknowledgement, appointment, visit, treatment, follow-up
     * needed. Entered by a medical officer or supervisor from a facility call or document
     * (VERIFIED) or from the family's account (UNVERIFIED, shown as "reported, not verified").
     * A recorded visit never implies treatment; nothing here closes the referral.
     */
    track(ctx: AccessContext, id: string, body: ReferralTrackingRequest) {
      return change(ctx, id, body.expectedVersion, 'track', (_tx, r, perms) => {
        const permission = trackingPermission(perms);
        if (!permission) throw new DeniedAction('NOT_ALLOWED_TO_TRACK');
        if (!(TRACKING_NEXT[r.status] ?? []).includes(body.toStatus)) throw wrongState(r.status);
        const now = at(ctx);
        const issuedAt = r.issuedAt!;
        const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : undefined;
        if (effectiveAt && (effectiveAt.getTime() > now.getTime() + 5 * 60_000 || effectiveAt < issuedAt)) {
          throw AppError.unprocessable(
            'INVALID_EFFECTIVE_TIME',
            'The time must be after the referral was issued and not in the future.',
          );
        }
        const appointmentAt = body.appointmentAt ? new Date(body.appointmentAt) : undefined;
        if (appointmentAt && appointmentAt < issuedAt) {
          throw AppError.unprocessable(
            'INVALID_APPOINTMENT_TIME',
            'The appointment cannot be before the referral was issued.',
          );
        }
        const notify: NotificationType =
          body.toStatus === 'ACKNOWLEDGED'
            ? 'REFERRAL_ACKNOWLEDGED'
            : body.toStatus === 'APPOINTMENT_SCHEDULED'
              ? 'REFERRAL_APPOINTMENT_SCHEDULED'
              : 'REFERRAL_STATUS_CHANGED';
        return Promise.resolve({
          data: { status: body.toStatus, ...(appointmentAt && { appointmentAt }) },
          event: {
            toStatus: body.toStatus,
            permission,
            source: body.source,
            effectiveAt,
            note: body.note,
            facilityId: r.facilityId,
          },
          audit: {
            action: 'referral.status_tracked',
            details: {
              to: body.toStatus,
              source: body.source,
              verified: body.source !== 'GUARDIAN_REPORTED',
            },
          },
          notify,
        });
      });
    },

    /** Decision R: closure needs a reason, a visit outcome state and no open follow-up of the referral. */
    close(ctx: AccessContext, id: string, body: ReferralCloseRequest) {
      return change(ctx, id, body.expectedVersion, 'close', async (tx, r, perms) => {
        const permission = trackingPermission(perms);
        if (!permission) throw new DeniedAction('NOT_ALLOWED_TO_CLOSE');
        if (!CLOSABLE.includes(r.status)) throw wrongState(r.status);
        const open = await tx.followUp.count({
          where: { referralId: id, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'MISSED'] } },
        });
        if (open > 0) {
          throw AppError.conflict(
            'OPEN_FOLLOW_UPS',
            'Complete or cancel the open follow-ups of this referral before closing it.',
            { openFollowUps: open },
          );
        }
        const notify: NotificationType = 'REFERRAL_STATUS_CHANGED';
        return {
          data: { status: 'CLOSED', closedAt: at(ctx) },
          event: { toStatus: 'CLOSED', permission, reason: body.reason },
          audit: { action: 'referral.closed', details: {} },
          notify,
        };
      });
    },

    /**
     * Decision J: reverts ONLY the latest tracking update (entered by mistake), with a reason. The
     * mistaken event stays in the history; a new correction event points to it.
     */
    correct(ctx: AccessContext, id: string, body: ReferralCorrectionRequest) {
      return change(ctx, id, body.expectedVersion, 'correct', async (tx, r, perms) => {
        const permission = trackingPermission(perms);
        if (!permission) throw new DeniedAction('NOT_ALLOWED_TO_CORRECT');
        const latest = await tx.referralStatusEvent.findFirst({
          where: { referralId: id },
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        });
        const back = latest?.fromStatus ?? null;
        const correctable =
          latest !== null &&
          back !== null &&
          latest.id === body.eventId &&
          latest.correctsEventId === null &&
          !BEFORE_ISSUE.includes(back) &&
          (TRACKING_STATUSES as readonly string[]).includes(latest.toStatus) &&
          latest.toStatus === r.status;
        if (!correctable) {
          throw AppError.conflict(
            'NOT_CORRECTABLE',
            'Only the latest tracking update (after issue) can be corrected.',
          );
        }
        return {
          data: { status: back },
          event: {
            toStatus: back,
            permission,
            reason: body.reason,
            correctsEventId: latest.id,
            facilityId: r.facilityId,
          },
          audit: { action: 'referral.status_corrected', details: { correctedEventId: latest.id, to: back } },
        };
      });
    },

    cancel(ctx: AccessContext, id: string, body: ReferralReasonRequest) {
      return change(ctx, id, body.expectedVersion, 'cancel', (_tx, r, perms) => {
        if (FINAL.includes(r.status)) throw wrongState(r.status);
        if (!referralActions(r, perms, ctx.userId, 0).cancel) throw new DeniedAction('NOT_ALLOWED_TO_CANCEL');
        const permission: PermissionCode = perms.has('referral.approve')
          ? 'referral.approve'
          : perms.has('referral.update')
            ? 'referral.update'
            : 'referral.create';
        return Promise.resolve({
          data: { status: 'CANCELLED' },
          event: { toStatus: 'CANCELLED', permission, reason: body.reason },
          audit: { action: 'referral.cancelled', details: {} },
        });
      });
    },

    /** Step 6G (G9): confirms the referral was reviewed after the screening was amended. */
    async reassess(ctx: AccessContext, id: string, impactId: string): Promise<ReferralDetail> {
      await assertInScopeOrDeny(db, ctx, 'referral', id, 'child.read');
      const r = await db.referral.findUniqueOrThrow({
        where: { id },
        include: { child: { select: { areaId: true } } },
      });
      const perms = await permissionsOverArea(db, ctx.userId, r.child.areaId, at(ctx));
      if (!perms.has('referral.approve') && !perms.has('screening.review')) {
        throw await denied(ctx, id, r.child.areaId, 'reassess', 'NOT_REVIEWER');
      }
      await db.$transaction(async (tx) => {
        const updated = await tx.screeningAmendmentReferralImpact.updateMany({
          where: { id: impactId, referralId: id, reassessmentStatus: 'PENDING' },
          data: { reassessmentStatus: 'REASSESSED', reassessedById: ctx.userId, reassessedAt: at(ctx) },
        });
        if (updated.count === 0) {
          throw AppError.conflict(
            'REASSESSMENT_NOT_PENDING',
            'This flag does not exist or was already handled.',
          );
        }
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: 'referral.reassessed_after_amendment',
          entityType: 'referral',
          entityId: id,
          areaId: r.child.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: { impactId },
        });
      });
      return loadDetail(ctx, id);
    },
  };
}
