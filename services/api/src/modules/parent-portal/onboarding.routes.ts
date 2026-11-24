import {
  activateParentAccountRequestSchema,
  invitationTokenRequestSchema,
  verifyOtpRequestSchema,
  type ActivateParentAccountRequest,
  type InvitationTokenRequest,
  type VerifyOtpRequest,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import { AppError } from '../../utils/AppError';
import type { PiiCrypto } from '../../utils/piiCrypto';
import type { ParentPortalSettings } from './invitations.service';
import { createOnboardingService } from './onboarding.service';
import { legalDocument } from './parentLegal';

export interface OnboardingRouterDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  parentPortal: ParentPortalSettings;
  now?: () => Date;
}

export const DEFAULT_PARENT_PUBLIC_LIMITS = {
  validatePerIp: 60,
  sendOtpPerIp: 10,
  verifyOtpPerIp: 30,
  activatePerIp: 10,
};

function perIp(limit: number) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => (req.ip ? ipKeyGenerator(req.ip) : 'unknown-ip'),
    handler: (_req: Request, _res: Response, next: NextFunction) => next(AppError.tooManyRequests()),
  });
}

const languageQuery = z.strictObject({ language: z.enum(['hi', 'en']).default('hi') });

/**
 * /api/v1/parent - PUBLIC Parent Portal onboarding (Step 8, stage 4). No staff or parent access
 * token: each call is authorised by the invitation token (and, for activation, the ticket from a
 * verified code). POST bodies only, so the token never appears in a URL or access log. Every
 * route is limited per IP; the codes themselves are also limited per phone and invitation.
 */
export function createParentOnboardingRouter(deps: OnboardingRouterDependencies): Router {
  const router = Router();
  const service = createOnboardingService(deps);
  const limits = deps.parentPortal.publicRateLimits ?? DEFAULT_PARENT_PUBLIC_LIMITS;
  const ctx = (res: Response) => ({ requestId: getRequestId(res) });

  router.get('/legal', perIp(limits.validatePerIp), validate({ query: languageQuery }), (_req, res) => {
    const { language } = getValidated<z.output<typeof languageQuery>>(res, 'query');
    res.json({
      privacyNotice: legalDocument('PRIVACY_NOTICE', language),
      terms: legalDocument('TERMS', language),
    });
  });

  router.post(
    '/invitations/validate',
    perIp(limits.validatePerIp),
    validate({ body: invitationTokenRequestSchema }),
    async (_req, res) => {
      const { token } = getValidated<InvitationTokenRequest>(res, 'body');
      res.json(await service.validate(token));
    },
  );

  router.post(
    '/invitations/send-otp',
    perIp(limits.sendOtpPerIp),
    validate({ body: invitationTokenRequestSchema }),
    async (_req, res) => {
      const { token } = getValidated<InvitationTokenRequest>(res, 'body');
      res.json(await service.sendOtp(ctx(res), token));
    },
  );

  router.post(
    '/invitations/verify-otp',
    perIp(limits.verifyOtpPerIp),
    validate({ body: verifyOtpRequestSchema }),
    async (_req, res) => {
      const { token, code } = getValidated<VerifyOtpRequest>(res, 'body');
      res.json(await service.verifyOtp(ctx(res), token, code));
    },
  );

  router.post(
    '/activate',
    perIp(limits.activatePerIp),
    validate({ body: activateParentAccountRequestSchema }),
    async (_req, res) => {
      const body = getValidated<ActivateParentAccountRequest>(res, 'body');
      res.status(201).json(await service.activate(ctx(res), body));
    },
  );

  return router;
}
