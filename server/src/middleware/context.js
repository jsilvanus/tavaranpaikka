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
  let cachedOrgId = null;

  return async (req, _res, next) => {
    try {
      if (!cachedOrgId) {
        const res = await db.query('SELECT id FROM organizations WHERE slug = $1', [
          config.defaultOrganizationSlug,
        ]);
        if (res.rows.length === 0) {
          throw new Error(`Default organization "${config.defaultOrganizationSlug}" not found`);
        }
        cachedOrgId = res.rows[0].id;
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
        organizationId: cachedOrgId,
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
