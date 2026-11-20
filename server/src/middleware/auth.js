import crypto from 'node:crypto';
import { forbidden, unauthorized } from '../errors.js';
import { getCookie } from './context.js';

export const SESSION_COOKIE = 'tp_session';
export const OIDC_STATE_COOKIE = 'tp_oidc_state';
export const ORG_COOKIE = 'tp_org';

export const ROLE_RANK = {
  member: 1,
  keeper: 2,
  admin: 3,
};

/**
 * @typedef {'member' | 'keeper' | 'admin'} UserRole
 * @typedef {UserRole | { org?: string, role?: UserRole }} GroupMappingEntry
 * @typedef {{ sub: string, name: string, email?: string, role: UserRole, orgRoles?: Record<string, UserRole> }} AuthUser
 */

/**
 * Sign a JSON payload into an HMAC-SHA256 token.
 * @param {Record<string, unknown>} payload
 * @param {string} secret
 * @returns {string}
 */
export function signToken(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/**
 * Verify and decode an HMAC-SHA256 token. Returns null if invalid or expired.
 * @param {string | undefined | null} token
 * @param {string} secret
 * @returns {Record<string, any> | null}
 */
export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (parsed.exp && Date.now() > Number(parsed.exp)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Map OIDC groups array to the highest matching role per organization slug.
 * @param {string[]} groups
 * @param {Record<string, GroupMappingEntry>} groupRoleMap
 * @param {string} [defaultOrgSlug]
 * @returns {Record<string, UserRole>}
 */
export function mapGroupsToOrgRoles(groups, groupRoleMap, defaultOrgSlug = 'riihimaki') {
  /** @type {Record<string, { org: string, role: UserRole }>} */
  const normalizedMap = {};
  for (const [k, v] of Object.entries(groupRoleMap || {})) {
    const key = k.replace(/^\/+/, '');
    if (typeof v === 'string') {
      normalizedMap[key] = { org: defaultOrgSlug, role: v };
    } else if (v && typeof v === 'object' && v.org && v.role) {
      normalizedMap[key] = { org: v.org, role: v.role };
    }
  }

  /** @type {Record<string, UserRole>} */
  const result = {};
  for (const g of groups) {
    const mapped = normalizedMap[String(g).replace(/^\/+/, '')];
    if (!mapped || !ROLE_RANK[mapped.role]) continue;
    const current = result[mapped.org];
    if (!current || ROLE_RANK[mapped.role] > ROLE_RANK[current]) {
      result[mapped.org] = mapped.role;
    }
  }
  return result;
}

/**
 * Map OIDC groups array to the highest matching role.
 * @param {string[]} groups
 * @param {Record<string, GroupMappingEntry>} groupRoleMap
 * @returns {UserRole | null}
 */
export function mapGroupsToRole(groups, groupRoleMap) {
  const orgRoles = mapGroupsToOrgRoles(groups, groupRoleMap);
  /** @type {UserRole | null} */
  let best = null;
  let bestRank = 0;
  for (const role of Object.values(orgRoles)) {
    if (ROLE_RANK[role] > bestRank) {
      best = role;
      bestRank = ROLE_RANK[role];
    }
  }
  return best;
}

/**
 * Populate req.user:
 * - AUTH_MODE=dev (when NODE_ENV !== 'production'): reads X-Dev-Role header,
 *   dev_role cookie, or config.devDefaultRole (env-based free entry for dev).
 * - AUTH_MODE=oidc: verifies the signed tp_session cookie.
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
      const rawRole = headerRole || cookieRole || config.devDefaultRole || 'keeper';

      if (rawRole === 'none' || rawRole === 'anonymous') {
        // @ts-ignore - augmented request property
        req.user = null;
      } else if (rawRole === 'member' || rawRole === 'keeper' || rawRole === 'admin') {
        // @ts-ignore - augmented request property
        req.user = {
          sub: 'dev-user',
          name: `Dev (${rawRole})`,
          role: rawRole,
        };
      } else {
        // @ts-ignore - augmented request property
        req.user = null;
      }
      return next();
    }

    if (config.authMode === 'oidc') {
      const rawSession = getCookie(req.headers.cookie, SESSION_COOKIE);
      const session = verifyToken(rawSession, config.sessionSecret);
      const orgRoles =
        session && session.orgRoles && typeof session.orgRoles === 'object'
          ? session.orgRoles
          : undefined;
      const hasOrgRole = orgRoles && Object.values(orgRoles).some((r) => ROLE_RANK[r]);
      if (session && session.sub && (ROLE_RANK[session.role] || hasOrgRole)) {
        // @ts-ignore - augmented request property
        req.user = {
          sub: String(session.sub),
          name: String(session.name || session.sub),
          email: session.email ? String(session.email) : undefined,
          role: session.role,
          ...(orgRoles ? { orgRoles } : {}),
        };
        return next();
      }
    }

    // @ts-ignore - augmented request property
    req.user = null;
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
