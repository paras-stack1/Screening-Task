import { CONDUCTOR_AMENDMENT_WINDOW_MS, type ScreeningSessionResponse } from '@balswasthya/shared-contracts';
import type { Db } from '../../config/database';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { scopedWhere, type AccessContext } from '../access-control/accessScope';
import { sessionTextSealer } from './sensitiveText';
import { detailInclude, toSessionDetail, type AmendmentAccess } from './sessionDto';

/**
 * Who may amend this COMPLETED screening, decided from the database (Step 6G, decisions G3/G4):
 *  - a screening.review holder whose scope covers the child's CURRENT area: always;
 *  - the worker who conducted it, while still in scope with screening.conduct: for exactly
 *    7 x 24 hours after completion (server clock).
 * Nothing here comes from the client.
 */
export async function amendmentAccess(
  db: Db,
  ctx: AccessContext,
  session: { id: string; status: string; conductedById: string; completedAt: Date | null },
): Promise<AmendmentAccess> {
  const at = ctx.at ?? new Date();
  const inScope = async (permission: 'screening.review' | 'screening.conduct') =>
    (await db.screeningSession.count({
      where: { id: session.id, ...scopedWhere.screeningSession(ctx.userId, permission, at) },
    })) > 0;
  const isReviewer = await inScope('screening.review');
  const isConductor = session.conductedById === ctx.userId && (await inScope('screening.conduct'));
  const completed = session.status === 'COMPLETED' && session.completedAt !== null;
  const windowEnd = completed
    ? new Date(session.completedAt!.getTime() + CONDUCTOR_AMENDMENT_WINDOW_MS)
    : null;
  const conductorAllowed = completed && isConductor && at.getTime() < windowEnd!.getTime();
  return {
    canAmend: completed && (isReviewer || conductorAllowed),
    amendBasis: !completed
      ? null
      : isReviewer
        ? 'MEDICAL_OFFICER'
        : conductorAllowed
          ? 'CONDUCTOR_WITHIN_WINDOW'
          : null,
    amendableUntil: completed && isConductor ? windowEnd!.toISOString() : null,
    canReviewAmendments: isReviewer,
  };
}

/** Loads the full session (current version + amendment history) for an already-authorised caller. */
export async function loadSessionDetail(
  db: Db,
  pii: PiiCrypto,
  ctx: AccessContext,
  id: string,
): Promise<ScreeningSessionResponse> {
  const row = await db.screeningSession.findUniqueOrThrow({ where: { id }, include: detailInclude });
  const access = await amendmentAccess(db, ctx, row);
  return { session: toSessionDetail(row, ctx.userId, sessionTextSealer(pii, id), access) };
}
