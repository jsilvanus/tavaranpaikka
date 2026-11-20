import { ORG_COOKIE, ROLE_RANK } from './auth.js';

/**
 * Parse a named cookie from the Cookie header.
 * @param {string | undefined} cookieHeader
 * @param {string} name
 * @returns {string | null}
 */
export function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * Resolve organizationId and locale onto req.ctx.
 * @param {import('../db.js').DbClient} db
 * @param {import('../config.js').AppConfig} config
 * @returns {import('express').RequestHandler}
 */
export function contextMiddleware(db, config) {
  /** @type {string | null} */
  let cachedDefaultOrgId = null;

  return async (req, _res, next) => {
    try {
      if (!cachedDefaultOrgId) {
        const res = await db.query('SELECT id FROM organizations WHERE slug = $1', [
          config.defaultOrganizationSlug,
        ]);
        if (res.rows.length === 0) {
          throw new Error(`Default organization "${config.defaultOrganizationSlug}" not found`);
        }
        cachedDefaultOrgId = res.rows[0].id;
      }

      const cookieOrgId = getCookie(req.headers.cookie, ORG_COOKIE);
      const headerOrgId =
        typeof req.headers['x-organization-id'] === 'string'
          ? req.headers['x-organization-id'].trim()
          : '';
      const headerOrgSlug =
        typeof req.headers['x-organization-slug'] === 'string'
          ? req.headers['x-organization-slug'].trim()
          : '';
      const queryOrgSlug = typeof req.query.org === 'string' ? req.query.org.trim() : '';

      const requestedOrgId = headerOrgId || cookieOrgId || '';
      const requestedOrgSlug = headerOrgSlug || queryOrgSlug || '';

      let organizationId = cachedDefaultOrgId;
      // @ts-ignore - augmented request property
      const user = req.user || null;

      if (user && user.orgRoles && typeof user.orgRoles === 'object') {
        let candidateId = requestedOrgId;
        if (!candidateId && requestedOrgSlug) {
          const slugRes = await db.query('SELECT id FROM organizations WHERE slug = $1', [
            requestedOrgSlug,
          ]);
          if (slugRes.rows.length > 0) {
            candidateId = slugRes.rows[0].id;
          }
        }

        if (candidateId && ROLE_RANK[user.orgRoles[candidateId]]) {
          organizationId = candidateId;
        } else if (ROLE_RANK[user.orgRoles[cachedDefaultOrgId]]) {
          organizationId = cachedDefaultOrgId;
        } else {
          const firstValid = Object.keys(user.orgRoles).find((id) => ROLE_RANK[user.orgRoles[id]]);
          if (firstValid) {
            organizationId = firstValid;
          }
        }
        if (ROLE_RANK[user.orgRoles[organizationId]]) {
          user.role = user.orgRoles[organizationId];
        }
      } else if (user && config.authMode === 'dev' && (requestedOrgId || requestedOrgSlug)) {
        if (requestedOrgId) {
          const idRes = await db.query('SELECT id FROM organizations WHERE id = $1', [
            requestedOrgId,
          ]);
          if (idRes.rows.length > 0) {
            organizationId = idRes.rows[0].id;
          }
        } else if (requestedOrgSlug) {
          const slugRes = await db.query('SELECT id FROM organizations WHERE slug = $1', [
            requestedOrgSlug,
          ]);
          if (slugRes.rows.length > 0) {
            organizationId = slugRes.rows[0].id;
          }
        }
      } else if (!user && requestedOrgSlug) {
        const slugRes = await db.query('SELECT id FROM organizations WHERE slug = $1', [
          requestedOrgSlug,
        ]);
        if (slugRes.rows.length > 0) {
          organizationId = slugRes.rows[0].id;
        }
      }

      const enabled = new Set(config.enabledLocales);
      const queryLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
      const cookieLang = getCookie(req.headers.cookie, 'locale') || '';
      const acceptLang =
        typeof req.headers['accept-language'] === 'string'
          ? req.headers['accept-language'].split(',')[0]?.split('-')[0]?.trim() || ''
          : '';

      let locale = config.defaultLocale;
      if (queryLang && enabled.has(queryLang)) {
        locale = queryLang;
      } else if (cookieLang && enabled.has(cookieLang)) {
        locale = cookieLang;
      } else if (acceptLang && enabled.has(acceptLang)) {
        locale = acceptLang;
      }

      /** @type {import('../types.js').RequestContext} */
      const ctx = {
        organizationId,
        locale,
      };
      // @ts-ignore - augmented request property
      req.ctx = ctx;
      next();
    } catch (err) {
      next(err);
    }
  };
}
