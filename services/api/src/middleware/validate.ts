import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

interface RequestSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Validates request parts with Zod before the controller runs. A ZodError is
 * forwarded to the error handler, which returns a 400 with field details.
 * Validated values are stored on res.locals.validated (Express 5 makes req.query read-only).
 */
export function validate(schemas: RequestSchemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.validated = {
        body: schemas.body ? schemas.body.parse(req.body) : (req.body as unknown),
        params: schemas.params ? schemas.params.parse(req.params) : req.params,
        query: schemas.query ? schemas.query.parse(req.query) : req.query,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Reads a part validated by `validate()`. The caller states the type that the route's schema
 * produces (one checked cast here instead of `any` in every controller).
 */
export function getValidated<T>(res: Response, part: keyof RequestSchemas): T {
  const validated = res.locals.validated as Record<keyof RequestSchemas, unknown> | undefined;
  if (!validated) throw new Error('getValidated called on a route without validate()');
  return validated[part] as T;
}
