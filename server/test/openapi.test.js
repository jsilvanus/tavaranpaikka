import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openapiSpec } from '../src/openapi.js';

describe('OpenAPI Specification and Documentation', () => {
  const fakeDb = {
    query: async () => ({ rows: [{ id: 'test-org-id', slug: 'riihimaki', name: 'Riihimäki' }] }),
  };
  const fakeStorage = {
    putObject: async () => {},
    getObject: async () => null,
    deleteObject: async () => {},
  };
  const config = {
    port: 3000,
    nodeEnv: 'test',
    logLevel: 'silent',
    authMode: 'dev',
    defaultOrganizationSlug: 'riihimaki',
    baseUrl: 'http://localhost:3000',
    basePath: '',
    trustProxy: false,
    sessionSecret: 'test-secret',
    reporterHashSecret: 'test-hash-secret',
  };

  const app = createApp({
    // @ts-ignore
    db: fakeDb,
    config,
    // @ts-ignore
    storage: fakeStorage,
  });

  it('serves OpenAPI 3.1 specification at GET /api/openapi.json', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('Tavaranpaikka API');
    expect(res.body.paths).toBeDefined();
    expect(res.body.paths['/api/items']).toBeDefined();
    expect(res.body.paths['/api/storages']).toBeDefined();
    expect(res.body.paths['/api/public/codes/{code}']).toBeDefined();
    expect(res.body.components.schemas.Item).toBeDefined();
    expect(res.body.components.schemas.StorageSummary).toBeDefined();
  });

  it('serves OpenAPI YAML at GET /api/openapi.yaml', async () => {
    const res = await request(app).get('/api/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/yaml/);
    expect(res.text).toContain('openapi: 3.1.0');
    expect(res.text).toContain('title: Tavaranpaikka API');
  });

  it('serves interactive documentation UI at GET /api/docs', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('@scalar/api-reference');
    expect(res.text).toContain('Tavaranpaikka API Reference');
  });

  it('validates that all $ref pointers in the specification resolve', () => {
    const jsonStr = JSON.stringify(openapiSpec);
    const refMatches = jsonStr.match(/"\$ref":\s*"([^"]+)"/g) || [];
    const refs = refMatches.map((m) => m.replace(/"\$ref":\s*"/, '').replace(/"$/, ''));

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      if (ref.startsWith('#/')) {
        const parts = ref.slice(2).split('/');
        let cur = openapiSpec;
        for (const p of parts) {
          cur = cur?.[p];
        }
        expect(cur, `Expected $ref ${ref} to resolve`).toBeDefined();
      }
    }
  });
});
