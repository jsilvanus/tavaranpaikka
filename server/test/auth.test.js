import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import {
  authMiddleware,
  mapGroupsToOrgRoles,
  mapGroupsToRole,
  ORG_COOKIE,
  requireRole,
  SESSION_COOKIE,
  signToken,
  verifyToken,
} from '../src/middleware/auth.js';
import { runMigrations } from '../src/migrate.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { createMemoryStorage } from '../src/storage.js';

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

  it('maps OIDC groups to different tenants and enforces per-tenant roles on switch-org', async () => {
    const map = {
      'parish/riihimaki': 'member',
      'parish/riihimaki/tavaranpaikka-keeper': { org: 'riihimaki', role: 'keeper' },
      'parish/hyvinkaa': { org: 'hyvinkaa', role: 'member' },
      'parish/nonexistent': { org: 'nonexistent', role: 'admin' },
    };

    const slugRoles = mapGroupsToOrgRoles(
      ['parish/riihimaki', 'parish/riihimaki/tavaranpaikka-keeper', 'parish/hyvinkaa'],
      /** @type {any} */ (map),
      'riihimaki'
    );
    expect(slugRoles).toEqual({
      riihimaki: 'keeper',
      hyvinkaa: 'member',
    });

    const db = createDb('pg-mem');
    try {
      const config = loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'oidc',
        SESSION_SECRET: 'super-secret-key',
        REPORTER_HASH_SECRET: 'super-reporter-secret',
        ORGANIZATIONS: JSON.stringify([{ slug: 'hyvinkaa', name: 'Hyvinkään seurakunta' }]),
        OIDC_GROUP_ROLE_MAP: JSON.stringify(map),
      });

      const { organizationId: riihimakiId } = await runMigrations(db, {
        defaultOrgSlug: config.defaultOrganizationSlug,
        organizations: config.organizations,
      });

      const hyvinkaaRes = await db.query("SELECT id FROM organizations WHERE slug = 'hyvinkaa'");
      const hyvinkaaId = hyvinkaaRes.rows[0].id;

      // Seed a third org that the user has no access to
      await db.query(
        `INSERT INTO organizations (id, slug, name, default_locale, locales)
         VALUES ('org-other', 'loppi', 'Lopen seurakunta', 'fi', '["fi"]'::jsonb)`
      );

      const app = createApp({
        db,
        config,
        storage: /** @type {any} */ ({
          putObject: async () => {},
          getObject: async () => null,
          deleteObject: async () => {},
        }),
      });

      const sessionToken = signToken(
        {
          sub: 'u-multi',
          name: 'Multi User',
          role: 'keeper',
          orgRoles: {
            [riihimakiId]: 'keeper',
            [hyvinkaaId]: 'member',
          },
          exp: Date.now() + 60_000,
        },
        'super-secret-key'
      );

      // Default active org is riihimaki (keeper)
      const meRes = await request(app)
        .get('/api/me')
        .set('Cookie', `${SESSION_COOKIE}=${sessionToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.organizationId).toBe(riihimakiId);
      expect(meRes.body.user.role).toBe('keeper');
      expect(meRes.body.organizations.map((o) => o.slug)).toEqual(['hyvinkaa', 'riihimaki']);

      // Keeper route allowed in riihimaki
      const storagesOk = await request(app)
        .get('/api/storages')
        .set('Cookie', `${SESSION_COOKIE}=${sessionToken}`);
      expect(storagesOk.status).toBe(200);

      // Cannot switch to org without membership
      const forbiddenSwitch = await request(app)
        .post('/api/auth/switch-org')
        .set('Cookie', `${SESSION_COOKIE}=${sessionToken}`)
        .send({ organizationId: 'org-other' });
      expect(forbiddenSwitch.status).toBe(403);

      // Switch to hyvinkaa (member)
      const switchRes = await request(app)
        .post('/api/auth/switch-org')
        .set('Cookie', `${SESSION_COOKIE}=${sessionToken}`)
        .send({ organizationId: hyvinkaaId });
      expect(switchRes.status).toBe(200);
      expect(switchRes.body.organizationId).toBe(hyvinkaaId);

      // With tp_org=hyvinkaaId, role becomes member and keeper routes return 403
      const cookies = `${SESSION_COOKIE}=${sessionToken}; ${ORG_COOKIE}=${hyvinkaaId}`;
      const meHyvinkaa = await request(app).get('/api/me').set('Cookie', cookies);
      expect(meHyvinkaa.status).toBe(200);
      expect(meHyvinkaa.body.organizationId).toBe(hyvinkaaId);
      expect(meHyvinkaa.body.user.role).toBe('member');

      const storagesForbidden = await request(app).get('/api/storages').set('Cookie', cookies);
      expect(storagesForbidden.status).toBe(403);
    } finally {
      await db.close();
    }
  });
});
