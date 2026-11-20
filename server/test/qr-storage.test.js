import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createStorage as createObjectStorage } from '../src/storage.js';

describe('storage view via its QR code', () => {
  let db;
  let app;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tavaranpaikka-qrstorage-'));
    db = createDb('pg-mem');
    await runMigrations(db);
    const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'dev', LOCAL_STORAGE_DIR: tmpDir });
    app = createApp({ db, config, storage: createObjectStorage({ driver: 'local', localDir: tmpDir }) });
  });

  afterEach(async () => {
    await db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('is public for storage codes only, while the plain storage view needs login', async () => {
    const st = await request(app).post('/api/storages').send({ name: 'Testivarasto', kind: 'room' });
    const place = await request(app).post('/api/places').send({ storageId: st.body.id, name: 'Hylly' });
    const storageCode = (await request(app).post('/api/codes').send({ kind: 'storage', targetId: st.body.id })).body.code;
    const placeCode = (await request(app).post('/api/codes').send({ kind: 'place', targetId: place.body.id })).body.code;

    const ok = await request(app).get(`/api/public/codes/${storageCode}/storage`).set('X-Dev-Role', 'none');
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Testivarasto');
    expect(ok.body.places).toHaveLength(1);

    // place codes must not expose the whole storage
    const placeRes = await request(app).get(`/api/public/codes/${placeCode}/storage`).set('X-Dev-Role', 'none');
    expect(placeRes.status).toBe(404);

    // bogus code
    const bogus = await request(app).get('/api/public/codes/NOPE/storage').set('X-Dev-Role', 'none');
    expect(bogus.status).toBe(404);

    // plain view still requires login
    const plain = await request(app).get(`/api/public/storages/${st.body.id}`).set('X-Dev-Role', 'none');
    expect(plain.status).toBe(401);
  });
});
