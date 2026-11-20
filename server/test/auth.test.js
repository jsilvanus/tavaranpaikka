import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import {
  authMiddleware,
  mapGroupsToRole,
  requireRole,
  SESSION_COOKIE,
  signToken,
  verifyToken,
} from '../src/middleware/auth.js';
import { runMigrations } from '../src/migrate.js';
import { createAuthRouter } from '../src/routes/auth.js';

describe('Authentication (dev free-entry + OIDC)', () => {
  it('supports env-based DEV_DEFAULT_ROLE in AUTH_MODE=dev (non-production only)', async () => {
    const devConfig = loadConfig({
      NODE_ENV: 'development',
      AUTH_MODE: 'dev',
      DEV_DEFAULT_ROLE: 'admin',
    });

    const app = express();
    app.use(authMiddleware(devConfig));
    app.get('/admin-only', requireRole('admin'), (req, res) => {
      // @ts-ignore
      res.json({ user: req.user });
    });

    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');

    // Never allow dev bypass or default secrets in production
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'dev',
        DEV_DEFAULT_ROLE: 'admin',
      })
    ).toThrow('AUTH_MODE=dev is not allowed');

    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'oidc',
      })
    ).toThrow('SESSION_SECRET and REPORTER_HASH_SECRET');
  });

  it('verifies signed OIDC session cookies and rejects tampered/expired tokens', async () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      AUTH_MODE: 'oidc',
      SESSION_SECRET: 'super-secret-key',
      REPORTER_HASH_SECRET: 'super-reporter-secret',
    });

    const app = express();
    app.use(authMiddleware(config));
    app.get('/keeper', requireRole('keeper'), (req, res) => {
      // @ts-ignore
      res.json({ user: req.user });
    });

    // No cookie -> 401
    expect((await request(app).get('/keeper')).status).toBe(401);

    // Valid signed cookie -> 200
    const token = signToken(
      { sub: 'u1', name: 'Tunnus User', role: 'keeper', exp: Date.now() + 60_000 },
      'super-secret-key'
    );
    const okRes = await request(app)
      .get('/keeper')
      .set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.user.sub).toBe('u1');
    expect(okRes.body.user.role).toBe('keeper');

    // Tampered token -> 401
    expect(verifyToken(`${token}x`, 'super-secret-key')).toBeNull();
    const badRes = await request(app)
      .get('/keeper')
      .set('Cookie', `${SESSION_COOKIE}=${token}x`);
    expect(badRes.status).toBe(401);

    // Expired token -> 401
    const expired = signToken(
      { sub: 'u1', name: 'Old', role: 'admin', exp: Date.now() - 1000 },
      'super-secret-key'
    );
    expect(verifyToken(expired, 'super-secret-key')).toBeNull();
  });

  it('maps OIDC groups to highest role (normalizing optional leading slashes)', () => {
    const map = {
      '/parish/riihimaki': 'member',
      'parish/riihimaki/keeper': 'keeper',
      '/parish/riihimaki/admin': 'admin',
    };
    expect(mapGroupsToRole(['parish/riihimaki', 'parish/riihimaki/admin'], /** @type {any} */ (map))).toBe('admin');
    expect(mapGroupsToRole(['/parish/riihimaki', 'parish/riihimaki/keeper'], /** @type {any} */ (map))).toBe('keeper');
    expect(mapGroupsToRole(['unrelated'], /** @type {any} */ (map))).toBeNull();
  });

  it('redirects /api/auth/login to /storages in dev mode and clears session on logout', async () => {
    const db = createDb('pg-mem');
    await runMigrations(db);
    const config = loadConfig({ NODE_ENV: 'development', AUTH_MODE: 'dev' });

    const app = express();
    app.use('/api/auth', createAuthRouter({ db, config }));

    const loginRes = await request(app).get('/api/auth/login?returnTo=/manage');
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.location).toBe('/manage');

    const logoutRes = await request(app).post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    await db.close();
  });
});
