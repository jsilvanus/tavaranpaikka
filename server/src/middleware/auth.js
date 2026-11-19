import { forbidden, unauthorized } from '../errors.js';
import { getCookie } from './context.js';

const ROLE_RANK = {
  member: 1,
  keeper: 2,
  admin: 3,
};

/**
 * @typedef {'member' | 'keeper' | 'admin'} UserRole
 * @typedef {{ sub: string, name: string, role: UserRole }} AuthUser
 */

/**
 * Populate req.user in AUTH_MODE=dev.
 * Reads X-Dev-Role header or dev_role cookie.
 * Defaults to 'keeper' when NODE_ENV !== 'production', or null if 'none'/'anonymous'.
 * @param {import('../config.js').AppConfig} config
 * @returns {import('express').RequestHandler}
 */
export function authMiddleware(config) {
  return (req, _res, next) => {
    if (config.authMode === 'dev' && config.nodeEnv !== 'production') {
      const headerRole =
        typeof req.headers['x-dev-role'] === 'string'
          ? req.headers['x-dev-role'].trim().toLowerCase()
          : '';
      const cookieRole = (getCookie(req.headers.cookie, 'dev_role') || '').trim().toLowerCase();
      const rawRole = headerRole || cookieRole || 'keeper';

      if (rawRole === 'none' || rawRole === 'anonymous') {
        // @ts-ignore - augmented request property
        req.user = null;
      } else if (rawRole === 'member' || rawRole === 'keeper' || rawRole === 'admin') {
        // @ts-ignore - augmented request property
        req.user = {
          sub: 'dev-user',
          name: 'Dev Keeper',
          role: rawRole,
        };
      } else {
        // @ts-ignore - augmented request property
        req.user = null;
      }
    } else {
      // @ts-ignore - augmented request property
      req.user = null;
    }
    next();
  };
}

/**
 * Enforce minimum role: member < keeper < admin.
 * @param {UserRole} minRole
 * @returns {import('express').RequestHandler}
 */
export function requireRole(minRole) {
  const minRank = ROLE_RANK[minRole];
  return (req, _res, next) => {
    // @ts-ignore - augmented request property
    const user = req.user;
    if (!user) {
      return next(unauthorized());
    }
    const userRank = ROLE_RANK[user.role] || 0;
    if (userRank < minRank) {
      return next(forbidden());
    }
    next();
  };
}
