import express from 'express';
import * as oidc from 'openid-client';
import { AppError } from '../errors.js';
import {
  mapGroupsToRole,
  OIDC_STATE_COOKIE,
  ROLE_RANK,
  SESSION_COOKIE,
  signToken,
  verifyToken,
} from '../middleware/auth.js';
import { getCookie } from '../middleware/context.js';

/**
 * Sync signed-in OIDC user and group-derived membership into PostgreSQL.
 * Preserves any manual memberships while updating source='oidc' memberships.
 * @param {import('../db.js').DbClient} db
 * @param {string} organizationId
 * @param {{ sub: string, name: string, email: string, role: 'member' | 'keeper' | 'admin' | null }} user
 * @returns {Promise<'member' | 'keeper' | 'admin' | null>}
 */
async function syncOidcUserAndMembership(db, organizationId, user) {
  await db.query(
    `INSERT INTO users (sub, display_name, email, last_seen_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (sub) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           last_seen_at = CURRENT_TIMESTAMP`,
    [user.sub, user.name, user.email]
  );

  // Check manual memberships (preserved even if OIDC groups change)
  const manualRes = await db.query(
    `SELECT role FROM memberships
     WHERE user_sub = $1 AND organization_id = $2 AND source = 'manual'`,
    [user.sub, organizationId]
  );

  if (manualRes.rows.length === 0) {
    if (user.role) {
      await db.query(
        `INSERT INTO memberships (user_sub, organization_id, role, source)
         VALUES ($1, $2, $3, 'oidc')
         ON CONFLICT (user_sub, organization_id) DO UPDATE
           SET role = EXCLUDED.role, source = 'oidc'`,
        [user.sub, organizationId, user.role]
      );
    } else {
      await db.query(
        `DELETE FROM memberships
         WHERE user_sub = $1 AND organization_id = $2 AND source = 'oidc'`,
        [user.sub, organizationId]
      );
    }
  }

  let effectiveRole = user.role;
  for (const row of manualRes.rows) {
    const r = row.role;
    if (ROLE_RANK[r] && (!effectiveRole || ROLE_RANK[r] > ROLE_RANK[effectiveRole])) {
      effectiveRole = r;
    }
  }
  return effectiveRole;
}

function safeReturnTo(val) {
  if (typeof val === 'string' && val.startsWith('/') && !val.startsWith('//') && !val.startsWith('/\\')) {
    return val;
  }
  return '/storages';
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
      const returnTo = safeReturnTo(req.query.returnTo);

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
        path: '/',
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
        return res.redirect('/storages');
      }

      const stateCookie = getCookie(req.headers.cookie, OIDC_STATE_COOKIE);
      const saved = verifyToken(stateCookie, config.sessionSecret);
      res.clearCookie(OIDC_STATE_COOKIE, { path: '/' });

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

      const mappedRole = mapGroupsToRole(groups, config.oidcGroupRoleMap);
      // @ts-ignore
      const ctx = req.ctx;
      const effectiveRole = await syncOidcUserAndMembership(db, ctx.organizationId, {
        sub,
        name,
        email,
        role: mappedRole,
      });

      if (!effectiveRole) {
        return next(new AppError(403, 'NO_ROLE', 'No matching role or membership for user'));
      }

      const sessionToken = signToken(
        {
          sub,
          name,
          email,
          role: effectiveRole,
          exp: Date.now() + 8 * 3600_000,
        },
        config.sessionSecret
      );

      res.cookie(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        maxAge: 8 * 3600_000,
        path: '/',
      });

      res.redirect(safeReturnTo(saved.returnTo));
    } catch (err) {
      next(err);
    }
  });

  const handleLogout = async (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(OIDC_STATE_COOKIE, { path: '/' });
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
    res.redirect('/storages');
  };

  router.get('/logout', handleLogout);
  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(OIDC_STATE_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return router;
}
