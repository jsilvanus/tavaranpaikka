import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createDb } from '../src/db.js';
import { loadConfig, getBasePath } from '../src/config.js';
import { runMigrations } from '../src/migrate.js';
import { createApp, injectBasePathIntoHtml } from '../src/app.js';
import { createStorage } from '../src/storage.js';

describe('Subpath (basePath) support', () => {
  let db;
  let app;

  beforeAll(async () => {
    db = createDb('pg-mem');
    await runMigrations(db);
    const config = loadConfig({
      NODE_ENV: 'development',
      AUTH_MODE: 'dev',
      DEV_DEFAULT_ROLE: 'keeper',
      BASE_URL: 'https://kehitys.riihimaenseurakunta.fi/tavara/',
      SEED_DEMO_DATA: 'false',
    });
    const storage = createStorage(config);
    app = createApp({ db, config, storage });
  });

  afterAll(async () => {
    await db?.close();
  });

  it('derives basePath and oidcRedirectUri from BASE_URL', () => {
    expect(getBasePath('http://localhost:3000')).toBe('');
    expect(getBasePath('http://localhost:3000/')).toBe('');
    expect(getBasePath('https://kehitys.riihimaenseurakunta.fi/tavara')).toBe('/tavara');
    expect(getBasePath('https://kehitys.riihimaenseurakunta.fi/tavara/')).toBe('/tavara');

    const cfg = loadConfig({
      NODE_ENV: 'development',
      BASE_URL: 'https://kehitys.riihimaenseurakunta.fi/tavara/',
    });
    expect(cfg.baseUrl).toBe('https://kehitys.riihimaenseurakunta.fi/tavara');
    expect(cfg.basePath).toBe('/tavara');
    expect(cfg.oidcRedirectUri).toBe(
      'https://kehitys.riihimaenseurakunta.fi/tavara/api/auth/callback'
    );
  });

  it('keeps /health at root and mounts /health, /metrics, and /api under basePath', async () => {
    const rootHealth = await request(app).get('/health');
    expect(rootHealth.status).toBe(200);
    expect(rootHealth.body).toEqual({ ok: true, db: 'ok' });

    const subHealth = await request(app).get('/tavara/health');
    expect(subHealth.status).toBe(200);
    expect(subHealth.body).toEqual({ ok: true, db: 'ok' });

    const subMetrics = await request(app).get('/tavara/metrics');
    expect(subMetrics.status).toBe(200);
    expect(subMetrics.text).toContain('tavaranpaikka_http_requests_total');

    const subApi = await request(app).get('/tavara/api/public/storages');
    expect(subApi.status).toBe(200);
    expect(Array.isArray(subApi.body)).toBe(true);

    const rootApi = await request(app).get('/api/public/storages');
    expect(rootApi.status).toBe(404);
  });

  it('prefixes auth redirects with basePath in dev mode', async () => {
    const defaultLogin = await request(app).get('/tavara/api/auth/login');
    expect(defaultLogin.status).toBe(302);
    expect(defaultLogin.headers.location).toBe('/tavara/storages');

    const relReturn = await request(app).get('/tavara/api/auth/login?returnTo=/manage');
    expect(relReturn.status).toBe(302);
    expect(relReturn.headers.location).toBe('/tavara/manage');

    const fullReturn = await request(app).get('/tavara/api/auth/login?returnTo=/tavara/print');
    expect(fullReturn.status).toBe(302);
    expect(fullReturn.headers.location).toBe('/tavara/print');

    const logoutGet = await request(app).get('/tavara/api/auth/logout');
    expect(logoutGet.status).toBe(302);
    expect(logoutGet.headers.location).toBe('/tavara/storages');
  });

  it('injects <base> and window.__BASE_PATH__ into HTML', () => {
    const html = '<!doctype html><html><head><title>App</title></head><body></body></html>';
    const withSubpath = injectBasePathIntoHtml(html, '/tavara');
    expect(withSubpath).toContain('<base href="/tavara/" />');
    expect(withSubpath).toContain('window.__BASE_PATH__ = "/tavara";');

    const withRoot = injectBasePathIntoHtml(html, '');
    expect(withRoot).toContain('<base href="/" />');
    expect(withRoot).toContain('window.__BASE_PATH__ = "";');
  });
});
