import {
  consentNoticeQuerySchema,
  recordConsentRequestSchema,
  withdrawConsentRequestSchema,
  type ConsentNoticeQuery,
  type RecordConsentRequest,
  type WithdrawConsentRequest,
} from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import type { ChildrenRouterDependencies } from '../children/children.routes';
import { createConsentService } from './consent.service';
import type { ConsentPolicySettings } from './consentPolicy';

export interface ConsentRouterDependencies extends ChildrenRouterDependencies {
  consentPolicy: ConsentPolicySettings;
}

const childParams = z.strictObject({ childId: z.uuid() });
const consentParams = z.strictObject({ childId: z.uuid(), consentId: z.uuid() });

function context(res: Response, now: () => Date): AccessContext {
  return { userId: getAuth(res).userId, requestId: getRequestId(res), at: now() };
}

/** /api/v1/consent-notices - the current notice wording to show a guardian (docs/api/consent.md). */
export function createConsentNoticesRouter(deps: ConsentRouterDependencies): Router {
  const router = Router();
  const service = createConsentService(deps);
  router.use(createAuthenticate(deps)(), deps.dataRateLimit, createRequirePermission(deps)('consent.record'));
  router.get('/', validate({ query: consentNoticeQuerySchema }), async (_req, res) => {
    res.json(await service.notices(getValidated<ConsentNoticeQuery>(res, 'query')));
  });
  return router;
}

/**
 * /api/v1/children/:childId/consents. The child (and, for withdrawal, the consent) is verified
 * against the caller's scope in the service - never trusted from the URL.
 */
export function createChildConsentsRouter(deps: ConsentRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  const requirePermission = createRequirePermission(deps);
  const service = createConsentService(deps);
  const now = deps.now ?? (() => new Date());
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get('/', requirePermission('child.read'), validate({ params: childParams }), async (_req, res) => {
    const { childId } = getValidated<z.infer<typeof childParams>>(res, 'params');
    res.json(await service.forChild(context(res, now), childId));
  });

  router.post(
    '/',
    requirePermission('consent.record'),
    validate({ params: childParams, body: recordConsentRequestSchema }),
    async (_req, res) => {
      const { childId } = getValidated<z.infer<typeof childParams>>(res, 'params');
      const body = getValidated<RecordConsentRequest>(res, 'body');
      const { result, replayed } = await service.record(context(res, now), childId, body);
      if (replayed) res.setHeader('Idempotent-Replay', 'true');
      res.status(201).json(result);
    },
  );

  router.post(
    '/:consentId/withdraw',
    requirePermission('consent.record'),
    validate({ params: consentParams, body: withdrawConsentRequestSchema }),
    async (_req, res) => {
      const { childId, consentId } = getValidated<z.infer<typeof consentParams>>(res, 'params');
      const body = getValidated<WithdrawConsentRequest>(res, 'body');
      res.json(await service.withdraw(context(res, now), childId, consentId, body));
    },
  );

  return router;
}
