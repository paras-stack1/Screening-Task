import {
  assignmentListQuerySchema,
  changeUserStatusRequestSchema,
  createAssignmentRequestSchema,
  createUserRequestSchema,
  endAssignmentRequestSchema,
  reasonRequestSchema,
  userListQuerySchema,
  type AssignmentListQuery,
  type ChangeUserStatusRequest,
  type CreateAssignmentRequest,
  type CreateUserRequest,
  type EndAssignmentRequest,
  type ReasonRequest,
  type UserListQuery,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth, type AuthenticateDependencies } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import { createAssignmentsService, type AdminContext } from './assignments.service';
import { createUsersService } from './users.service';

export interface AdminRouterDependencies extends AuthenticateDependencies {
  db: PrismaClient;
}

const userParams = z.strictObject({ userId: z.uuid() });
const assignmentParams = z.strictObject({ assignmentId: z.uuid() });

function context(res: Response, now: () => Date): AdminContext {
  return { actorId: getAuth(res).userId, requestId: getRequestId(res), at: now() };
}

/** /api/v1/users - account administration. Gate: user.manage; target scope checked per call. */
export function createUsersRouter(deps: AdminRouterDependencies): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const service = createUsersService(deps.db);
  router.use(createAuthenticate(deps)(), createRequirePermission(deps)('user.manage'));

  router.get('/', validate({ query: userListQuerySchema }), async (_req, res) => {
    res.json(await service.list(context(res, now), getValidated<UserListQuery>(res, 'query')));
  });

  router.post('/', validate({ body: createUserRequestSchema }), async (_req, res) => {
    res
      .status(201)
      .json(await service.create(context(res, now), getValidated<CreateUserRequest>(res, 'body')));
  });

  router.get('/:userId', validate({ params: userParams }), async (_req, res) => {
    const { userId } = getValidated<z.infer<typeof userParams>>(res, 'params');
    res.json(await service.get(context(res, now), userId));
  });

  router.post(
    '/:userId/status',
    validate({ params: userParams, body: changeUserStatusRequestSchema }),
    async (_req, res) => {
      const { userId } = getValidated<z.infer<typeof userParams>>(res, 'params');
      const body = getValidated<ChangeUserStatusRequest>(res, 'body');
      res.json({ user: await service.changeStatus(context(res, now), userId, body) });
    },
  );

  router.post(
    '/:userId/reset-password',
    validate({ params: userParams, body: reasonRequestSchema }),
    async (_req, res) => {
      const { userId } = getValidated<z.infer<typeof userParams>>(res, 'params');
      const { reason } = getValidated<ReasonRequest>(res, 'body');
      res.json(await service.resetPassword(context(res, now), userId, reason));
    },
  );

  router.post(
    '/:userId/revoke-sessions',
    validate({ params: userParams, body: reasonRequestSchema }),
    async (_req, res) => {
      const { userId } = getValidated<z.infer<typeof userParams>>(res, 'params');
      const { reason } = getValidated<ReasonRequest>(res, 'body');
      await service.revokeSessions(context(res, now), userId, reason);
      res.status(204).end();
    },
  );

  return router;
}

/** /api/v1/assignments - gate: assignment.manage; area, role subset and self rules per call. */
export function createAssignmentsRouter(deps: AdminRouterDependencies): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const service = createAssignmentsService(deps.db);
  router.use(createAuthenticate(deps)(), createRequirePermission(deps)('assignment.manage'));

  router.get('/', validate({ query: assignmentListQuerySchema }), async (_req, res) => {
    res.json(await service.list(context(res, now), getValidated<AssignmentListQuery>(res, 'query')));
  });

  router.post('/', validate({ body: createAssignmentRequestSchema }), async (_req, res) => {
    const body = getValidated<CreateAssignmentRequest>(res, 'body');
    res.status(201).json({ assignment: await service.create(context(res, now), body) });
  });

  router.post(
    '/:assignmentId/end',
    validate({ params: assignmentParams, body: endAssignmentRequestSchema }),
    async (_req, res) => {
      const { assignmentId } = getValidated<z.infer<typeof assignmentParams>>(res, 'params');
      const body = getValidated<EndAssignmentRequest>(res, 'body');
      res.json({ assignment: await service.end(context(res, now), assignmentId, body) });
    },
  );

  for (const action of ['suspend', 'reactivate', 'revoke'] as const) {
    router.post(
      `/:assignmentId/${action}`,
      validate({ params: assignmentParams, body: reasonRequestSchema }),
      async (_req, res) => {
        const { assignmentId } = getValidated<z.infer<typeof assignmentParams>>(res, 'params');
        const { reason } = getValidated<ReasonRequest>(res, 'body');
        res.json({ assignment: await service.changeStatus(context(res, now), assignmentId, action, reason) });
      },
    );
  }

  return router;
}

/** /api/v1/roles - reference data for assignment forms. Gate: assignment.manage. */
export function createRolesRouter(deps: AdminRouterDependencies): Router {
  const router = Router();
  const service = createUsersService(deps.db);
  router.use(createAuthenticate(deps)(), createRequirePermission(deps)('assignment.manage'));
  router.get('/', async (_req, res) => {
    res.json(await service.listRoles());
  });
  return router;
}
