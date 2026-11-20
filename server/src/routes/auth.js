import express from 'express';
import * as oidc from 'openid-client';
import { getBasePath } from '../config.js';
import { AppError } from '../errors.js';
import {
  mapGroupsToOrgRoles,
  OIDC_STATE_COOKIE,
  ORG_COOKIE,
  ROLE_RANK,
  SESSION_COOKIE,
  signToken,
  verifyToken,
} from '../middleware/auth.js';
import { getCookie } from '../middleware/context.js';

/**
 * Sync signed-in OIDC user and group-derived memberships into PostgreSQL across all
 * existing organizations. Unknown organization slugs are ignored (must already exist).
 * Preserves any manual memberships while updating/pruning source='oidc' memberships.
 * @param {import('../db.js').DbClient} db
 * @param {Record<string, 'member' | 'keeper' | 'admin'>} slugRoles
 * @param {{ sub: string, name: string, email: string }} user
 * @returns {Promise<Record<string, 'member' | 'keeper' | 'admin'>>}
 */
async function syncOidcUserAndMemberships(db, slugRoles, user) {
  await db.query(
    `INSERT INTO users (sub, display_name, email, last_seen_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (sub) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           last_seen_at = CURRENT_TIMESTAMP`,
    [user.sub, user.name, user.email]
  );

  const orgsRes = await db.query('SELECT id, slug FROM organizations');
  /** @type {Record<string, 'member' | 'keeper' | 'admin'>} */
  const oidcOrgRoles = {};
  for (const row of orgsRes.rows) {
    const role = slugRoles[row.slug];
    if (role && ROLE_RANK[role]) {
      oidcOrgRoles[row.id] = role;
    }
  }

  const existingRes = await db.query(
    `SELECT organization_id, role, source FROM memberships WHERE user_sub = $1`,
    [user.sub]
  );

  /** @type {Record<string, 'member' | 'keeper' | 'admin'>} */
  const manualRoles = {};
  /** @type {Set<string>} */
  const existingOidcOrgIds = new Set();

  for (const row of existingRes.rows) {
    if (row.source === 'manual') {
      const cur = manualRoles[row.organization_id];
      if (!cur || ROLE_RANK[row.role] > ROLE_RANK[cur]) {
        manualRoles[row.organization_id] = row.role;
      }
    } else if (row.source === 'oidc') {
      existingOidcOrgIds.add(row.organization_id);
    }
  }

  for (const [orgId, role] of Object.entries(oidcOrgRoles)) {
    if (!manualRoles[orgId]) {
      await db.query(
        `INSERT INTO memberships (user_sub, organization_id, role, source)
         VALUES ($1, $2, $3, 'oidc')
         ON CONFLICT (user_sub, organization_id) DO UPDATE
           SET role = EXCLUDED.role, source = 'oidc'`,
        [user.sub, orgId, role]
      );
    }
  }

  for (const orgId of existingOidcOrgIds) {
    if (!oidcOrgRoles[orgId] && !manualRoles[orgId]) {
      await db.query(
        `DELETE FROM memberships
         WHERE user_sub = $1 AND organization_id = $2 AND source = 'oidc'`,
        [user.sub, orgId]
      );
    }
  }

  /** @type {Record<string, 'member' | 'keeper' | 'admin'>} */
  const effectiveOrgRoles = { ...oidcOrgRoles };
  for (const [orgId, role] of Object.entries(manualRoles)) {
    const cur = effectiveOrgRoles[orgId];
    if (!cur || ROLE_RANK[role] > ROLE_RANK[cur]) {
      effectiveOrgRoles[orgId] = role;
    }
  }
  return effectiveOrgRoles;
}

function safeReturnTo(val, basePath = '') {
  if (typeof val === 'string' && val.startsWith('/') && !val.startsWith('//') && !val.startsWith('/\\')) {
    if (!basePath || val === basePath || val.startsWith(`${basePath}/`)) {
      return val;
    }
    return `${basePath}${val}`;
  }
  return `${basePath}/storages`;
}

/**
 * Create OIDC / dev auth router mounted at /api/auth.
 * @param {{
 *   db: import('../db.js').DbClient,
 *   config: import('../config.js').AppConfig,
 *   discoverOidc?: (issuer: string, clientId: string, clientSecret: string) => Promise<any>
 * }} deps
 * @returns {import('express').Router}
 */
export function createAuthRouter({ db, config, discoverOidc }) {
  const router = express.Router();
  const isProd = config.nodeEnv === 'production';
  const isHttps = config.baseUrl.startsWith('https://');
  const basePath = config.basePath ?? getBasePath(config.baseUrl);
  const cookiePath = basePath || '/';

  /** @type {Promise<any> | null} */
  let oidcConfigPromise = null;
  function getOidcConfig() {
    if (!config.oidcIssuer || !config.oidcClientId) {
      throw new AppError(500, 'OIDC_NOT_CONFIGURED', 'OIDC_ISSUER and OIDC_CLIENT_ID are required');
    }
    if (!oidcConfigPromise) {
      if (discoverOidc) {
        oidcConfigPromise = discoverOidc(
          config.oidcIssuer,
          config.oidcClientId,
          config.oidcClientSecret
        );
      } else {
        oidcConfigPromise = oidc.discovery(
          new URL(config.oidcIssuer),
          config.oidcClientId,
          config.oidcClientSecret,
          oidc.ClientSecretPost(config.oidcClientSecret)
        );
      }
    }
    return oidcConfigPromise;
  }

  router.get('/login', async (req, res, next) => {
    try {
      const returnTo = safeReturnTo(req.query.returnTo, basePath);

      if (config.authMode === 'dev' && !isProd) {
        return res.redirect(returnTo);
      }

      const oidcConfig = await getOidcConfig();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();

      const stateToken = signToken(
        {
          codeVerifier,
          state,
          nonce,
          returnTo,
          exp: Date.now() + 10 * 60_000,
        },
        config.sessionSecret
      );

      res.cookie(OIDC_STATE_COOKIE, stateToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        maxAge: 10 * 60_000,
        path: cookiePath,
      });

      const redirectTo = oidc.buildAuthorizationUrl(oidcConfig, {
        redirect_uri: config.oidcRedirectUri,
        scope: config.oidcScopes,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      });

      res.redirect(redirectTo.href);
    } catch (err) {
      oidcConfigPromise = null;
      next(err);
    }
  });

  router.get('/callback', async (req, res, next) => {
    try {
      if (config.authMode !== 'oidc') {
        return res.redirect(`${basePath}/storages`);
      }

      const stateCookie = getCookie(req.headers.cookie, OIDC_STATE_COOKIE);
      const saved = verifyToken(stateCookie, config.sessionSecret);
      res.clearCookie(OIDC_STATE_COOKIE, { path: cookiePath });

      if (!saved || !saved.codeVerifier || !saved.state) {
        return next(new AppError(400, 'INVALID_OIDC_STATE', 'Missing or expired OIDC login state'));
      }

      const oidcConfig = await getOidcConfig();
      const currentUrl = new URL(req.originalUrl, config.baseUrl);
      const tokens = await oidc.authorizationCodeGrant(oidcConfig, currentUrl, {
        pkceCodeVerifier: saved.codeVerifier,
        expectedState: saved.state,
        expectedNonce: saved.nonce,
      });

      const claims = /** @type {Record<string, any>} */ (tokens.claims() || {});
      const sub = String(claims.sub || '');
      if (!sub) {
        return next(new AppError(401, 'INVALID_OIDC_CLAIMS', 'Missing sub claim'));
      }

      const name = String(claims.name || claims.preferred_username || claims.email || sub);
      const email = String(claims.email || '');
      const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];

      const slugRoles = mapGroupsToOrgRoles(
        groups,
        config.oidcGroupRoleMap,
        config.defaultOrganizationSlug
      );
      // @ts-ignore
      const ctx = req.ctx;
      const orgRoles = await syncOidcUserAndMemberships(db, slugRoles, {
        sub,
        name,
        email,
      });

      const orgIds = Object.keys(orgRoles);
      if (orgIds.length === 0) {
        return next(new AppError(403, 'NO_ROLE', 'No matching role or membership for user'));
      }

      const defaultActiveOrgId = orgRoles[ctx.organizationId] ? ctx.organizationId : orgIds[0];

      const sessionToken = signToken(
        {
          sub,
          name,
          email,
          role: orgRoles[defaultActiveOrgId],
          orgRoles,
          exp: Date.now() + 8 * 3600_000,
        },
        config.sessionSecret
      );

      res.cookie(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        maxAge: 8 * 3600_000,
        path: cookiePath,
      });

      const currentOrgCookie = getCookie(req.headers.cookie, ORG_COOKIE);
      if (currentOrgCookie && !orgRoles[currentOrgCookie]) {
        res.clearCookie(ORG_COOKIE, { path: cookiePath });
      }

      res.redirect(safeReturnTo(saved.returnTo, basePath));
    } catch (err) {
      next(err);
    }
  });

  router.post('/switch-org', async (req, res, next) => {
    try {
      // @ts-ignore
      const user = req.user;
      if (!user) {
        return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
      }

      const rawOrgId =
        typeof req.body?.organizationId === 'string' ? req.body.organizationId.trim() : '';
      const rawSlug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';
      if (!rawOrgId && !rawSlug) {
        return next(new AppError(400, 'INVALID_INPUT', 'organizationId or slug is required'));
      }

      let targetOrgId = rawOrgId;
      if (!targetOrgId && rawSlug) {
        const slugRes = await db.query('SELECT id FROM organizations WHERE slug = $1', [rawSlug]);
        if (slugRes.rows.length > 0) {
          targetOrgId = slugRes.rows[0].id;
        }
      }

      if (!targetOrgId) {
        return next(new AppError(404, 'NOT_FOUND', 'Organization not found'));
      }

      if (config.authMode === 'oidc' && user.orgRoles) {
        if (!ROLE_RANK[user.orgRoles[targetOrgId]]) {
          return next(new AppError(403, 'FORBIDDEN', 'No access to organization'));
        }
      } else {
        const orgRes = await db.query('SELECT id FROM organizations WHERE id = $1', [targetOrgId]);
        if (orgRes.rows.length === 0) {
          return next(new AppError(404, 'NOT_FOUND', 'Organization not found'));
        }
      }

      res.cookie(ORG_COOKIE, targetOrgId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        maxAge: 8 * 3600_000,
        path: cookiePath,
      });

      res.json({ ok: true, organizationId: targetOrgId });
    } catch (err) {
      next(err);
    }
  });

  const handleLogout = async (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: cookiePath });
    res.clearCookie(OIDC_STATE_COOKIE, { path: cookiePath });
    res.clearCookie(ORG_COOKIE, { path: cookiePath });
    if (config.authMode === 'oidc' && config.oidcIssuer) {
      try {
        const oidcConfig = await getOidcConfig();
        const endUrl = oidc.buildEndSessionUrl(oidcConfig, {
          post_logout_redirect_uri: config.baseUrl,
        });
        return res.redirect(endUrl.href);
      } catch {
        // Fallback to local redirect
      }
    }
    res.redirect(`${basePath}/storages`);
  };

  router.get('/logout', handleLogout);
  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: cookiePath });
    res.clearCookie(OIDC_STATE_COOKIE, { path: cookiePath });
    res.clearCookie(ORG_COOKIE, { path: cookiePath });
    res.json({ ok: true });
  });

  return router;
}
