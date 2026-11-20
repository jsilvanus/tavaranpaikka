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
import { generateLabelsPdf } from '../src/labels/pdf.js';
import { getDefaultLogoBuffer } from '../src/labels/qr.js';

describe('label size, font and logo options', () => {
  const targets = [
    {
      kind: 'item',
      id: 'i1',
      name: 'Projektori Epson EB-W49',
      code: 'AAAA-0001',
      storageName: 'Keittiön varasto',
      placePath: ['Hyllykkö A'],
    },
  ];

  it('renders PDFs for every layout x logo placement with custom qr/font scale', async () => {
    for (const layout of ['a4-3x8', 'a4-5x13', 'a4-2x7', 'a4-1x1']) {
      for (const logoPlacement of ['center', 'left', 'right']) {
        const buf = await generateLabelsPdf(
          targets,
          {
            targets: [{ kind: 'item', id: 'i1' }],
            layout,
            qrScale: 1.5,
            fontScale: 1.4,
            logoPlacement,
            show: { qr: true, code: true, name: true, place: true, logo: true },
          },
          'https://example.fi',
          { resolveLogoBuffer: async () => getDefaultLogoBuffer() }
        );
        expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      }
    }
  });

  it('a separate logo makes the PDF larger than without a logo', async () => {
    const base = {
      targets: [{ kind: 'item', id: 'i1' }],
      layout: 'a4-3x8',
      show: { qr: true, code: true, name: true, place: true },
    };
    const without = await generateLabelsPdf(targets, { ...base, logoPlacement: 'left', show: { ...base.show, logo: false } }, 'https://example.fi');
    const withLogo = await generateLabelsPdf(targets, { ...base, logoPlacement: 'left', show: { ...base.show, logo: true } }, 'https://example.fi');
    expect(withLogo.length).toBeGreaterThan(without.length);
  });
});

describe('member (generic user) role', () => {
  let db;
  let app;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tavaranpaikka-role-'));
    db = createDb('pg-mem');
    await runMigrations(db);
    const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'dev', LOCAL_STORAGE_DIR: tmpDir });
    app = createApp({ db, config, storage: createObjectStorage({ driver: 'local', localDir: tmpDir }) });
  });

  afterEach(async () => {
    await db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('can view storages but cannot manage or print labels', async () => {
    const as = (role) => (req) => req.set('X-Dev-Role', role);
    const member = as('member');

    expect((await member(request(app).get('/api/public/storages'))).status).toBe(200);
    expect((await member(request(app).get('/api/storages'))).status).toBe(403);
    expect(
      (await member(request(app).post('/api/storages').send({ name: 'X', kind: 'room' }))).status
    ).toBe(403);
    expect((await member(request(app).get('/api/labels/targets'))).status).toBe(403);
    expect(
      (await member(request(app).post('/api/labels/pdf').send({ targets: [], layout: 'a4-3x8', show: {} }))).status
    ).toBe(403);

    expect((await as('keeper')(request(app).get('/api/storages'))).status).toBe(200);
  });
});
