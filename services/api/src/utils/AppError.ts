/**
 * Expected, user-facing error. Throw this from services/controllers; the global
 * error handler turns it into the standard `{ error: { code, message } }` shape.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  /** 401: missing, invalid or expired credentials. Messages must stay generic. */
  static unauthorized(code = 'UNAUTHENTICATED', message = 'Authentication required') {
    return new AppError(401, code, message);
  }

  /** 403: authenticated, but this action is not allowed. */
  static forbidden(code = 'FORBIDDEN', message = 'You do not have permission to perform this action') {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static unsupportedMediaType() {
    return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }

  static tooManyRequests() {
    return new AppError(429, 'TOO_MANY_REQUESTS', 'Too many requests. Please wait and try again.');
  }
}
