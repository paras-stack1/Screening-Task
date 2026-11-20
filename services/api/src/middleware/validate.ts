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
        body: schemas.body ? schemas.body.parse(req.body) : req.body,
        params: schemas.params ? schemas.params.parse(req.params) : req.params,
        query: schemas.query ? schemas.query.parse(req.query) : req.query,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
