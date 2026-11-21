import {
  parseCalendarDate,
  type registerChildRequestSchema,
  type updateChildRequestSchema,
  type ChildDetailResponse,
  type ChildListQuery,
  type ChildListResponse,
  type DuplicateChildDetails,
  type RegistrationAreaQuery,
  type RegistrationAreasResponse,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../utils/AppError';
import { runIdempotent } from '../../utils/idempotency';
import type { PiiCrypto } from '../../utils/piiCrypto';
import {
  areaScopeWhere,
  childScopeWhere,
  findChildOrDeny,
  type AccessContext,
} from '../access-control/accessScope';
import { recordAudit } from '../audit/audit.service';
import { checkGuardianLinks, createGuardianLinks, type TxContext } from '../guardians/guardianLinking';
import { resolveBirthDate, toDbDate, type ResolvedBirthDate } from './birthDate';
import { childDetailSelect, childSummarySelect, toChildDetail, toChildSummary } from './childDto';
import { namesLookSimilar } from './nameMatching';

type RegisterChildBody = z.output<typeof registerChildRequestSchema>;
type UpdateChildBody = z.output<typeof updateChildRequestSchema>;

const SORTS: Record<ChildListQuery['sort'], Prisma.ChildOrderByWithRelationInput> = {
  fullName: { fullName: 'asc' },
  '-fullName': { fullName: 'desc' },
  dateOfBirth: { dateOfBirth: 'asc' },
  '-dateOfBirth': { dateOfBirth: 'desc' },
  createdAt: { createdAt: 'asc' },
  '-createdAt': { createdAt: 'desc' },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;
/** Exact dates closer than this are "close" for duplicate warnings; estimated ones use a year. */
const EXACT_DOB_WINDOW_DAYS = 31;
const ESTIMATED_DOB_WINDOW_DAYS = 366;
const MAX_DUPLICATE_CANDIDATES = 5;
const MAX_REGISTRATION_AREAS = 200;

/** Start of a calendar day in India, as an instant. */
function indiaDayStart(isoDate: string, field: string): Date {
  const date = parseCalendarDate(isoDate);
  if (!date) throw AppError.unprocessable('INVALID_DATE', `${field} is not a valid calendar date`, { field });
  return new Date(toDbDate(date).getTime() - IST_OFFSET_MS);
}

export interface ChildrenServiceDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
}

export function createChildrenService({ db, pii }: ChildrenServiceDependencies) {
  const txContext = (ctx: AccessContext): TxContext => ({ ...ctx, at: ctx.at ?? new Date(), auditDb: db });

  async function loadDetail(childId: string): Promise<ChildDetailResponse> {
    const row = await db.child.findUniqueOrThrow({ where: { id: childId }, select: childDetailSelect });
    return { child: toChildDetail(row, pii) };
  }

  /**
   * Possible duplicates among children the worker can ALREADY read (decision G). Never searches
   * outside the worker's scope, so a warning can never reveal another area's child.
   *  - SIMILAR_NAME_AND_BIRTH: same registration area, similar name, close date of birth;
   *  - SHARED_GUARDIAN: linked to a chosen existing guardian or a guardian with the same phone
   *    number, born within about a month (possible duplicate or twin).
   */
  async function findDuplicateCandidates(
    tx: Prisma.TransactionClient,
    ctx: TxContext,
    input: {
      fullName: string;
      birth: ResolvedBirthDate;
      areaId: string;
      existingGuardianIds: string[];
      phoneHashes: string[];
    },
  ): Promise<DuplicateChildDetails['candidates']> {
    const scope = childScopeWhere(ctx.userId, 'child.read', ctx.at);
    const dob = input.birth.value.getTime();
    const wide = ESTIMATED_DOB_WINDOW_DAYS * DAY_MS;
    const near = EXACT_DOB_WINDOW_DAYS * DAY_MS;

    const byName = await tx.child.findMany({
      where: {
        AND: [
          scope,
          { areaId: input.areaId },
          { dateOfBirth: { gte: new Date(dob - wide), lte: new Date(dob + wide) } },
        ],
      },
      select: childSummarySelect,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const guardianFilters: Prisma.GuardianWhereInput[] = [];
    if (input.existingGuardianIds.length) guardianFilters.push({ id: { in: input.existingGuardianIds } });
    if (input.phoneHashes.length) guardianFilters.push({ phoneLookupHash: { in: input.phoneHashes } });
    const byGuardian = guardianFilters.length
      ? await tx.child.findMany({
          where: {
            AND: [
              scope,
              { dateOfBirth: { gte: new Date(dob - near), lte: new Date(dob + near) } },
              { guardians: { some: { endedAt: null, guardian: { deletedAt: null, OR: guardianFilters } } } },
            ],
          },
          select: childSummarySelect,
          take: 50,
        })
      : [];

    const candidates = new Map<string, DuplicateChildDetails['candidates'][number]>();
    const add = (row: (typeof byName)[number], reason: 'SIMILAR_NAME_AND_BIRTH' | 'SHARED_GUARDIAN') => {
      const existing = candidates.get(row.id);
      if (existing) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        return;
      }
      const summary = toChildSummary(row);
      candidates.set(row.id, {
        id: summary.id,
        fullName: summary.fullName,
        dateOfBirth: summary.dateOfBirth,
        dobIsEstimated: summary.dobIsEstimated,
        areaName: summary.areaName,
        areaNameHi: summary.areaNameHi,
        reasons: [reason],
      });
    };

    for (const row of byName) {
      const window = input.birth.isEstimated || row.dobIsEstimated ? wide : near;
      if (
        Math.abs(row.dateOfBirth.getTime() - dob) <= window &&
        namesLookSimilar(row.fullName, input.fullName)
      ) {
        add(row, 'SIMILAR_NAME_AND_BIRTH');
      }
    }
    for (const row of byGuardian) add(row, 'SHARED_GUARDIAN');
    return [...candidates.values()].slice(0, MAX_DUPLICATE_CANDIDATES);
  }

  return {
    /**
     * The scope filter is applied in the database query, so pagination, the total count,
     * search and sorting only ever see in-scope children. Caller filters are ANDed with the
     * scope and can only narrow it.
     */
    async list(ctx: AccessContext, query: ChildListQuery): Promise<ChildListResponse> {
      const registered: Prisma.DateTimeFilter = {};
      if (query.registeredFrom) registered.gte = indiaDayStart(query.registeredFrom, 'registeredFrom');
      if (query.registeredTo) {
        registered.lt = new Date(indiaDayStart(query.registeredTo, 'registeredTo').getTime() + DAY_MS);
      }
      const where: Prisma.ChildWhereInput = {
        AND: [
          childScopeWhere(ctx.userId, 'child.read', ctx.at),
          query.search ? { fullName: { contains: query.search.normalize('NFC'), mode: 'insensitive' } } : {},
          query.areaId ? { area: { ancestorLinks: { some: { ancestorId: query.areaId } } } } : {},
          query.registeredFrom || query.registeredTo ? { createdAt: registered } : {},
        ],
      };
      const [rows, total] = await Promise.all([
        db.child.findMany({
          where,
          select: childSummarySelect,
          // `id` as tie-breaker keeps pages stable.
          orderBy: [SORTS[query.sort], { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.child.count({ where }),
      ]);
      return { items: rows.map(toChildSummary), page: query.page, pageSize: query.pageSize, total };
    },

    /** Profile with current guardians. Out of scope or unknown -> 404 (audited). Views are audited. */
    async get(ctx: AccessContext, childId: string): Promise<ChildDetailResponse> {
      await findChildOrDeny(db, ctx, childId, 'child.read');
      const detail = await loadDetail(childId);
      await recordAudit(db, {
        actorUserId: ctx.userId,
        action: 'child.viewed',
        entityType: 'child',
        entityId: childId,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
      });
      return detail;
    },

    /** Active areas the user may register children in (registration level, in child.create scope). */
    async registrationAreas(
      ctx: AccessContext,
      query: RegistrationAreaQuery,
    ): Promise<RegistrationAreasResponse> {
      const rows = await db.area.findMany({
        where: {
          AND: [
            { isActive: true, level: { allowsChildRegistration: true, isActive: true } },
            areaScopeWhere(ctx.userId, 'child.create', ctx.at),
            query.search
              ? {
                  OR: [
                    { nameEn: { contains: query.search, mode: 'insensitive' } },
                    { nameHi: { contains: query.search.normalize('NFC'), mode: 'insensitive' } },
                  ],
                }
              : {},
          ],
        },
        select: {
          id: true,
          nameEn: true,
          nameHi: true,
          level: { select: { nameEn: true, nameHi: true } },
          parent: { select: { nameEn: true, nameHi: true } },
        },
        orderBy: [{ nameEn: 'asc' }, { id: 'asc' }],
        take: MAX_REGISTRATION_AREAS + 1,
      });
      return {
        items: rows.slice(0, MAX_REGISTRATION_AREAS).map((row) => ({
          id: row.id,
          nameEn: row.nameEn,
          nameHi: row.nameHi,
          levelNameEn: row.level.nameEn,
          levelNameHi: row.level.nameHi,
          parentNameEn: row.parent?.nameEn ?? null,
          parentNameHi: row.parent?.nameHi ?? null,
        })),
        truncated: rows.length > MAX_REGISTRATION_AREAS,
      };
    },

    /**
     * Registers a child with 1-4 guardian links in ONE transaction (all or nothing).
     * Creator, timestamps and status come from the server. See docs/api/children.md.
     */
    async register(
      ctx: AccessContext,
      body: RegisterChildBody,
    ): Promise<{ result: ChildDetailResponse; replayed: boolean }> {
      const tctx = txContext(ctx);
      const birth = resolveBirthDate(body, tctx.at);

      // Area: active, registration level, inside the user's child.create scope. One answer for
      // "does not exist", "not allowed" and "not a registration area" (no area probing).
      const area = await db.area.findFirst({
        where: {
          id: body.areaId,
          isActive: true,
          level: { allowsChildRegistration: true, isActive: true },
          ...areaScopeWhere(ctx.userId, 'child.create', tctx.at),
        },
        select: { id: true },
      });
      if (!area) {
        await recordAudit(db, {
          actorUserId: ctx.userId,
          action: 'child.registration_denied',
          entityType: 'child',
          outcome: 'DENIED',
          requestId: ctx.requestId,
          details: { reason: 'AREA_NOT_ALLOWED', areaId: body.areaId },
        });
        throw AppError.forbidden('AREA_NOT_ALLOWED', 'You cannot register children in this area');
      }

      let duplicateCandidates: DuplicateChildDetails['candidates'] = [];
      try {
        const outcome = await runIdempotent(
          db,
          {
            userId: ctx.userId,
            clientOperationId: body.clientOperationId,
            operationType: 'child.register',
            entityType: 'child',
            request: body,
          },
          async (tx) => {
            // Registrations in one area are serialised, so two simultaneous submissions of the
            // same child cannot both pass the duplicate check.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`child-registration:${area.id}`}, 0))`;

            const phoneHashes = body.guardians.flatMap((g) =>
              g.newGuardian?.phone ? [pii.phoneLookupHash(g.newGuardian.phone)] : [],
            );
            const existingGuardianIds = body.guardians.flatMap((g) =>
              g.existingGuardianId ? [g.existingGuardianId] : [],
            );
            // Guardians first: an out-of-scope guardian id must be refused before anything else.
            await checkGuardianLinks(tx, tctx, null, body.guardians, 'child.create', pii);

            duplicateCandidates = await findDuplicateCandidates(tx, tctx, {
              fullName: body.fullName,
              birth,
              areaId: area.id,
              existingGuardianIds,
              phoneHashes,
            });
            if (duplicateCandidates.length > 0 && !body.confirmNotDuplicate) {
              const details: DuplicateChildDetails = { candidates: duplicateCandidates };
              throw AppError.conflict(
                'POSSIBLE_DUPLICATE',
                'This child may already be registered. Check the list, or confirm this is a different child.',
                details,
              );
            }

            const child = await tx.child.create({
              data: {
                areaId: area.id,
                fullName: body.fullName,
                dateOfBirth: birth.value,
                dobIsEstimated: birth.isEstimated,
                sexAtBirth: body.sexAtBirth ?? 'NOT_RECORDED',
                createdById: ctx.userId,
                createdAt: tctx.at,
              },
              select: { id: true, areaId: true },
            });
            await createGuardianLinks(tx, tctx, child, body.guardians, pii);
            await recordAudit(tx, {
              actorUserId: ctx.userId,
              action: 'child.registered',
              entityType: 'child',
              entityId: child.id,
              areaId: child.areaId,
              outcome: 'SUCCESS',
              requestId: ctx.requestId,
              details: {
                guardianCount: body.guardians.length,
                dobIsEstimated: birth.isEstimated,
                ...(duplicateCandidates.length > 0 && {
                  duplicateOverride: true,
                  candidateIds: duplicateCandidates.map((c) => c.id),
                }),
              },
            });
            return child.id;
          },
        );
        // A replay re-checks access: the worker may have lost the area since the first submission.
        if (outcome.replayed) await findChildOrDeny(db, ctx, outcome.entityId, 'child.create');
        return { result: await loadDetail(outcome.entityId), replayed: outcome.replayed };
      } catch (error) {
        if (error instanceof AppError && error.code === 'POSSIBLE_DUPLICATE') {
          // Written after the rollback, so the warning itself is on record. IDs only.
          await recordAudit(db, {
            actorUserId: ctx.userId,
            action: 'child.duplicate_warning',
            entityType: 'child',
            areaId: area.id,
            outcome: 'FAILED',
            requestId: ctx.requestId,
            details: { candidateIds: duplicateCandidates.map((c) => c.id) },
          });
        }
        throw error;
      }
    },

    /**
     * Corrects name, date of birth or sex at birth. The area cannot change here (decision O).
     * Optimistic concurrency (decision R): `expectedUpdatedAt` must match, otherwise 409.
     */
    async update(ctx: AccessContext, childId: string, body: UpdateChildBody): Promise<ChildDetailResponse> {
      const at = ctx.at ?? new Date();
      const child = await findChildOrDeny(db, ctx, childId, 'child.update');
      if (child.updatedAt.getTime() !== new Date(body.expectedUpdatedAt).getTime()) {
        throw staleRecord();
      }

      const data: Prisma.ChildUpdateManyMutationInput = {};
      const changed: string[] = [];
      if (body.fullName !== undefined && body.fullName !== child.fullName) {
        data.fullName = body.fullName;
        changed.push('fullName');
      }
      if (body.dateOfBirth !== undefined || body.ageEstimate !== undefined) {
        const birth = resolveBirthDate(body, at);
        if (
          birth.value.getTime() !== child.dateOfBirth.getTime() ||
          birth.isEstimated !== child.dobIsEstimated
        ) {
          data.dateOfBirth = birth.value;
          data.dobIsEstimated = birth.isEstimated;
          changed.push('dateOfBirth');
        }
      }
      if (body.sexAtBirth !== undefined && body.sexAtBirth !== child.sexAtBirth) {
        data.sexAtBirth = body.sexAtBirth;
        changed.push('sexAtBirth');
      }
      if (changed.length === 0) return loadDetail(childId);

      await db.$transaction(async (tx) => {
        const { count } = await tx.child.updateMany({
          where: { id: childId, updatedAt: child.updatedAt, deletedAt: null },
          data,
        });
        if (count === 0) throw staleRecord();
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: 'child.updated',
          entityType: 'child',
          entityId: childId,
          areaId: child.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          // Field names only - never the old or new name or date.
          details: { fields: changed },
        });
      }, TX_OPTIONS);
      return loadDetail(childId);
    },
  };
}

export function staleRecord(): AppError {
  return AppError.conflict(
    'STALE_RECORD',
    'This record was changed by someone else. Reload it and make your change again.',
  );
}
