import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Attaches a request id (reused from the client if well-formed) for log correlation. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader(HEADER, id);
  next();
}

/** Typed accessor: res.locals is untyped (`any`) in Express. */
export function getRequestId(res: Response): string | undefined {
  const value: unknown = res.locals.requestId;
  return typeof value === 'string' ? value : undefined;
}
