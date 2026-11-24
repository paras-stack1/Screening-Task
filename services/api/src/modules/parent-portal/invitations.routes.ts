import {
  createParentInvitationRequestSchema,
  revokeParentInvitationRequestSchema,
  type CreateParentInvitationRequest,
  type RevokeParentInvitationRequest,
} from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import type { ChildrenRouterDependencies } from '../children/children.routes';
import { createInvitationService, type ParentPortalSettings } from './invitations.service';

const guardianParams = z.strictObject({ guardianId: z.uuid() });
const invitationParams = z.strictObject({ guardianId: z.uuid(), invitationId: z.uuid() });
type GuardianParams = z.infer<typeof guardianParams>;
type InvitationParams = z.infer<typeof invitationParams>;

export interface InvitationsRouterDependencies extends ChildrenRouterDependencies {
  parentPortal: ParentPortalSettings;
}

/**
 * /api/v1/guardians/:guardianId/invitations (Step 8 Parent Portal, stage 3). Staff only.
 * GET shows the portal status (child.read); POST and revoke need guardian.invite in the area of
 * a child linked to the guardian. The token is never returned; out-of-scope guardians are 404.
 */
export function createGuardianInvitationsRouter(deps: InvitationsRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  const requirePermission = createRequirePermission(deps);
  const service = createInvitationService(deps);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response): AccessContext => ({
    userId: getAuth(res).userId,
    requestId: getRequestId(res),
    at: now(),
  });

  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get(
    '/',
    requirePermission('child.read'),
    validate({ params: guardianParams }),
    async (_req, res) => {
      const { guardianId } = getValidated<GuardianParams>(res, 'params');
      res.json({ portal: await service.status(ctx(res), guardianId) });
    },
  );

  router.post(
    '/',
    requirePermission('guardian.invite'),
    validate({ params: guardianParams, body: createParentInvitationRequestSchema }),
    async (_req, res) => {
      const { guardianId } = getValidated<GuardianParams>(res, 'params');
      const body = getValidated<CreateParentInvitationRequest>(res, 'body');
      res.status(201).json({ portal: await service.create(ctx(res), guardianId, body) });
    },
  );

  router.post(
    '/:invitationId/revoke',
    requirePermission('guardian.invite'),
    validate({ params: invitationParams, body: revokeParentInvitationRequestSchema }),
    async (_req, res) => {
      const { guardianId, invitationId } = getValidated<InvitationParams>(res, 'params');
      const body = getValidated<RevokeParentInvitationRequest>(res, 'body');
      res.json({ portal: await service.revoke(ctx(res), guardianId, invitationId, body) });
    },
  );

  return router;
}
