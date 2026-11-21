import {
  addGuardianLinkRequestSchema,
  childListQuerySchema,
  endGuardianLinkRequestSchema,
  guardianLinkListQuerySchema,
  registerChildRequestSchema,
  registrationAreaQuerySchema,
  updateChildRequestSchema,
  updateGuardianLinkRequestSchema,
  type ChildListQuery,
  type EndGuardianLinkRequest,
  type GuardianLinkListQuery,
  type RegistrationAreaQuery,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth, type AuthenticateDependencies } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { PiiCrypto } from '../../utils/piiCrypto';
import type { AccessContext } from '../access-control/accessScope';
import { createGuardiansService } from '../guardians/guardians.service';
import { createChildrenService } from './children.service';

export interface ChildrenRouterDependencies extends AuthenticateDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  /** Shared per-user limiter for all child-data routes (decision Q). */
  dataRateLimit: RequestHandler;
}

const childParams = z.strictObject({ childId: z.uuid() });
const linkParams = z.strictObject({ childId: z.uuid(), relationshipId: z.uuid() });
type ChildParams = z.infer<typeof childParams>;
type LinkParams = z.infer<typeof linkParams>;

/**
 * /api/v1/children. Every route: authenticate -> per-user rate limit -> route permission ->
 * record-level area scope in the service (the route permission alone never grants a record).
 * See docs/api/children.md.
 */
export function createChildrenRouter(deps: ChildrenRouterDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticate(deps);
  const requirePermission = createRequirePermission(deps);
  const children = createChildrenService(deps);
  const guardians = createGuardiansService(deps);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response): AccessContext => ({
    userId: getAuth(res).userId,
    requestId: getRequestId(res),
    at: now(),
  });

  router.use(authenticate(), deps.dataRateLimit);

  // ------------------------------------------------------------------- children
  router.get(
    '/',
    requirePermission('child.read'),
    validate({ query: childListQuerySchema }),
    async (_req, res) => {
      res.json(await children.list(ctx(res), getValidated<ChildListQuery>(res, 'query')));
    },
  );

  router.post(
    '/',
    requirePermission('child.create'),
    validate({ body: registerChildRequestSchema }),
    async (_req, res) => {
      const body = getValidated<z.output<typeof registerChildRequestSchema>>(res, 'body');
      const { result, replayed } = await children.register(ctx(res), body);
      if (replayed) res.setHeader('Idempotent-Replay', 'true');
      res.status(201).json(result);
    },
  );

  // Registered before '/:childId' so the literal path is never parsed as an id.
  router.get(
    '/registration-areas',
    requirePermission('child.create'),
    validate({ query: registrationAreaQuerySchema }),
    async (_req, res) => {
      res.json(await children.registrationAreas(ctx(res), getValidated<RegistrationAreaQuery>(res, 'query')));
    },
  );

  router.get(
    '/:childId',
    requirePermission('child.read'),
    validate({ params: childParams }),
    async (_req, res) => {
      const { childId } = getValidated<ChildParams>(res, 'params');
      res.json(await children.get(ctx(res), childId));
    },
  );

  router.patch(
    '/:childId',
    requirePermission('child.update'),
    validate({ params: childParams, body: updateChildRequestSchema }),
    async (_req, res) => {
      const { childId } = getValidated<ChildParams>(res, 'params');
      const body = getValidated<z.output<typeof updateChildRequestSchema>>(res, 'body');
      res.json(await children.update(ctx(res), childId, body));
    },
  );

  // ------------------------------------------------------------- guardian links
  router.get(
    '/:childId/guardians',
    requirePermission('child.read'),
    validate({ params: childParams, query: guardianLinkListQuerySchema }),
    async (_req, res) => {
      const { childId } = getValidated<ChildParams>(res, 'params');
      const { includeEnded } = getValidated<GuardianLinkListQuery>(res, 'query');
      res.json(await guardians.listLinks(ctx(res), childId, includeEnded));
    },
  );

  router.post(
    '/:childId/guardians',
    requirePermission('child.update'),
    validate({ params: childParams, body: addGuardianLinkRequestSchema }),
    async (_req, res) => {
      const { childId } = getValidated<ChildParams>(res, 'params');
      const body = getValidated<z.output<typeof addGuardianLinkRequestSchema>>(res, 'body');
      const { result, replayed } = await guardians.addLink(ctx(res), childId, body);
      if (replayed) res.setHeader('Idempotent-Replay', 'true');
      res.status(201).json(result);
    },
  );

  router.patch(
    '/:childId/guardians/:relationshipId',
    requirePermission('child.update'),
    validate({ params: linkParams, body: updateGuardianLinkRequestSchema }),
    async (_req, res) => {
      const { childId, relationshipId } = getValidated<LinkParams>(res, 'params');
      const body = getValidated<z.output<typeof updateGuardianLinkRequestSchema>>(res, 'body');
      res.json(await guardians.updateLink(ctx(res), childId, relationshipId, body));
    },
  );

  router.delete(
    '/:childId/guardians/:relationshipId',
    requirePermission('child.update'),
    validate({ params: linkParams, body: endGuardianLinkRequestSchema }),
    async (_req, res) => {
      const { childId, relationshipId } = getValidated<LinkParams>(res, 'params');
      const { reason } = getValidated<EndGuardianLinkRequest>(res, 'body');
      res.json(await guardians.endLink(ctx(res), childId, relationshipId, reason));
    },
  );

  return router;
}
