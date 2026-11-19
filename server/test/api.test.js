import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createStorage as createObjectStorage } from '../src/storage.js';

describe('API integration', () => {
  let db;
  let app;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tavaranpaikka-test-'));
    db = createDb('pg-mem');
    await runMigrations(db);
    const config = loadConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'dev',
      LOCAL_STORAGE_DIR: tmpDir,
      METRICS_BEARER_TOKEN: 'secret-metrics',
    });
    const storage = createObjectStorage({ driver: 'local', localDir: tmpDir });
    app = createApp({ db, config, storage });
  });

  afterEach(async () => {
    await db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('serves /health and protects /metrics with bearer token', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, db: 'ok' });

    const metricsUnauth = await request(app).get('/metrics');
    expect(metricsUnauth.status).toBe(401);

    const metricsAuth = await request(app)
      .get('/metrics')
      .set('Authorization', 'Bearer secret-metrics');
    expect(metricsAuth.status).toBe(200);
    expect(metricsAuth.text).toContain('tavaranpaikka_http_requests_total');
  });

  it('enforces dev auth roles on keeper endpoints', async () => {
    const anon = await request(app).get('/api/storages').set('X-Dev-Role', 'none');
    expect(anon.status).toBe(401);

    const member = await request(app).get('/api/storages').set('X-Dev-Role', 'member');
    expect(member.status).toBe(403);

    const keeper = await request(app).get('/api/storages').set('X-Dev-Role', 'keeper');
    expect(keeper.status).toBe(200);
    expect(keeper.body).toEqual([]);
  });

  it('supports full keeper CRUD, image upload, code resolution, public report + me-too voting, and summary PDF', async () => {
    // 1. Create storage
    const storageRes = await request(app)
      .post('/api/storages')
      .send({ name: 'Kappelin varasto', kind: 'room', description: 'Alakerta' });
    expect(storageRes.status).toBe(201);
    const storageId = storageRes.body.id;

    // 2. Upload image
    const pngBuf = await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 210, b: 220 } },
    })
      .png()
      .toBuffer();

    const imgRes = await request(app)
      .post(`/api/storages/${storageId}/image`)
      .attach('image', pngBuf, 'room.png');
    expect(imgRes.status).toBe(200);
    expect(imgRes.body.hasImage).toBe(true);
    expect(imgRes.body.imageUrl).toMatch(/^\/api\/files\/storages\//);

    const fileRes = await request(app).get(imgRes.body.imageUrl);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers['content-type']).toContain('image/webp');

    // 3. Create place + sub-place
    const p1Res = await request(app)
      .post('/api/places')
      .send({ storageId, name: 'Hylly A', pinX: 0.25, pinY: 0.75, pinLabel: 'Vasen hylly' });
    expect(p1Res.status).toBe(201);

    const p2Res = await request(app)
      .post('/api/places')
      .send({ storageId, parentPlaceId: p1Res.body.id, name: 'Ylätaso' });
    expect(p2Res.status).toBe(201);
    expect(p2Res.body.path).toEqual(['Hylly A', 'Ylätaso']);

    // 4. Create item and move it
    const itemRes = await request(app)
      .post('/api/items')
      .send({ placeId: p1Res.body.id, name: 'Kahvinkeitin' });
    expect(itemRes.status).toBe(201);
    const itemId = itemRes.body.id;

    const moveRes = await request(app)
      .post(`/api/items/${itemId}/move`)
      .send({ placeId: p2Res.body.id });
    expect(moveRes.status).toBe(200);
    expect(moveRes.body.placeId).toBe(p2Res.body.id);

    // 5. Issue code and resolve publicly
    const codeRes = await request(app)
      .post('/api/codes')
      .send({ kind: 'item', targetId: itemId });
    expect(codeRes.status).toBe(201);
    const code = codeRes.body.code;

    const pubCodeRes = await request(app)
      .get(`/api/public/codes/${code}`)
      .set('X-Dev-Role', 'none');
    expect(pubCodeRes.status).toBe(200);
    expect(pubCodeRes.body.kind).toBe('item');
    expect(pubCodeRes.body.item.name).toBe('Kahvinkeitin');
    expect(pubCodeRes.body.place.path).toEqual(['Hylly A', 'Ylätaso']);

    // 6. Public report + me-too deduplication + vote + keeper ack/resolve
    const rep1 = await request(app)
      .post(`/api/public/places/${p2Res.body.id}/reports`)
      .set('X-Dev-Role', 'none')
      .set('User-Agent', 'PhoneA')
      .send({ itemId, kind: 'depleted', note: 'Suodatinpussit loppu', name: 'Maija' });
    expect(rep1.status).toBe(201);
    expect(rep1.body.status).toBe('open');
    expect(rep1.body.votes).toBe(1);
    const reportId = rep1.body.id;

    // Item status updated to depleted
    const itemAfterRep = await request(app).get(`/api/items/${itemId}`);
    expect(itemAfterRep.body.status).toBe('depleted');

    // Second report of same kind on same item deduplicates ("me too")
    const rep2 = await request(app)
      .post(`/api/public/places/${p2Res.body.id}/reports`)
      .set('X-Dev-Role', 'none')
      .set('User-Agent', 'PhoneB')
      .send({ itemId, kind: 'depleted' });
    expect(rep2.status).toBe(200);
    expect(rep2.body.deduplicated).toBe(true);
    expect(rep2.body.votes).toBe(2);

    // Direct vote endpoint
    const voteRes = await request(app)
      .post(`/api/public/reports/${reportId}/vote`)
      .set('X-Dev-Role', 'none')
      .set('User-Agent', 'PhoneC');
    expect(voteRes.status).toBe(200);
    expect(voteRes.body.votes).toBe(3);

    // Keeper ack & resolve
    const ackRes = await request(app).post(`/api/reports/${reportId}/ack`);
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.status).toBe('acknowledged');

    const resolveRes = await request(app).post(`/api/reports/${reportId}/resolve`).send({});
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe('resolved');

    const itemAfterResolve = await request(app).get(`/api/items/${itemId}`);
    expect(itemAfterResolve.body.status).toBe('ok');

    // 7. Summary PDF
    const pdfRes = await request(app).get(`/api/storages/${storageId}/summary.pdf`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // 8. Void code -> public lookup returns 404
    const voidRes = await request(app).post(`/api/codes/${code}/void`);
    expect(voidRes.status).toBe(200);

    const pubAfterVoid = await request(app)
      .get(`/api/public/codes/${code}`)
      .set('X-Dev-Role', 'none');
    expect(pubAfterVoid.status).toBe(404);
  });

  it('supports lease out, return, storage visibility, and admin-only lease audit', async () => {
    const stRes = await request(app).post('/api/storages').send({ name: 'AV-varasto', kind: 'room' });
    const storageId = stRes.body.id;

    const plRes = await request(app)
      .post('/api/places')
      .send({ storageId, name: 'Kaappi 1' });
    const placeId = plRes.body.id;

    const itemRes = await request(app)
      .post('/api/items')
      .send({ placeId, name: 'Videotykki', leaseable: true });
    expect(itemRes.status).toBe(201);
    const itemId = itemRes.body.id;
    expect(itemRes.body.leaseable).toBe(true);

    // Public user leases out the item
    const leaseRes = await request(app)
      .post(`/api/public/items/${itemId}/lease`)
      .set('X-Dev-Role', 'none')
      .send({ borrowerName: 'Maija Meikäläinen' });
    expect(leaseRes.status).toBe(200);
    expect(leaseRes.body.leasedTo).toBe('Maija Meikäläinen');
    expect(leaseRes.body.leasedAt).toBeTruthy();

    // Storage summary shows who has it and when taken
    const detailRes = await request(app)
      .get(`/api/public/storages/${storageId}`)
      .set('X-Dev-Role', 'none');
    expect(detailRes.status).toBe(200);
    const foundItem = detailRes.body.places[0].items.find((i) => i.id === itemId);
    expect(foundItem.leasedTo).toBe('Maija Meikäläinen');
    expect(foundItem.leasedAt).toBeTruthy();

    // Cannot double-lease while already out
    const dupLease = await request(app)
      .post(`/api/public/items/${itemId}/lease`)
      .set('X-Dev-Role', 'none')
      .send({ borrowerName: 'Pekka' });
    expect(dupLease.status).toBe(409);

    // User returns it -> cleared from storage summary
    const retRes = await request(app)
      .post(`/api/public/items/${itemId}/return`)
      .set('X-Dev-Role', 'none');
    expect(retRes.status).toBe(200);
    expect(retRes.body.leasedTo).toBeNull();

    // Keeper cannot view admin lease history (403)
    const keeperAudit = await request(app)
      .get('/api/admin/leases')
      .set('X-Dev-Role', 'keeper');
    expect(keeperAudit.status).toBe(403);

    // Admin sees past lease history
    const adminAudit = await request(app)
      .get('/api/admin/leases')
      .set('X-Dev-Role', 'admin');
    expect(adminAudit.status).toBe(200);
    expect(adminAudit.body).toHaveLength(1);
    expect(adminAudit.body[0].borrowerName).toBe('Maija Meikäläinen');
    expect(adminAudit.body[0].returnedAt).toBeTruthy();

    // Admin updates per-tenant privacy & processor info; keeper cannot (403)
    const keeperPriv = await request(app)
      .put('/api/admin/privacy')
      .set('X-Dev-Role', 'keeper')
      .send({ controllerContact: 'tietosuoja@example.fi' });
    expect(keeperPriv.status).toBe(403);

    const adminPriv = await request(app)
      .put('/api/admin/privacy')
      .set('X-Dev-Role', 'admin')
      .send({
        controllerName: 'Riihimäen seurakunta',
        controllerContact: 'tietosuoja@riihimaenseurakunta.fi',
        leaseRetentionDays: 365,
        processors: [{ name: 'Brevo', purpose: 'Sähköposti-ilmoitukset', location: 'EU' }],
        privacyExtra: 'Erityisohje',
      });
    expect(adminPriv.status).toBe(200);

    const pubPriv = await request(app)
      .get('/api/public/privacy')
      .set('X-Dev-Role', 'none');
    expect(pubPriv.status).toBe(200);
    expect(pubPriv.body.leaseRetentionDays).toBe(365);
    expect(pubPriv.body.processors).toHaveLength(1);
    expect(pubPriv.body.processors[0].name).toBe('Brevo');

    // Retention cleanup does not delete recent (< 365d) returned lease, but deletes > 365d old returned lease
    const recentCleanup = await request(app)
      .post('/api/admin/cleanup')
      .set('X-Dev-Role', 'admin');
    expect(recentCleanup.status).toBe(200);
    expect(recentCleanup.body.deletedLeases).toBe(0);

    const oldDate = new Date(Date.now() - 400 * 86400_000).toISOString();
    await db.query('UPDATE item_leases SET returned_at = $1', [oldDate]);
    const oldCleanup = await request(app)
      .post('/api/admin/cleanup')
      .set('X-Dev-Role', 'admin');
    expect(oldCleanup.status).toBe(200);
    expect(oldCleanup.body.deletedLeases).toBe(1);
  });

  it('supports multiple storage & item images and drawn place/item/general overlays', async () => {
    const stRes = await request(app).post('/api/storages').send({ name: 'Kuvavarasto', kind: 'room' });
    const storageId = stRes.body.id;

    const plRes = await request(app).post('/api/places').send({ storageId, name: 'Hylly A' });
    const placeId = plRes.body.id;

    const itemRes = await request(app).post('/api/items').send({ placeId, name: 'Porakone' });
    const itemId = itemRes.body.id;

    const pngBuf = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 220, g: 220, b: 220 } },
    })
      .png()
      .toBuffer();

    // Upload 2 storage images and 1 item image
    const sImg1 = await request(app)
      .post(`/api/storages/${storageId}/images`)
      .attach('image', pngBuf, 'room1.png')
      .field('caption', 'Yleiskuva');
    expect(sImg1.status).toBe(201);

    const sImg2 = await request(app)
      .post(`/api/storages/${storageId}/images`)
      .attach('image', pngBuf, 'room2.png')
      .field('caption', 'Lähikuva');
    expect(sImg2.status).toBe(201);

    const iImg = await request(app)
      .post(`/api/items/${itemId}/images`)
      .attach('image', pngBuf, 'drill.png');
    expect(iImg.status).toBe(201);

    // Draw a place overlay and a general overlay on storage image 1
    const ov1 = await request(app)
      .post(`/api/images/${sImg1.body.id}/overlays`)
      .send({
        targetKind: 'place',
        targetId: placeId,
        shape: 'rect',
        coords: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
        label: 'Hylly A',
      });
    expect(ov1.status).toBe(201);

    const ov2 = await request(app)
      .post(`/api/images/${sImg1.body.id}/overlays`)
      .send({
        targetKind: 'general',
        shape: 'rect',
        coords: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
        label: 'Ovi',
      });
    expect(ov2.status).toBe(201);

    // Verify StorageDetail returns both storage images, their overlays, and the item's image
    const detail = await request(app)
      .get(`/api/public/storages/${storageId}`)
      .set('X-Dev-Role', 'none');
    expect(detail.status).toBe(200);
    expect(detail.body.images).toHaveLength(2);
    expect(detail.body.images[0].overlays).toHaveLength(2);
    expect(detail.body.places[0].items[0].images).toHaveLength(1);

    // Verify image file is publicly readable
    const fileRes = await request(app)
      .get(detail.body.images[0].url)
      .set('X-Dev-Role', 'none');
    expect(fileRes.status).toBe(200);
  });
});
