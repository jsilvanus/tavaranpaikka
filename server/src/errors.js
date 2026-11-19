/**
 * Application error with HTTP status and machine-readable code.
 */
export class AppError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code
   * @param {string} message
   */
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * @param {string} message
 * @param {string} [code]
 */
export function badRequest(message, code = 'BAD_REQUEST') {
  return new AppError(400, code, message);
}

/**
 * @param {string} [message]
 * @param {string} [code]
 */
export function unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
  return new AppError(401, code, message);
}

/**
 * @param {string} [message]
 * @param {string} [code]
 */
export function forbidden(message = 'Insufficient permissions', code = 'FORBIDDEN') {
  return new AppError(403, code, message);
}

/**
 * @param {string} [message]
 * @param {string} [code]
 */
export function notFound(message = 'Resource not found', code = 'NOT_FOUND') {
  return new AppError(404, code, message);
}

/**
 * @param {string} message
 * @param {string} [code]
 */
export function conflict(message, code = 'CONFLICT') {
  return new AppError(409, code, message);
}

/**
 * @param {string} [message]
 * @param {string} [code]
 */
export function tooManyRequests(message = 'Too many requests', code = 'RATE_LIMITED') {
  return new AppError(429, code, message);
}
